import { describe, expect, it } from 'vitest';

import { createDshSessionCwdAdmission } from '../session-cwd-admission.js';

describe('createDshSessionCwdAdmission', () => {
  it('consumes a canonical local cwd once for its exact Cindy session', () => {
    const admission = createDshSessionCwdAdmission();
    admission.reserve('session-a', '/Users/example/project');

    expect(() => admission.assertAndConsume('/Users/example/project', 'session-a')).not.toThrow();
    expect(() => admission.assertAndConsume('/Users/example/project', 'session-a')).toThrow(
      'not authorized',
    );
  });

  it('does not let a different session or path borrow a pending reservation', () => {
    const admission = createDshSessionCwdAdmission();
    admission.reserve('session-a', '/Users/example/project');

    expect(() => admission.assertAndConsume('/Users/example/project', 'session-b')).toThrow(
      'not authorized',
    );
    expect(() => admission.assertAndConsume('/Users/example/project', 'session-a')).not.toThrow();

    admission.reserve('session-a', '/Users/example/project');
    expect(() => admission.assertAndConsume('/Users/example/other', 'session-a')).toThrow(
      'not authorized',
    );
    expect(() => admission.assertAndConsume('/Users/example/project', 'session-a')).toThrow(
      'not authorized',
    );
  });

  it('clears unconsumed reservations at an account boundary', () => {
    const admission = createDshSessionCwdAdmission();
    admission.reserve('session-a', '/Users/example/project');
    admission.clearAll();

    expect(() => admission.assertAndConsume('/Users/example/project', 'session-a')).toThrow(
      'not authorized',
    );
  });

  it('replaces an unconsumed reservation when the same session retries startup', () => {
    const admission = createDshSessionCwdAdmission();
    admission.reserve('session-a', '/Users/example/first-attempt');
    admission.reserve('session-a', '/Users/example/retry');

    expect(() => admission.assertAndConsume('/Users/example/retry', 'session-a')).not.toThrow();
  });

  it('requires pre-canonicalized absolute paths', () => {
    const admission = createDshSessionCwdAdmission();
    expect(() => admission.reserve('session-a', 'relative/project')).toThrow('canonical absolute');
    expect(() => admission.reserve('session-a', '/Users/example/project/..')).toThrow('canonical absolute');
  });
});
