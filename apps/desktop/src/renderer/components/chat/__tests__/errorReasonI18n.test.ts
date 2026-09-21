import { describe, expect, it } from 'vitest';

import { ERROR_REASON_I18N_KEYS } from '../errorReasonI18n';

describe('DSH terminal error localization', () => {
  it('uses a distinct safe message for an unconfirmed prompt deadline', () => {
    expect(ERROR_REASON_I18N_KEYS['dsh-prompt-timeout']).toBe(
      'ccAgent.dshRuntimeConfiguration.errors.timeout',
    );
    expect(ERROR_REASON_I18N_KEYS['dsh-prompt-unconfirmed']).toBe(
      'ccAgent.dshRuntimeConfiguration.errors.uncertain',
    );
  });
});
