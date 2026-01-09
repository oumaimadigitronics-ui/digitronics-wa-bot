# Digitronics WhatsApp/Messenger bot

Express webhook server that handles inbound WhatsApp/Messenger messages, integrates with OpenAI for replies, and supports media processing for images and voice.

## Setup

- Install dependencies: `npm install`
- Start server: `npm start`

## Environment variables

Core:
- `OPENAI_API_KEY`: OpenAI API key
- `OPENAI_MODEL`: chat model used for responses
- `OPENAI_TRANSCRIBE_MODEL`: audio transcription model, default `gpt-4o-mini-transcribe`

Media:
- `MEDIA_MODE`: `auto` or `disabled`
- `MEDIA_FETCH_TIMEOUT_MS`: fetch timeout for media downloads
- `MEDIA_MAX_BYTES_IMAGE`: max image size in bytes
- `MEDIA_MAX_BYTES_AUDIO`: max audio size in bytes
- `MEDIA_ALLOW_INSECURE_HTTP`: allow http downloads when set to `1`

Audio pipeline:
- `AUDIO_MIN_SCORE`: minimum transcript quality score threshold, default `0.45`

Debugging:
- `LOG_DEBUG=1` enables debug logs and includes short transcript snippets (max 200 chars)

Feature flags (set in Render environment variables when needed):
- `FEATURE_STRICT_CATEGORY_SWITCH`: set to `1` to reset TV context when an explicit appliance category is detected
- `FEATURE_OFFER_TAIL_COMPACT`: set to `1` to use a shorter offers footer for fitting more items
- `FEATURE_STRICT_STOCK_FILTER`: set to `1` to remove out-of-stock offers before ranking
- `FEATURE_SHOW_SKU_IN_OFFERS`: set to `1` to include SKU/model in offer lines
- `FEATURE_OFFER_ITEM_EMOJI_FORMAT`: set to `1` to use emoji offer item blocks in premium offers

Render configuration:
- In the Render dashboard, open your service, go to **Environment**, and add/update the env vars above (for example `FEATURE_STRICT_STOCK_FILTER=1`).
- Set `FEATURE_OFFER_ITEM_EMOJI_FORMAT=1` on Render to enable new offer formatting.

## Audio pipeline
See `docs/audio-pipeline.md` for a detailed walkthrough of the audio processing flow, chunking, quality checks, and logging.

## Tests
Run the Node.js test runner:

```
npm test
```
