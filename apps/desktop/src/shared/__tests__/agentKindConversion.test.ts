import { describe, expect, it } from 'vitest';

import {
  AgentKindConversionError,
  dbToMakerAgentKind,
  makerToDbAgentKind,
  normalizeDbAgentKind,
} from '../agentKindConversion.js';

describe('agentKindConversion', () => {
  it.each([
    ['cc', 'claude-code'],
    ['codex', 'codex'],
    ['pi', 'pi'],
    ['dsh', 'dsh'],
  ] as const)('preserves the DB identity %s', (dbKind, makerKind) => {
    expect(dbToMakerAgentKind(dbKind)).toBe(makerKind);
    expect(makerToDbAgentKind(makerKind)).toBe(dbKind);
  });

  it('only keeps the historical Claude default for an absent value', () => {
    expect(dbToMakerAgentKind(undefined)).toBe('claude-code');
    expect(makerToDbAgentKind(undefined)).toBe('cc');
    expect(normalizeDbAgentKind(undefined)).toBe('cc');
  });

  it.each([
    () => dbToMakerAgentKind('future-agent'),
    () => makerToDbAgentKind('future-agent'),
    () => normalizeDbAgentKind('future-agent'),
  ])('rejects an explicit unknown identity instead of selecting Claude', (convert) => {
    expect(convert).toThrow(AgentKindConversionError);
    expect(convert).toThrow(/future-agent/);
  });
});
