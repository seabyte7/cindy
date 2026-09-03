import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertDshAcpStdioLaunchOptions,
  closeDshAcpChild,
  createDshAcpStdioTransport,
  createDshAcpStdoutFrameDecoder,
} from '../dsh-acp-stdio-transport.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DSH ACP stdio launch boundary', () => {
  const valid = {
    binaryPath: '/managed/runtime/dsh',
    launcherCwd: '/managed/runtime/launcher',
    env: { DSH_HOME: '/managed/dsh-home' },
  };

  it('requires Main-owned absolute binary, launcher and DSH_HOME paths', () => {
    expect(() => assertDshAcpStdioLaunchOptions(valid)).not.toThrow();
    expect(() => assertDshAcpStdioLaunchOptions({ ...valid, binaryPath: 'dsh' })).toThrow('binaryPath');
    expect(() => assertDshAcpStdioLaunchOptions({ ...valid, launcherCwd: 'project' })).toThrow('launcherCwd');
    expect(() => assertDshAcpStdioLaunchOptions({ ...valid, env: {} })).toThrow('DSH_HOME');
    expect(() => assertDshAcpStdioLaunchOptions({ ...valid, env: { DSH_HOME: 'relative-home' } })).toThrow('DSH_HOME');
  });

  it.runIf(process.platform === 'win32')('refuses Windows launch until identity-bound process-tree containment exists', () => {
    expect(() => createDshAcpStdioTransport(valid)).toThrow('identity-bound process-tree containment');
  });

  it('rejects bounded close when SIGKILL has no confirmed child exit', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stdin: { end: ReturnType<typeof vi.fn> };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdin = { end: vi.fn() };
    child.kill = vi.fn(() => true);

    const closing = closeDshAcpChild(child as never, 10);
    const expectation = expect(closing).rejects.toThrow('did not exit after SIGKILL');
    await vi.advanceTimersByTimeAsync(30);
    await expectation;
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    vi.useRealTimers();
  });

  it('frames split CRLF JSON records only after their bounded bytes arrive', () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const decoder = createDshAcpStdoutFrameDecoder({
      maxLineBytes: 32,
      onLine: (line) => lines.push(line),
      onOverflow: overflow,
    });

    expect(decoder.push(Buffer.from('{"jsonrpc"'))).toBe(true);
    expect(decoder.push(Buffer.from(':"2.0"}\r\n{}\n'))).toBe(true);
    expect(lines).toEqual(['{"jsonrpc":"2.0"}', '{}']);
    expect(overflow).not.toHaveBeenCalled();
  });

  it('rejects an oversized unterminated stdout record before it is decoded or dispatched', () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const decoder = createDshAcpStdoutFrameDecoder({
      maxLineBytes: 8,
      onLine: (line) => lines.push(line),
      onOverflow: overflow,
    });

    expect(decoder.push(Buffer.from('1234'))).toBe(true);
    expect(decoder.push(Buffer.from('56789'))).toBe(false);
    expect(lines).toEqual([]);
    expect(overflow).toHaveBeenCalledWith(9);
    expect(decoder.push(Buffer.from('{}\n'))).toBe(false);
    expect(lines).toEqual([]);
  });

  it('rejects malformed UTF-8 instead of normalizing it into a protocol line', () => {
    const lines: string[] = [];
    const invalidUtf8 = vi.fn();
    const decoder = createDshAcpStdoutFrameDecoder({
      maxLineBytes: 32,
      onLine: (line) => lines.push(line),
      onOverflow: () => undefined,
      onInvalidUtf8: invalidUtf8,
    });

    expect(decoder.push(Buffer.from([0x7b, 0xff, 0x7d, 0x0a]))).toBe(false);
    expect(lines).toEqual([]);
    expect(invalidUtf8).toHaveBeenCalledWith(3);
    expect(decoder.push(Buffer.from('{}\n'))).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('fails a dead child closed and replays the actual terminal reason to late bridge subscribers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-stdio-transport-test-'));
    temporaryRoots.push(root);
    // Node rejects the fixed --profile argument before evaluating any user-controlled script. This is a
    // deterministic child-exit fixture for transport lifecycle handling, not a DSH runtime fallback.
    const transport = createDshAcpStdioTransport({
      binaryPath: process.execPath,
      launcherCwd: root,
      env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
    });
    const earlyClose = vi.fn();
    transport.onClose(earlyClose);

    await vi.waitFor(() => expect(earlyClose).toHaveBeenCalledTimes(1));
    const reason = earlyClose.mock.calls[0]![0].reason;
    expect(reason).toMatch(/^DSH ACP process exited \(code=/);
    await expect(transport.writeLine('{"jsonrpc":"2.0"}')).rejects.toThrow('closed');

    const lateClose = vi.fn();
    transport.onClose(lateClose);
    expect(lateClose).toHaveBeenCalledWith({ reason });
  });

  it.runIf(process.platform !== 'win32')('tears down a child that emits malformed UTF-8 on stdout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-stdio-transport-utf8-test-'));
    temporaryRoots.push(root);
    const invalidBinary = join(root, 'invalid-utf8-dsh');
    // The fixed ACP argv is intentionally ignored. This fixture proves that
    // bytes invalid under the JSON-RPC UTF-8 contract cannot remain attached
    // to a Main-owned child carrier.
    writeFileSync(invalidBinary, '#!/bin/sh\nprintf "\\377\\n"\nwhile :; do :; done\n', { mode: 0o700 });
    chmodSync(invalidBinary, 0o700);
    const transport = createDshAcpStdioTransport({
      binaryPath: invalidBinary,
      launcherCwd: root,
      env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
      forceKillGraceMs: 10,
    });
    const closed = vi.fn();
    transport.onClose(closed);

    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(closed).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('invalid UTF-8') }));
    await expect(transport.writeLine('{"jsonrpc":"2.0"}')).rejects.toThrow('closed');
  }, 5_000);

  it.runIf(process.platform !== 'win32')('escalates an uncooperative child from EOF to SIGTERM and SIGKILL', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-stdio-transport-kill-test-'));
    temporaryRoots.push(root);
    const stubbornBinary = join(root, 'stubborn-dsh');
    // The fixed ACP argv is intentionally ignored by this local test fixture.
    // It exits only for SIGKILL, so the test proves Main's bounded cleanup
    // rather than relying on a cooperative runtime shutdown.
    writeFileSync(stubbornBinary, '#!/bin/sh\ntrap "" TERM\nprintf "ready\\n"\nwhile :; do :; done\n', { mode: 0o700 });
    chmodSync(stubbornBinary, 0o700);
    const transport = createDshAcpStdioTransport({
      binaryPath: stubbornBinary,
      launcherCwd: root,
      env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
      forceKillGraceMs: 10,
    });
    const closed = vi.fn();
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));
    transport.onClose(closed);
    await vi.waitFor(() => expect(lines).toEqual(['ready']));

    await expect(transport.close('test bounded termination')).resolves.toBeUndefined();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith({ reason: 'DSH ACP process exited (code=null, signal=SIGKILL)' });
    await expect(transport.writeLine('{"jsonrpc":"2.0"}')).rejects.toThrow('closed');
  }, 5_000);

  it.runIf(process.platform !== 'win32')('signals the dedicated POSIX process group so a runtime descendant cannot outlive its carrier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-stdio-transport-tree-test-'));
    temporaryRoots.push(root);
    const forkingBinary = join(root, 'forking-dsh');
    // The runtime boundary is intentionally hostile here: both the direct
    // shell and its background descendant ignore TERM. A detached POSIX child
    // group must receive the later SIGKILL as a group, not just at the shell.
    writeFileSync(forkingBinary, [
      '#!/bin/sh',
      'trap "" TERM',
      '(trap "" TERM; while :; do :; done) &',
      'printf "%s" "$!" > "$DSH_HOME/descendant.pid"',
      'printf "ready\\n"',
      'while :; do :; done',
      '',
    ].join('\n'), { mode: 0o700 });
    chmodSync(forkingBinary, 0o700);
    const transport = createDshAcpStdioTransport({
      binaryPath: forkingBinary,
      launcherCwd: root,
      env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
      forceKillGraceMs: 20,
    });
    const lines: string[] = [];
    transport.onLine((line) => lines.push(line));
    await vi.waitFor(() => expect(lines).toEqual(['ready']));
    const descendantFile = join(root, 'descendant.pid');
    await vi.waitFor(() => expect(existsSync(descendantFile)).toBe(true));
    const descendantPid = Number.parseInt(readFileSync(descendantFile, 'utf8'), 10);
    expect(descendantPid).toBeGreaterThan(0);

    await expect(transport.close('test process-group termination')).resolves.toBeUndefined();
    expect(() => process.kill(descendantPid, 0)).toThrow();
  }, 5_000);

  it.runIf(process.platform !== 'win32')('continues group cleanup when the direct child exits before an escaped-in-time descendant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-stdio-transport-early-root-test-'));
    temporaryRoots.push(root);
    const earlyExitBinary = join(root, 'early-exit-dsh');
    // The direct shell exits cleanly after it writes a ready record. Its
    // background child remains in the detached process group and ignores TERM;
    // a root `close` must therefore not be mistaken for tree cleanup.
    writeFileSync(earlyExitBinary, [
      '#!/bin/sh',
      '(trap "" TERM; while :; do :; done) &',
      'printf "%s" "$!" > "$DSH_HOME/descendant.pid"',
      'printf "ready\\n"',
      'exit 0',
      '',
    ].join('\n'), { mode: 0o700 });
    chmodSync(earlyExitBinary, 0o700);
    const transport = createDshAcpStdioTransport({
      binaryPath: earlyExitBinary,
      launcherCwd: root,
      env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
      forceKillGraceMs: 20,
    });
    const closed = vi.fn();
    transport.onClose(closed);
    const descendantFile = join(root, 'descendant.pid');
    await vi.waitFor(() => expect(existsSync(descendantFile)).toBe(true));
    const descendantPid = Number.parseInt(readFileSync(descendantFile, 'utf8'), 10);
    expect(descendantPid).toBeGreaterThan(0);
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(() => process.kill(descendantPid, 0)).toThrow(), { timeout: 3_000 });
  }, 5_000);

  it.runIf(process.platform !== 'win32')('rejects outbound record delimiters before they can create multiple ACP frames', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cindy-dsh-stdio-transport-outbound-test-'));
    temporaryRoots.push(root);
    const sleeper = join(root, 'sleeper-dsh');
    writeFileSync(sleeper, '#!/bin/sh\nwhile :; do :; done\n', { mode: 0o700 });
    chmodSync(sleeper, 0o700);
    const transport = createDshAcpStdioTransport({
      binaryPath: sleeper,
      launcherCwd: root,
      env: { DSH_HOME: root, HOME: root, PATH: process.env.PATH },
      forceKillGraceMs: 10,
    });
    await expect(transport.writeLine('{"jsonrpc":"2.0"}\n{"jsonrpc":"2.0"}'))
      .rejects.toThrow('outbound line must not contain a record delimiter');
    await transport.close('outbound delimiter test');
  }, 5_000);
});
