# Audio Transcription Fix Documentation

## Problem
When a voice note was sent to the WhatsApp bot, it would log `audio_processing_enabled` but then fail to transcribe the audio. Instead, the bot would respond with error messages like "Je n'ai pas pu comprendre votre message vocal" (I couldn't understand your voice message).

## Root Cause
The webhook handler called `deriveMediaText()` for all media types. When audio was detected:

1. `deriveMediaText()` in `project/src/services/media/process.js` would detect the audio
2. It would log `audio_processing_enabled`  
3. It would return early WITHOUT transcribing: `return { ok: true, path: "audio", kind: "audio", normalized };`
4. The webhook handler would look for `mediaResult.text` but it didn't exist for audio
5. `mediaDerivedText` stayed empty
6. Later validation would detect no transcription and return an error

Meanwhile, the actual transcription code existed in `processIncomingMedia()` in `server.js` but was never called for audio going through the webhook's media processing flow.

## Solution
Added immediate audio handling in the webhook handler (`server.js` lines 5947-5982), mirroring the pattern already used for image processing.

### New Audio Flow

```javascript
// In server.js webhook handler /wanotifier

// 1. Detect audio BEFORE calling deriveMediaText
const isAudioMessage = Boolean(
  msgType === "audio" ||
  msgType === "voice" ||
  (mediaInfo && (mediaInfo.kind === "audio" || guessMediaKind(mediaInfo) === "audio"))
);

// 2. For audio, call processIncomingMedia() directly
if (isAudioMessage && mediaInfo) {
  const audioResult = await processIncomingMedia({
    mediaInfo,
    mediaMeta,
    msgType,
    lang,
    key,
    reqId,
  });
  
  // 3. Extract the transcribed text
  if (audioResult && audioResult.userText) {
    userTextFromAudio = audioResult.userText;
    // Use it as the user input
    if (!userTextRaw || userTextRaw.trim().length === 0) {
      userTextRaw = userTextFromAudio;
    }
  }
}

// 4. Skip deriveMediaText for audio
if (normalizedMedia && !isAudioMessage) {
  mediaResult = await deriveMediaText(...);
}
```

### Complete Transcription Pipeline

When audio is now processed, it goes through the full pipeline in `processIncomingMedia()`:

1. **Download** - Audio file is downloaded from URL or decoded from base64
2. **Validation** - Check file size, headers, detect invalid payloads  
3. **MIME Detection** - Sniff actual format from file headers
4. **Conversion** - Convert ogg/opus/other → wav if needed (via ffmpeg)
5. **Duration Check** - Get audio duration via ffprobe
6. **Quality Check** - Validate audio isn't too short, silent, or corrupted
7. **Transcription** - Call OpenAI Whisper API with retry logic
8. **Language Detection** - Detect language from transcribed text
9. **Metrics Logging** - Log duration, size, processing time
10. **Text Extraction** - Return `audioResult.userText` with transcription

### Expected Logs

After the fix, when a voice note is sent, you'll see:

```
{"level":"info","msg":"audio_processing_enabled","reqId":"..."}
{"level":"info","msg":"audio_duration_detected","reqId":"...","durationMs":3500}
{"level":"info","msg":"audio_transcribe_ready","reqId":"...","filePath":"...","sizeBytes":45231}
{"level":"info","msg":"audio_metrics","reqId":"...","durationMs":3500,"sizeBytes":45231,...}
{"level":"info","msg":"audio_transcribed","reqId":"...","textPreview":"بغيت تلفازة TCL",...}
```

The key log `audio_transcribed` now appears!

## Test Case

**Input**: Voice note saying "بغيت تلفازة TCL" (I want a TCL TV)

**Expected Behavior**:
1. ✅ Audio detected as `msgType === "audio"`
2. ✅ `processIncomingMedia()` called
3. ✅ Audio downloaded
4. ✅ Format checked, converted to WAV if needed
5. ✅ Transcribed with OpenAI Whisper API
6. ✅ Returns `audioResult.userText = "بغيت تلفازة TCL"`
7. ✅ Sets `userTextRaw = "بغيت تلفازة TCL"`
8. ✅ NLP processes the text
9. ✅ Detects brand "TCL", category "TV"
10. ✅ Finds matching TCL TV offers
11. ✅ Responds with product listings

## Files Modified

### server.js
- **Lines 241-276**: Added audio utility imports (cleanMimeType, sniffAudioMime, etc.)
- **Lines 5947-5982**: Added immediate audio detection and processing
- **Line 5986**: Skip `deriveMediaText` for audio messages

### project/src/services/media/process.js  
- **Line 31**: Updated comment - audio now handled separately

## Architecture

The webhook handler now has three distinct media paths:

1. **Images**: `handleVisionMedia()` called directly (line 5936)
   - OpenAI Vision API for image description
   - Product matching from visual analysis
   
2. **Audio**: `processIncomingMedia()` called directly (line 5955)
   - Audio download and conversion
   - OpenAI Whisper API for transcription
   - Text returned for NLP processing
   
3. **Other Media**: Goes through `deriveMediaText()` (line 5987)
   - Currently returns early for unsupported types
   - Can be extended for documents, etc.

This separation ensures each media type uses its optimized pipeline.

## Related Code

- Audio service: `project/src/services/audio/`
- Media service: `project/src/services/media/`
- Vision service: `project/src/services/vision/`
- Webhook handler: `server.js` `/wanotifier` endpoint

## Testing

Run the test suite:
```bash
npm test
```

Key tests:
- Category switch tests: Verify no regression in text handling
- Greeting tests: Verify language detection still works
- Audio tests: Verify transcription flow (may need mock setup)
