/**
 * agentKindConversion —— DB/renderer 形态('cc' | 'codex' | 'pi' | 'dsh')与 maker-core
 * 形态('claude-code' | 'codex' | 'pi' | 'dsh')的唯一双向映射。
 *
 * 背景:sessions.agent_kind 历史上存 renderer 形态('cc' 起家,default 'cc'),
 * maker-core 用 'claude-code'。三值化前全仓散落 `x === 'cc' ? 'claude-code' :
 * 'codex'` 这类二元 ternary —— pi 进来后每一处都会把 pi 误判成另一家。
 * 一律改走本模块;新增 agent 只改这里。
 */

/** DB(sessions.agent_kind)与 renderer 侧的 agent 形态。 */
export type DbAgentKind = 'cc' | 'codex' | 'pi' | 'dsh';
/** maker-core / IPC 契约侧的 agent 形态。 */
export type MakerAgentKindWire = 'claude-code' | 'codex' | 'pi' | 'dsh';

export class AgentKindConversionError extends Error {
  readonly code = 'UNKNOWN_AGENT_KIND' as const;

  constructor(value: unknown, direction: 'db-to-maker' | 'maker-to-db') {
    super(`Unsupported agent kind for ${direction}: ${String(value)}`);
    this.name = 'AgentKindConversionError';
  }
}

export function isDbAgentKind(value: unknown): value is DbAgentKind {
  return value === 'cc' || value === 'codex' || value === 'pi' || value === 'dsh';
}

export function isMakerAgentKind(value: unknown): value is MakerAgentKindWire {
  return value === 'claude-code' || value === 'codex' || value === 'pi' || value === 'dsh';
}

/**
 * Converts a persisted agent kind to the maker-core wire kind.
 *
 * `null` / `undefined` are the only legacy-default case: pre-agent_kind
 * snapshots and a renderer's unloaded session both mean the historical `cc`
 * default. A present but unrecognised value is corrupt or from a newer peer and
 * must fail closed; mapping it to Claude would run the wrong harness.
 */
export function dbToMakerAgentKind(db: string | null | undefined): MakerAgentKindWire {
  if (db === null || db === undefined) return 'claude-code';
  if (db === 'cc') return 'claude-code';
  if (db === 'codex') return 'codex';
  if (db === 'pi') return 'pi';
  if (db === 'dsh') return 'dsh';
  throw new AgentKindConversionError(db, 'db-to-maker');
}

/** Converts a maker-core identity to its persisted wire representation. */
export function makerToDbAgentKind(maker: string | null | undefined): DbAgentKind {
  if (maker === null || maker === undefined || maker === 'claude-code') return 'cc';
  if (maker === 'codex') return 'codex';
  if (maker === 'pi') return 'pi';
  if (maker === 'dsh') return 'dsh';
  throw new AgentKindConversionError(maker, 'maker-to-db');
}

/**
 * Normalizes either representation for a DB-facing caller.
 *
 * This preserves the historical default only for absence. Do not use it as an
 * input sanitizer: an explicit unknown identity is rejected instead of being
 * silently changed to `cc`.
 */
export function normalizeDbAgentKind(value: string | null | undefined): DbAgentKind {
  if (value === null || value === undefined || value === 'cc' || value === 'claude-code') return 'cc';
  if (value === 'codex' || value === 'pi' || value === 'dsh') return value;
  throw new AgentKindConversionError(value, 'maker-to-db');
}
