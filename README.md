## Digitronics WA Bot (simplified)

Minimal Express server for the Digitronics WhatsApp webhook bot with WooCommerce offers sync and lightweight intent handling.

### Setup
1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and fill required values.
3. Start the server: `npm start`

### Required environment
- `OPENAI_API_KEY` – OpenAI access for fallback answers.
- `WC_BASE_URL`, `WC_CONSUMER_KEY`, `WC_CONSUMER_SECRET` – WooCommerce REST API.
- Optional: `OFFERS_REFRESH_TOKEN`, `WANOTIFIER_TOKEN`, `WANOTIFIER_HMAC_SECRET` for protected refresh/webhook calls.

See `.env.example` for all tunables.

### Run
```bash
npm start
```

### Sample requests
Health:
```bash
curl http://localhost:3000/health
```

Force offers refresh (with token if set):
```bash
curl -X POST http://localhost:3000/refresh-offers \
  -H "x-refresh-token: $OFFERS_REFRESH_TOKEN"
```

Webhook example:
```bash
curl -X POST http://localhost:3000/wanotifier \
  -H "content-type: application/json" \
  -d '{"text":"salam bghit tv 55","wa_number":"+21260000000"}'
```
