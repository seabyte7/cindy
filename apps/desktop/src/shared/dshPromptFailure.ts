/** Product-owned terminal reasons that prove the prompt was not queued by DSH. */
export const DSH_REJECTED_INPUT_REASONS: ReadonlySet<string> = new Set([
  'dsh-image-input-unavailable',
  'dsh-image-model-unsupported',
  'dsh-image-invalid',
  'dsh-attachment-invalid',
  'dsh-prompt-too-large',
]);
