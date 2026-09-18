/** Official DeepSeek Messages root used by DSH alpha.2. */
export const DSH_OFFICIAL_MESSAGES_BASE_URL = 'https://api.deepseek.com/anthropic' as const;

/**
 * Upgrade the legacy official API origin to the Messages root expected by
 * current DSH. Custom gateways and every non-root path remain untouched.
 */
export function normalizeDshMessagesBaseUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'api.deepseek.com' &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.pathname === '/'
    ) {
      return DSH_OFFICIAL_MESSAGES_BASE_URL;
    }
  } catch {
    // Validation owns malformed values; normalization must not make them look valid.
  }
  return trimmed;
}
