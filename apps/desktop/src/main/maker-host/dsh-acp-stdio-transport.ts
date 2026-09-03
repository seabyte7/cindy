/**
 * Desktop Main implementation of the DSH ACP transport.
 *
 * This module is deliberately below the Cindy bridge and above the runtime: callers must supply
 * a provisioned binary, a managed DSH_HOME, and a non-project launcher cwd. It never accepts a
 * Renderer-provided command, cwd, Home, or environment. ACP framing is handled in maker-core.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';

import type { DshAcpTransport } from '@cindy/maker-core';

import { desktopMakerLogger } from './logger-adapter.js';

const FORCE_KILL_GRACE_MS = 3_000;
/**
 * This is a byte limit, deliberately enforced before UTF-8 decoding or full-line allocation.
 * It matches maker-core's default ACP message ceiling; transports with a narrower policy may
 * reject earlier, but a Desktop Main carrier must never retain an unbounded child-provided line.
 */
export const DSH_ACP_MAX_STDOUT_LINE_BYTES = 16 * 1024 * 1024;

export interface DshAcpStdoutFrameDecoder {
  /** Returns false permanently after a malformed or oversized frame has been observed. */
  push(chunk: Buffer): boolean;
}

type DshAcpTerminableChild = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'kill' | 'once' | 'removeListener' | 'pid' | 'exitCode' | 'signalCode'
>;

type PosixProcessGroupStatus = 'live' | 'gone' | 'unknown';

function hasDshAcpPosixProcessGroup(child: DshAcpTerminableChild): boolean {
  return process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0;
}

/**
 * The detached child is the process-group leader. Probe the negative PGID,
 * rather than the direct-child handle, because its `close` event does not
 * imply that its background descendants have exited.
 */
function getDshAcpPosixProcessGroupStatus(child: DshAcpTerminableChild): PosixProcessGroupStatus {
  if (!hasDshAcpPosixProcessGroup(child)) return 'gone';
  try {
    process.kill(-child.pid!, 0);
    return 'live';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'gone';
    // A failure other than ESRCH cannot prove cleanup. Callers must retain the
    // failure rather than silently treating a potentially live group as gone.
    return 'unknown';
  }
}

/**
 * On POSIX the F0 evidence transport is spawned as its own process-group
 * leader, so bounded cleanup reaches ordinary descendants rather than only
 * its direct process handle. A process group is not OS-level containment: a
 * hostile child can call setsid/double-fork. Product registration remains
 * blocked on the later platform-specific containment gate; this unregistered
 * F0 transport must not be presented as that gate. If the group is already
 * gone, the original ChildProcess handle remains the safe fallback.
 */
function signalDshAcpProcessTree(child: DshAcpTerminableChild, signal: NodeJS.Signals): void {
  if (hasDshAcpPosixProcessGroup(child)) {
    try {
      // Keep targeting the group even after the direct child has exited: an
      // early root exit is exactly when a surviving descendant is dangerous.
      process.kill(-child.pid!, signal);
      return;
    } catch {
      // The process group may have exited concurrently; use the bound handle below.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // A close event can still win concurrently.
  }
}

/**
 * Close after the normal ACP EOF path, then prove a terminal process state.
 *
 * SIGKILL usually results in a `close` event immediately. If it does not, the
 * caller must learn that process ownership is uncertain instead of waiting
 * forever and then treating cleanup as confirmed.
 */
export function closeDshAcpChild(
  child: DshAcpTerminableChild,
  graceMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let rootClosed = (child.exitCode !== null && child.exitCode !== undefined)
      || (child.signalCode !== null && child.signalCode !== undefined);
    let terminationStarted = false;
    let terminateTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let terminalDeadlineTimer: NodeJS.Timeout | undefined;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(terminateTimer);
      clearTimeout(forceKillTimer);
      clearTimeout(terminalDeadlineTimer);
      child.removeListener('close', onClose);
      if (error) reject(error);
      else resolve();
    };
    const beginTermination = (): void => {
      if (settled || terminationStarted) return;
      terminationStarted = true;
      signalDshAcpProcessTree(child, 'SIGTERM');
      forceKillTimer = setTimeout(() => {
        if (rootClosed && getDshAcpPosixProcessGroupStatus(child) === 'gone') {
          settle();
          return;
        }
        signalDshAcpProcessTree(child, 'SIGKILL');
        terminalDeadlineTimer = setTimeout(() => {
          if (rootClosed && getDshAcpPosixProcessGroupStatus(child) === 'gone') {
            settle();
            return;
          }
          settle(new Error('DSH ACP process did not exit after SIGKILL'));
        }, graceMs);
        terminalDeadlineTimer.unref?.();
      }, graceMs);
      forceKillTimer.unref?.();
    };
    const onClose = (): void => {
      rootClosed = true;
      const groupStatus = getDshAcpPosixProcessGroupStatus(child);
      if (groupStatus === 'gone') {
        settle();
        return;
      }
      if (groupStatus === 'unknown') {
        settle(new Error('DSH ACP process group cleanup could not be confirmed'));
        return;
      }
      // The root exited while at least one member of its dedicated process
      // group remains. Terminate that group now; never cancel cleanup merely
      // because the direct ChildProcess emitted close first.
      beginTermination();
    };
    terminateTimer = setTimeout(() => {
      beginTermination();
    }, graceMs);
    terminateTimer.unref?.();
    child.once('close', onClose);
    if (rootClosed) onClose();
    try {
      child.stdin.end();
    } catch {
      // A close event or the bounded terminal deadline determines settlement.
    }
  });
}

