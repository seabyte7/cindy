/**
 * maker:agent:status IPC 的纯 handler body。
 *
 * 这里只做参数校验和 Maker 调用，Electron 注册由 status.ts adapter 承担。
 */

import type { Maker } from '@cindy/maker-core';

import { requireEnum } from '../utils/ipcValidate.js';
import { MAKER_INVOKE } from './channels.js';
import type { IpcHandlerRegistry } from './ipcHandlerRegistry.js';

export function registerMakerStatusHandlers(registry: IpcHandlerRegistry, maker: Maker): void {
  registry.handle(MAKER_INVOKE.AGENT_STATUS, async (_e, agentKind: unknown) => {
    return maker.getAgentStatus(requireEnum(
      agentKind,
      ['claude-code', 'codex', 'pi', 'dsh'] as const,
      'agentKind',
    ));
  });
}
