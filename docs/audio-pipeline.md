# Audio pipeline flow

## Overview
The WhatsApp/Messenger webhook accepts audio media, downloads it, preprocesses it, chunks it when needed, and transcribes it before using the transcript as the user message. The pipeline is designed to be safe, chunk long audio, and avoid low-confidence hallucinations.

## Entry points
- `/wanotifier` webhook handler in `server.js` handles incoming media, calls `deriveMediaText`, and for audio, uses the transcript as `incoming.text` before continuing the existing text flow.
- `processIncomingMedia` in `server.js` is a shared media processor used in tests and other flows for audio and image handling.

## Media detection and normalization
- `extractMediaMetaFromBody` and `extractMediaFromBody` pick media metadata from the webhook payload.
- `normalizeMediaInput`, `normalizeMedia`, and `guessMediaKind` identify audio media and normalize URLs, mime types, and filenames.

## Audio download and preprocessing
1. Audio is downloaded to a temp file in `deriveMediaText` or `processIncomingMedia`.
2. `processAudioPipeline` (from `src/audio/index.js`) orchestrates preprocessing and transcription.
3. `preprocessAudio` in `src/audio/preprocess.js` validates size against `MEDIA_MAX_BYTES_AUDIO`, attempts ffmpeg normalization and silence trimming, and converts to a stable format (mp3, 16k mono). If ffmpeg is missing or fails, it falls back to the original file.

## Chunking
- `getChunkingPlan` and `chunkAudio` in `src/audio/chunk.js` split long audio when `durationSec > 45` or `sizeBytes > 5MB`.
- Chunk duration targets 15–30 seconds, default 20 seconds.
- Chunks are transcribed in order and merged in order.

## Transcription
- `transcribeAudio` in `src/audio/transcribe.js` calls OpenAI audio transcription using `OPENAI_TRANSCRIBE_MODEL` and optional language hints.
- `cleanTranscript` in `src/audio/cleanTranscript.js` removes filler words, normalizes whitespace and punctuation, and normalizes numbers.

## Quality score and fallback
- `qualityScore` in `src/audio/qualityScore.js` rates transcripts based on length vs duration, gibberish ratio, repeated tokens, and unknown markers.
- `isTranscriptLowQuality` in `src/audio/index.js` determines whether to stop and use fallback replies.
- Low-quality transcripts return `VOICE_NOT_UNDERSTOOD_TEMPLATE` and never trigger offer lookup or LLM generation.

## Answer generation for voice
- Clean transcripts are stored in memory as the user message.
- When LLM responses are needed, `digibotVoiceLLMReply` runs a two-stage prompt:
  - intent extraction (JSON)
  - structured answer generation (JSON) with verification
- Replies are formatted without question marks and are verified to avoid ungrounded prices or URLs.

## Example logs
When `LOG_DEBUG=1`, transcripts are logged only as short snippets. Example:

```json
{"level":"info","msg":"audio_pipeline","reqId":"...","durationSec":62.4,"sizeBytes":4452311,"chunksCount":3,"modelUsed":["gpt-4o-mini-transcribe"],"transcriptChars":186,"transcriptQualityScore":0.78,"latencyMs":{"downloadMs":221,"preprocessMs":150,"chunkMs":97,"transcribeMs":1880,"totalMs":2122},"transcriptSnippet":"salam bghit tv daiko 32 pouces","qualityReasons":[]}
```

A media routing log with transcript quality:

```json
{"msg":"media_route","reqId":"...","mediaKind":"audio","sizeBytes":4452311,"transcriptChars":186,"transcriptQualityScore":0.78}
```