/**
 * Frame NDJSON directly from child stdout without `readline`: readline emits only after it has
 * accumulated the full record, which would make a downstream line-length check too late.
 */
export function createDshAcpStdoutFrameDecoder(options: {
  onLine: (line: string) => void;
  onOverflow: (observedBytes: number) => void;
  onInvalidUtf8?: (observedBytes: number) => void;
  maxLineBytes?: number;
}): DshAcpStdoutFrameDecoder {
  const maxLineBytes = options.maxLineBytes ?? DSH_ACP_MAX_STDOUT_LINE_BYTES;
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes <= 0) {
    throw new Error('DSH ACP stdout maxLineBytes must be a positive safe integer');
  }

  let lineParts: Buffer[] = [];
  let lineBytes = 0;
  let overflowed = false;

  return {
    push(chunk): boolean {
      if (overflowed) return false;
      let cursor = 0;
      while (cursor < chunk.length) {
        const newline = chunk.indexOf(0x0a, cursor);
        const end = newline === -1 ? chunk.length : newline;
        const segmentBytes = end - cursor;
        const observedBytes = lineBytes + segmentBytes;
        if (observedBytes > maxLineBytes) {
          overflowed = true;
          // Do not retain this segment: it can be an arbitrarily large child-provided Buffer.
          lineParts = [];
          lineBytes = 0;
          options.onOverflow(observedBytes);
          return false;
        }
        if (segmentBytes > 0) {
          lineParts.push(chunk.subarray(cursor, end));
          lineBytes = observedBytes;
        }
        if (newline === -1) break;

        const rawLine = Buffer.concat(lineParts, lineBytes);
        const protocolBytes = rawLine.at(-1) === 0x0d ? rawLine.subarray(0, -1) : rawLine;
        lineParts = [];
        lineBytes = 0;
        let line: string;
        try {
          // JSON-RPC is UTF-8. Buffer#toString silently substitutes malformed
          // bytes, which can turn an invalid carrier frame into a different
          // valid message; reject rather than normalize untrusted stdout.
          line = new TextDecoder('utf-8', { fatal: true }).decode(protocolBytes);
        } catch {
          overflowed = true;
          options.onInvalidUtf8?.(protocolBytes.length);
          return false;
        }
        options.onLine(line);
        cursor = newline + 1;
      }
      return true;
    },
  };
}

export interface DshAcpStdioLaunchOptions {
  /** Absolute path returned by the verified DSH runtime provisioner. */
  binaryPath: string;
  /** Empty, Cindy-managed runtime launcher directory; never the user worktree. */
  launcherCwd: string;
  /** Environment constructed by Main; it must contain the absolute managed DSH_HOME. */
  env: NodeJS.ProcessEnv;
  /** Test-only shortening of the graceful EOF interval. */
  forceKillGraceMs?: number;
}

export function assertDshAcpStdioLaunchOptions(options: DshAcpStdioLaunchOptions): void {
  if (!isAbsolute(options.binaryPath)) throw new Error('DSH ACP binaryPath must be absolute');
  if (!isAbsolute(options.launcherCwd)) throw new Error('DSH ACP launcherCwd must be absolute');
  const home = options.env.DSH_HOME;
  if (typeof home !== 'string' || !isAbsolute(home)) {
    throw new Error('DSH ACP requires an absolute Main-managed DSH_HOME');
  }
}

function assertDshAcpOutboundLine(line: string): void {
  if (line.includes('\n') || line.includes('\r')) {
    throw new Error('DSH ACP outbound line must not contain a record delimiter');
  }
  const lineBytes = Buffer.byteLength(line, 'utf8');
  if (lineBytes > DSH_ACP_MAX_STDOUT_LINE_BYTES) {
    throw new Error(`DSH ACP outbound line exceeds ${DSH_ACP_MAX_STDOUT_LINE_BYTES} bytes`);
  }
}

/**
 * Spawn the official runtime's published ACP profile. The only argument is a fixed profile name;
 * no user command line, shell, or inherited PATH fallback is allowed on this launch path.
 */
