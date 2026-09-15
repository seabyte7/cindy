import { describe, expect, it } from 'vitest';

import { parseDshExistingHomePackagedE2eMode } from '../existing-home-packaged-e2e-mode.js';

describe('DSH existing Home packaged E2E mode', () => {
  it('allows exactly one explicit local evidence mode', () => {
    expect(parseDshExistingHomePackagedE2eMode(['Electron', 'app'])).toBeNull();
    expect(parseDshExistingHomePackagedE2eMode(['Electron', '--dsh-existing-home-packaged-e2e']))
      .toBe('full');
    expect(parseDshExistingHomePackagedE2eMode(['Electron', '--dsh-existing-home-packaged-e2e=full']))
      .toBe('full');
    expect(parseDshExistingHomePackagedE2eMode(['Electron', '--dsh-existing-home-packaged-e2e=select']))
      .toBe('select');
    expect(parseDshExistingHomePackagedE2eMode(['Electron', '--dsh-existing-home-packaged-e2e=resume-reset']))
      .toBe('resume-reset');
  });

  it('rejects duplicate, malformed, and lookalike flags', () => {
    expect(parseDshExistingHomePackagedE2eMode([
      '--dsh-existing-home-packaged-e2e=select',
      '--dsh-existing-home-packaged-e2e=resume-reset',
    ])).toBeNull();
    expect(parseDshExistingHomePackagedE2eMode(['--dsh-existing-home-packaged-e2e=other']))
      .toBeNull();
    expect(parseDshExistingHomePackagedE2eMode(['--dsh-existing-home-packaged-e2e-select']))
      .toBeNull();
  });
});
