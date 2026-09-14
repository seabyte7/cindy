import { describe, expect, it, vi } from 'vitest';

import type { AgentDeps } from '../base-agent.js';
import type {
  DshBridgeAgentReceipt,
  DshBridgeAgentResumeReceipt,
  DshBridgeAgentSessionReceipt,
  DshBridgeAgentSessionRef,
  DshBridgeCommittedFollowHandler,
  DshBridgePermissionRequest,
  DshBridgePermissionResolver,
  DshBridgePort,
  DshBridgePromptContent,
  DshBridgePromptReceipt,
} from './bridge-port.js';
import { DshAgent } from './index.js';
import { translateDshFollowEvent } from './translator.js';

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function promptReceipt(stopReason: DshBridgePromptReceipt['stopReason']): DshBridgePromptReceipt {
  return {
    contractVersion: 1,
    operation: 'prompt',
    receiptId: 'receipt-prompt',
    acceptedAt: '2026-09-03T00:00:00.000Z',
    stopReason,
  };
}

function createReceipt(): DshBridgeAgentSessionReceipt {
  return {
    contractVersion: 1,
    operation: 'create',
    receiptId: 'receipt-create',
    acceptedAt: '2026-09-03T00:00:00.000Z',
    cindySessionId: 'cindy-1',
    scopeId: 'scope-1',
    bridgeSessionKey: 'bridge-session-key-1',
  };
}

function resumeReceipt(): DshBridgeAgentResumeReceipt {
  return {
    ...createReceipt(),
    operation: 'resume',
    receiptId: 'receipt-resume',
  };
}

class FakeDshBridge implements DshBridgePort {
  readonly create = vi.fn(async () => createReceipt());
  readonly resumeForAdapter = vi.fn(async () => resumeReceipt());
  readonly promptDeferred = deferred<DshBridgePromptReceipt>();
  readonly prompt = vi.fn(async (_input: DshBridgeAgentSessionRef & {
    content: readonly DshBridgePromptContent[];
  }) => await this.promptDeferred.promise);
  readonly cancel = vi.fn(async (input: DshBridgeAgentSessionRef): Promise<DshBridgeAgentReceipt<'cancel'>> => ({
    contractVersion: 1,
    operation: 'cancel',
    receiptId: 'receipt-cancel',
    acceptedAt: '2026-09-03T00:00:00.000Z',
    ...input,
  }));
  readonly close = vi.fn(async (input: DshBridgeAgentSessionRef): Promise<DshBridgeAgentReceipt<'close'>> => ({
    contractVersion: 1,
    operation: 'close',
    receiptId: 'receipt-close',
    acceptedAt: '2026-09-03T00:00:00.000Z',
    ...input,
  }));
  private committedFollowHandler: DshBridgeCommittedFollowHandler | undefined;
  private committedReference: DshBridgeAgentSessionRef | undefined;
  private permissionResolver: DshBridgePermissionResolver | undefined;

  followCommitted(
    input: DshBridgeAgentSessionRef,
    handler: DshBridgeCommittedFollowHandler,
  ): () => void {
    this.committedReference = input;
    this.committedFollowHandler = handler;
    return () => { this.committedFollowHandler = undefined; };
  }
  bindPermissionResolver(
    input: DshBridgeAgentSessionRef,
    resolver: DshBridgePermissionResolver,
  ): () => void {
    this.committedReference = input;
    this.permissionResolver = resolver;
    return () => {
      if (this.permissionResolver === resolver) this.permissionResolver = undefined;
    };
  }
  async requestPermission(request: DshBridgePermissionRequest): Promise<'allow-once' | 'reject-once'> {
    return await this.permissionResolver?.(request) ?? 'reject-once';
  }
  emit(
    update: unknown,
    ownership: Partial<Pick<DshBridgeAgentSessionRef, 'cindySessionId' | 'scopeId' | 'bridgeSessionKey'>> = {},
  ): void {
    const committed = this.committedReference ?? {
      cindySessionId: 'cindy-1', scopeId: 'scope-1', bridgeSessionKey: 'bridge-session-key-1',
    };
    const follow = {
      contractVersion: 1,
      cindySessionId: ownership.cindySessionId ?? committed.cindySessionId,
      scopeId: ownership.scopeId ?? committed.scopeId,
      sequence: 1,
      receivedAt: '2026-09-03T00:00:00.000Z',
      update,
    } as const;
    const translated = translateDshFollowEvent(follow);
    if (translated.kind === 'translated') {
      this.committedFollowHandler?.({
        contractVersion: 1,
        cindySessionId: follow.cindySessionId,
        scopeId: follow.scopeId,
        bridgeSessionKey: ownership.bridgeSessionKey ?? committed.bridgeSessionKey,
        sequence: follow.sequence,
        events: translated.events,
      });
    }
  }
}