export function createDshAcpStdioTransport(options: DshAcpStdioLaunchOptions): DshAcpTransport {
  assertDshAcpStdioLaunchOptions(options);
  if (process.platform === 'win32') {
    // A ChildProcess handle can stop only the root on Windows. F0 deliberately
    // has no launch-time Job Object, so it cannot make the same identity-bound
    // descendant-cleanup claim as the POSIX process group below. This bridge is
    // unregistered; refusing the launch is safer than silently accepting an
    // orphan-capable runtime until the Windows containment work is delivered.
    throw new Error('DSH ACP transport is unavailable on Windows until identity-bound process-tree containment is implemented');
  }
  const child: ChildProcessWithoutNullStreams = spawn(options.binaryPath, ['--profile', 'acp'], {
    cwd: options.launcherCwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<(info: { reason: string }) => void>();
  let closed = false;
  let terminalReason: string | null = null;
  let closeAttempt: Promise<void> | null = null;
  let stderrWarningCount = 0;

  const finish = (reason: string): void => {
    if (closed) return;
    closed = true;
    terminalReason = reason;
    for (const handler of closeHandlers) {
      try {
        handler({ reason });
      } catch {
        // A consumer cannot prevent other consumers from observing a carrier close.
      }
    }
  };

  const ensurePhysicalTermination = (context: string): void => {
    if (closeAttempt) return;
    // A frame violation has already closed the logical carrier. Keep the
    // physical process under the same bounded EOF -> TERM -> KILL obligation
    // and record a failure if it cannot be confirmed, rather than allowing a
    // direct-child close to be mistaken for cleanup.
    closeAttempt = closeDshAcpChild(child, options.forceKillGraceMs ?? FORCE_KILL_GRACE_MS);
    void closeAttempt.then(
      () => undefined,
      (error: unknown) => {
        desktopMakerLogger.warn('DSH ACP process termination was not confirmed', {
          context,
          message: error instanceof Error ? error.message : 'unknown termination failure',
        });
      },
    );
  };

  const stdout = createDshAcpStdoutFrameDecoder({
    onLine: (line) => {
      for (const handler of lineHandlers) handler(line);
    },
    onOverflow: (observedBytes) => {
      // Treat a size violation as a protocol violation, not just a bad message. The Main-owned
      // carrier must not keep an untrusted runtime alive after it exceeds its resource contract.
      finish(`DSH ACP stdout line exceeds ${DSH_ACP_MAX_STDOUT_LINE_BYTES} bytes (observed at least ${observedBytes})`);
      child.stdout.destroy();
      ensurePhysicalTermination('protocol violation: stdout line exceeded limit');
    },
    onInvalidUtf8: (observedBytes) => {
      finish(`DSH ACP stdout contained invalid UTF-8 (${observedBytes} bytes)`);
      child.stdout.destroy();
      ensurePhysicalTermination('protocol violation: stdout contained invalid UTF-8');
    },
  });
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    // Runtime stderr can contain provider diagnostics. Do not retain or expose it across the
    // bridge; an opaque occurrence/count is enough to correlate a process failure safely.
    if (!chunk.trim()) return;
    if (stderrWarningCount < 3) {
      stderrWarningCount += 1;
      desktopMakerLogger.warn('DSH ACP runtime wrote to stderr', { chars: chunk.length });
      return;
    }
    if (stderrWarningCount === 3) {
      stderrWarningCount += 1;
      desktopMakerLogger.warn('DSH ACP runtime stderr logging suppressed after three chunks');
    }
  });
  child.once('error', (error) => finish(`DSH ACP process error: ${error.message}`));
  child.once('exit', (code, signal) => {
    finish(`DSH ACP process exited (code=${code}, signal=${signal})`);
    // `exit` observes the direct root even if a descendant inherited its stdio
    // fd and prevents Node's later `close` event. It still does not prove the
    // process group is empty, so keep physical cleanup running in the
    // background; the logical carrier is already fail-closed and cannot be
    // reused.
    ensurePhysicalTermination('direct child exited');
  });

  return {
    writeLine(line): Promise<void> {
      if (closed || closeAttempt) return Promise.reject(new Error('DSH ACP transport is closed'));
      try {
        assertDshAcpOutboundLine(line);
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        child.stdin.write(`${line}\n`, (error) => (error ? reject(error) : resolve()));
      });
    },
    onLine(handler): () => void {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose(handler): () => void {
      if (closed) {
        // A process may fail between spawn() and DshAcpClient registering handlers. Replaying the
        // terminal state prevents a caller from retaining a dead carrier as an active bridge.
        handler({ reason: terminalReason ?? 'DSH ACP transport was already closed' });
        return () => undefined;
      }
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close(reason = 'DSH ACP transport close()'): Promise<void> {
      if (closed) return Promise.resolve();
      if (closeAttempt) return closeAttempt;
      // ACP teardown is normally EOF after Cindy has sent session/close. The
      // bounded signal path is only a fallback, and final non-exit is an error
      // rather than proof that Main may release its process ownership.
      closeAttempt = closeDshAcpChild(child, options.forceKillGraceMs ?? FORCE_KILL_GRACE_MS);
      void closeAttempt.then(
        () => finish(reason),
        (error: unknown) => finish(`DSH ACP termination was not confirmed: ${error instanceof Error ? error.message : 'unknown error'}`),
      );
      return closeAttempt;
    },
  };
}
