# Digitronics WA Bot

Modular Node.js rewrite with Express and Node test runner.

## WANotifier authentication

Inbound callbacks from WANotifier are validated with an HMAC signature and a timestamp header. By default the application allows up to 300 seconds of timestamp skew, but will never accept a skew lower than 30 seconds when configured to avoid disabling timestamp validation.

Environment variables:
- `WANOTIFIER_MAX_SKEW_SECONDS`: Maximum acceptable timestamp skew (seconds). Defaults to `300`.
- `WANOTIFIER_HMAC_HEADER`: Header containing the HMAC signature. Defaults to `x-signature`.
- `WANOTIFIER_TS_HEADER`: Header containing the UNIX timestamp used for the signature. Defaults to `x-timestamp`.