function deps(): AgentDeps {
  const logger = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return logger; },
  };
  return {
    binaryPath: '/managed/dsh',
    logger,
    runtimeConfig: {},
    auth: {
      getState: async () => ({ authenticated: false }),
      triggerLogin: async () => ({ authenticated: false }),
      logout: async () => undefined,
      getAuthEnv: async () => ({}),
    },
  };
}

async function nextEvent(handle: Awaited<ReturnType<DshAgent['startSession']>>) {
  const iterator = handle.events()[Symbol.asyncIterator]();
  const next = await iterator.next();
  if (next.done) throw new Error('expected a DSH event');
  return next.value;
}

describe('DshAgent', () => {
  it('starts only an injected local bridge session and returns prompt acceptance before its terminal receipt', async () => {
    const bridge = new FakeDshBridge();
    const agent = new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    });
    const handle = await agent.startSession({
      sessionId: 'cindy-1',
      workingDir: '/project',
      model: 'native-dsh',
    });

    expect(handle.agentKind).toBe('dsh');
    expect(handle.id).toMatch(/^dsh:[A-Za-z0-9_-]{32}$/);
    expect(handle.id).not.toContain('runtime-1');
    expect(bridge.create).toHaveBeenCalledWith({ cindySessionId: 'cindy-1', cwd: '/project' });

    bridge.emit({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'native-message-1',
      content: { type: 'text', text: 'safe result' },
    });
    const projected = await nextEvent(handle);
    expect(projected).toMatchObject({ type: 'text', data: { text: 'safe result' }, source: 'dsh' });
    expect(JSON.stringify(projected)).not.toContain('runtime-1');
    expect(JSON.stringify(projected)).not.toContain('native-message-1');

    await handle.send({ type: 'user', content: 'run it' });
    expect(bridge.prompt).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      scopeId: 'scope-1',
      bridgeSessionKey: 'bridge-session-key-1',
      content: [{ type: 'text', text: 'run it' }],
    });
    expect((await nextEvent(handle)).type).toBe('status');

    bridge.promptDeferred.resolve(promptReceipt('end_turn'));
    expect(await nextEvent(handle)).toMatchObject({
      type: 'done', data: { stopReason: 'end_turn' }, agentMeta: { dsh: { stopReason: 'end_turn' } },
    });
    expect((await nextEvent(handle)).type).toBe('status');
    await handle.close();
    expect(bridge.close).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1', scopeId: 'scope-1', bridgeSessionKey: 'bridge-session-key-1',
    });
  });

  it('maps the generic interaction decision to one DSH request only and never retains a resolver after close', async () => {
    const bridge = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    const resolver = vi.fn(async (request) => {
      expect(request).toMatchObject({
        kind: 'permission',
        requestId: expect.stringMatching(/^dsh:permission:/),
        toolUseId: 'dsh:tool:opaque-1',
        toolName: 'bash',
        input: { command: 'pwd', token: '[REDACTED]' },
        metadata: { dsh: { approvalScope: 'once', toolKind: 'other' } },
      });
      return {
        kind: 'permission' as const,
        behavior: 'allow' as const,
        // A generic renderer may offer this vendor-specific field. DSH must
        // still return an ACP one-shot decision only.
        permissionUpdates: [{ type: 'addRules', destination: 'session' }],
      };
    });
    handle.setInteractionResolver(resolver);

    await expect(bridge.requestPermission({
      toolUseId: 'dsh:tool:opaque-1',
      toolName: 'bash',
      input: { command: 'pwd', token: '[REDACTED]' },
      kind: 'other',
    })).resolves.toBe('allow-once');
    expect(resolver).toHaveBeenCalledTimes(1);

    await handle.close();
    await expect(bridge.requestPermission({
      toolUseId: 'dsh:tool:opaque-2', toolName: 'bash', input: { command: 'pwd' }, kind: 'other',
    })).resolves.toBe('reject-once');
  });

  it('rejects DSH permissions if no generic interaction resolver exists or it fails', async () => {
    const bridge = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    const request = { toolUseId: 'dsh:tool:opaque-1', toolName: 'bash', input: { command: 'pwd' }, kind: 'other' } as const;
    await expect(bridge.requestPermission(request)).resolves.toBe('reject-once');

    handle.setInteractionResolver(async () => { throw new Error('renderer disconnected'); });
    await expect(bridge.requestPermission(request)).resolves.toBe('reject-once');
    await handle.close();
  });

  it('rejects remote, foreign resume, and an empty dispatch before an ACP prompt is issued', async () => {
    const bridge = new FakeDshBridge();
    const agent = new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    });
    await expect(agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh', remoteHostId: 'remote-a',
    })).rejects.toThrow('remote sessions');
    await expect(agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh', resumeSessionId: 'runtime-old',
    })).rejects.toThrow('verified opaque handle');

    const handle = await agent.startSession({ sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh' });
    await expect(handle.send({ type: 'user', content: '' })).rejects.toThrow('text or a local attachment');
    expect(bridge.prompt).not.toHaveBeenCalled();
    await handle.close();
  });

  it('forwards attachment references to Main without reading their bytes in maker-core', async () => {
    const bridge = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({ sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh' });

    await handle.send({
      type: 'user',
      content: [
        { type: 'text', text: 'inspect these' },
        { type: 'image', path: '/project/image.png', mimeType: 'image/png' },
        { type: 'file', path: '/project/input.txt', mimeType: 'text/plain' },
        { type: 'mention', name: 'readme', path: '/project/README.md', kind: 'file' },
      ],
    });

    expect(bridge.prompt).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1',
      scopeId: 'scope-1',
      bridgeSessionKey: 'bridge-session-key-1',
      content: [
        { type: 'text', text: 'inspect these' },
        { type: 'image', path: '/project/image.png', mimeType: 'image/png' },
        { type: 'file', path: '/project/input.txt', mimeType: 'text/plain' },
        { type: 'mention', name: 'readme', path: '/project/README.md', kind: 'file' },
      ],
    });
    bridge.promptDeferred.resolve(promptReceipt('end_turn'));
    await handle.close();
  });

  it('resumes only its own opaque Cindy task handle through the Main bridge', async () => {
    const bridge = new FakeDshBridge();
    const agent = new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    });
    const original = await agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    await original.close();
    const resumed = await agent.startSession({
      sessionId: 'cindy-1',
      workingDir: '/project',
      model: 'native-dsh',
      resumeSessionId: original.id,
    });

    expect(bridge.resumeForAdapter).toHaveBeenCalledWith({
      cindySessionId: 'cindy-1', cwd: '/project',
    });
    expect(bridge.create).toHaveBeenCalledTimes(1);
    expect(resumed.id).toBe(original.id);
    await resumed.close();
  });

  it('forwards abort to the bridge and waits for the native terminal receipt before close', async () => {
    const bridge = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    const controller = new AbortController();
    await handle.send({ type: 'user', content: 'cancel this' }, { signal: controller.signal });
    controller.abort();
    await vi.waitFor(() => expect(bridge.cancel).toHaveBeenCalledTimes(1));

    const closing = handle.close();
    await Promise.resolve();
    expect(bridge.close).not.toHaveBeenCalled();
    bridge.promptDeferred.resolve(promptReceipt('cancelled'));
    await closing;
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });

  it('contains an unconfirmed bridge failure in a generic terminal event', async () => {
    const bridge = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    await handle.send({ type: 'user', content: 'fail safely' });
    expect((await nextEvent(handle)).type).toBe('status');
    bridge.promptDeferred.reject(new Error('native endpoint/token leaked here'));
    const error = await nextEvent(handle);
    expect(error).toMatchObject({
      type: 'error',
      data: { message: 'DSH prompt did not complete; reconcile the session before retrying.', isTerminal: true },
    });
    expect(JSON.stringify(error)).not.toContain('endpoint');
    expect(JSON.stringify(error)).not.toContain('token');
    await handle.close();
  });

  it('does not accept another bridge session follow event as this session output', async () => {
    const bridge = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    bridge.emit({
      sessionUpdate: 'agent_message_chunk', messageId: 'foreign-message', content: { type: 'text', text: 'foreign' },
    }, { cindySessionId: 'cindy-other' });
    bridge.emit({
      sessionUpdate: 'agent_message_chunk', messageId: 'foreign-key', content: { type: 'text', text: 'foreign' },
    }, { bridgeSessionKey: 'foreign-bridge-session-key' });

    await handle.send({ type: 'user', content: 'only my events' });
    expect(await nextEvent(handle)).toMatchObject({ type: 'status', data: { status: 'Running' } });
    bridge.promptDeferred.resolve(promptReceipt('end_turn'));
    await nextEvent(handle);
    await nextEvent(handle);
    await handle.close();
  });

  it('contains malformed or failing bridge receipts and cleans up a failed follow subscription', async () => {
    const bridge = new FakeDshBridge();
    bridge.create.mockRejectedValueOnce(new Error('native endpoint=https://private.invalid token=secret'));
    const agent = new DshAgent(deps(), {
      bridge, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    });
    await expect(agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    })).rejects.toThrow('could not be created; reconcile before retrying');

    const followFailure = new FakeDshBridge();
    vi.spyOn(followFailure, 'followCommitted').mockImplementation(() => { throw new Error('raw follow failure'); });
    const followAgent = new DshAgent(deps(), {
      bridge: followFailure, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    });
    await expect(followAgent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    })).rejects.toThrow('could not be observed; reconcile before retrying');
    expect(followFailure.close).toHaveBeenCalledTimes(1);

    const invalidReceipt = new FakeDshBridge();
    const handle = await new DshAgent(deps(), {
      bridge: invalidReceipt, scopeId: 'scope-1', admission: { committedFollowProjection: true, promptReceiptLedger: true },
    }).startSession({ sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh' });
    await handle.send({ type: 'user', content: 'bad receipt' });
    expect((await nextEvent(handle)).type).toBe('status');
    invalidReceipt.promptDeferred.resolve({
      ...promptReceipt('end_turn'), operation: 'cancel',
    } as unknown as DshBridgePromptReceipt);
    await expect(nextEvent(handle)).resolves.toMatchObject({
      type: 'error', data: { reason: 'dsh-prompt-unconfirmed' },
    });
    invalidReceipt.close.mockRejectedValueOnce(new Error('native Home path leaked'));
    await expect(handle.close()).rejects.toThrow('close could not be confirmed; reconcile before retrying');
  });

  it('refuses construction use until Main explicitly admits committed follow and no-replay receipts', async () => {
    const bridge = new FakeDshBridge();
    const agent = new DshAgent(deps(), {
      bridge,
      scopeId: 'scope-1',
      admission: { committedFollowProjection: false, promptReceiptLedger: true } as never,
    });
    await expect(agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    })).rejects.toThrow('requires committed follow projection');
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it('keeps the Main-owned bridge alive until every issued session has a close receipt', async () => {
    const bridge = new FakeDshBridge();
    const onDispose = vi.fn(async () => undefined);
    const agent = new DshAgent(deps(), {
      bridge,
      scopeId: 'scope-1',
      admission: { committedFollowProjection: true, promptReceiptLedger: true },
      onDispose,
    });
    const handle = await agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });

    const disposing = agent.dispose();
    await Promise.resolve();
    expect(onDispose).not.toHaveBeenCalled();

    await handle.close();
    await disposing;
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(agent.dispose()).toBe(disposing);
    await expect(agent.startSession({
      sessionId: 'cindy-2', workingDir: '/project', model: 'native-dsh',
    })).rejects.toThrow('shutting down');
  });

  it('refuses a new native prompt when Main invalidates its provider configuration snapshot', async () => {
    const bridge = new FakeDshBridge();
    let configurationCurrent = true;
    const agent = new DshAgent(deps(), {
      bridge,
      scopeId: 'scope-1',
      admission: { committedFollowProjection: true, promptReceiptLedger: true },
      assertCurrentConfiguration: () => {
        if (!configurationCurrent) throw new Error('provider route changed');
      },
    });
    const handle = await agent.startSession({
      sessionId: 'cindy-1', workingDir: '/project', model: 'native-dsh',
    });
    configurationCurrent = false;

    await expect(handle.send({ type: 'user', content: 'must not reach old provider' })).rejects.toThrow(
      'configuration changed',
    );
    expect(bridge.prompt).not.toHaveBeenCalled();
    await handle.close();
  });
});
