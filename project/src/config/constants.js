export const DEFAULTS = {
  // Default timestamp skew allowance for WANotifier HMAC validation (seconds)
  WANOTIFIER_MAX_TS_SKEW_SECONDS: 300,
  // Minimum allowable skew to prevent disabling timestamp validation entirely (seconds)
  WANOTIFIER_MIN_TS_SKEW_SECONDS: 30,
  RATE_LIMIT_MAX: 5,
  RATE_LIMIT_WINDOW_MS: 60_000,
  WANOTIFIER_HMAC_HEADER: 'x-signature',
  WANOTIFIER_TS_HEADER: 'x-timestamp',
  MEMORY_TTL_HOURS: 24,
  MEMORY_MAX_MESSAGES: 20,
  MEMORY_MAX_CONVERSATIONS: 5000,
  MAX_WA_REPLY_CHARS: 6000,
};
