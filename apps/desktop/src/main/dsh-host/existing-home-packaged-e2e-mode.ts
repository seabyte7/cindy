/**
 * Parse the explicitly opt-in signed-package evidence mode without importing
 * the runtime, Electron, or any persistent selection code during ordinary
 * startup. The caller supplies the independent packaged/env gates.
 */

export type DshExistingHomePackagedE2eMode = 'full' | 'select' | 'resume-reset';

const FLAG = '--dsh-existing-home-packaged-e2e';

export function parseDshExistingHomePackagedE2eMode(
  argv: readonly string[],
): DshExistingHomePackagedE2eMode | null {
  const evidenceFlags = argv.filter(
    (argument) => argument === FLAG || argument.startsWith(`${FLAG}=`),
  );
  if (evidenceFlags.length !== 1) return null;
  switch (evidenceFlags[0]) {
    case FLAG:
    case `${FLAG}=full`:
      return 'full';
    case `${FLAG}=select`:
      return 'select';
    case `${FLAG}=resume-reset`:
      return 'resume-reset';
    default:
      return null;
  }
}
