import { mkdtempSync, lstatSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DSH_EXISTING_HOME_PACKAGED_E2E_RESULT_NAME,
  DshExistingHomePackagedE2eFailure,
  dshExistingHomePackagedE2eFailurePhase,
  writeDshExistingHomePackagedE2eVerdict,
} from '../existing-home-packaged-e2e.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('DSH existing Home packaged E2E verdict', () => {
  it('writes only a mode-0600 redacted result inside the supplied userData root', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-existing-home-e2e-result-'));
    temporaryRoots.push(root);

    writeDshExistingHomePackagedE2eVerdict({
      userDataPath: root,
      result: { ok: true, phases: ['picker', 'protected-selection', 'main-implicit', 'helper-acp', 'reset'] },
    });

    const resultPath = join(root, DSH_EXISTING_HOME_PACKAGED_E2E_RESULT_NAME);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      kind: 'dsh-existing-home-packaged-e2e',
      ok: true,
      phases: ['picker', 'protected-selection', 'main-implicit', 'helper-acp', 'reset'],
    });
    expect(lstatSync(resultPath).mode & 0o777).toBe(0o600);
  });

  it('records the selection half without inventing a launch or reset result', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-existing-home-e2e-result-'));
    temporaryRoots.push(root);

    writeDshExistingHomePackagedE2eVerdict({
      userDataPath: root,
      result: { ok: true, phases: ['picker', 'protected-selection'] },
    });

    expect(JSON.parse(readFileSync(join(root, DSH_EXISTING_HOME_PACKAGED_E2E_RESULT_NAME), 'utf8')))
      .toEqual({
        kind: 'dsh-existing-home-packaged-e2e',
        ok: true,
        phases: ['picker', 'protected-selection'],
      });
  });

  it('persists only a bounded phase identifier for a failed local evidence run', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-existing-home-e2e-result-'));
    temporaryRoots.push(root);

    writeDshExistingHomePackagedE2eVerdict({
      userDataPath: root,
      result: { ok: false, errorCode: 'DSH_EXISTING_HOME_PACKAGED_E2E_FAILED', failedPhase: 'main-implicit' },
    });

    const source = readFileSync(join(root, DSH_EXISTING_HOME_PACKAGED_E2E_RESULT_NAME), 'utf8');
    expect(JSON.parse(source)).toEqual({
      kind: 'dsh-existing-home-packaged-e2e',
      ok: false,
      errorCode: 'DSH_EXISTING_HOME_PACKAGED_E2E_FAILED',
      failedPhase: 'main-implicit',
    });
    expect(source).not.toContain('/');
  });

  it('classifies the deliberately redacted phase even across a module boundary', () => {
    expect(dshExistingHomePackagedE2eFailurePhase(new DshExistingHomePackagedE2eFailure('helper-acp')))
      .toBe('helper-acp');
    expect(dshExistingHomePackagedE2eFailurePhase({ phase: 'reset' })).toBe('reset');
    expect(dshExistingHomePackagedE2eFailurePhase({ phase: '/private/secret' })).toBe('picker');
    expect(dshExistingHomePackagedE2eFailurePhase({}, 'main-implicit')).toBe('main-implicit');
  });
});
