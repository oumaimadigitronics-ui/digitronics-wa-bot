# Audio/Voice Note Processing - Usage Guide

This guide explains how to use the new audio processing features implemented in this PR.

## Overview

The audio processing system has been enhanced with:
1. **Better Error Messages** - Specific, localized error feedback
2. **Retry Logic** - Automatic retry with exponential backoff
3. **Language Detection** - Auto-detect and optimize transcription
4. **Chunking Support** - Framework for long audio processing

## Quick Start

### 1. Error Classification and Messages

```javascript
import { getAudioErrorMessage, classifyAudioError } from './services/audio/errorMessages.js';

try {
  // Attempt audio transcription
  const result = await transcribeAudio(audioBuffer);
} catch (error) {
  // Classify the error
  const errorType = classifyAudioError(error);
  
  // Get localized error message
  const message = getAudioErrorMessage(errorType, userLanguage);
  
  // Send to user
  await sendMessage(message);
}
```

**Supported error types:**
- `quota_exceeded` - API rate limits
- `audio_too_short` - Audio less than 5 seconds
- `audio_too_long` - Audio exceeds 5 minutes
- `poor_quality` - Unclear or noisy audio
- `network_error` - Download or connectivity issues
- `unsupported_format` - Invalid audio format
- `transcription_failed` - Generic transcription error

**Supported languages:**
- `dz` - Darija (Moroccan Arabic)
- `ar` - Modern Standard Arabic
- `fr` - French
- `en` - English

### 2. Retry Logic

```javascript
import { transcribeWithRetry } from './services/audio/retry.js';

// Wrap your transcription function
const result = await transcribeWithRetry(
  async () => {
    return await transcribeAudio(audioBuffer, mimeType);
  },
  {
    reqId: 'request-123',
    lang: 'dz'
  }
);
```

**Features:**
- Automatically retries up to 2 times
- Uses exponential backoff (1s, 2s delays)
- Only retries transient errors (network, quota, transcription)
- Logs retry attempts for debugging

### 3. Language Detection

```javascript
import { 
  detectLanguageFromText,
  getTranscriptionPrompt,
  mapLangToWhisper 
} from './services/audio/languageDetection.js';

// Get initial prompt for expected language
const initialPrompt = getTranscriptionPrompt(userLanguage);
const whisperLang = mapLangToWhisper(userLanguage);

// Transcribe with language hint
const result = await transcribe(audioBuffer, {
  prompt: initialPrompt,
  language: whisperLang
});

// Detect actual language from transcript
const detectedLang = detectLanguageFromText(result.text);

// If different, consider re-transcribing
if (detectedLang !== userLanguage) {
  const betterPrompt = getTranscriptionPrompt(detectedLang);
  const retryResult = await transcribe(audioBuffer, {
    prompt: betterPrompt,
    language: mapLangToWhisper(detectedLang)
  });
}
```

**Language detection indicators:**
- Arabic script ratio
- Darija-specific words (bghit, chhal, 3afak, etc.)
- French words (je, tu, voudrais, etc.)

### 4. Audio Chunking

```javascript
import { transcribeLongAudio, combineChunkTranscripts } from './services/audio/chunking.js';

// For long audio (>4 minutes)
const result = await transcribeLongAudio(
  audioBuffer,
  mimeType,
  async (chunkBuffer, opts) => {
    // Your transcription function
    return await transcribeAudio(chunkBuffer, opts);
  },
  {
    reqId: 'request-123',
    lang: 'dz',
    duration: durationMs // Audio duration in milliseconds
  }
);

console.log(result.text); // Combined transcript
console.log(result.chunked); // true if chunked
console.log(result.numChunks); // Number of chunks processed
```

**Features:**
- Splits audio into 4-minute chunks
- 2-second overlap to avoid word loss
- Intelligently combines transcripts
- Removes duplicate words at boundaries
- Max 5 chunks (20 minutes total)

**Note:** Actual audio splitting requires ffmpeg. Currently returns gracefully to direct transcription.

## Error Message Examples

### Darija
```
"3ndna mochkil technique daba, 3awed mn ba3d aw kteb l-message 🙏"
"L-voice 9sir bzzaf, 3awed sejel message twal chwiya (5 seconds minimum) 🎤"
"Ma sme3tch mezyan, 3awed sejel f blasa hada bla souda3 🔇"
```

### French
```
"Problème technique momentané, réessayez plus tard ou écrivez votre message 🙏"
"Message trop court, enregistrez au moins 5 secondes 🎤"
"Audio pas clair, réenregistrez dans un endroit calme 🔇"
```

## Integration Example

Complete example integrating all features:

```javascript
import {
  classifyAudioError,
  getAudioErrorMessage,
  transcribeWithRetry,
  detectLanguageFromText,
  getTranscriptionPrompt,
  mapLangToWhisper,
  transcribeLongAudio
} from './services/audio/index.js';

async function processVoiceNote(audioBuffer, mimeType, userLang, reqId) {
  try {
    // Get language-optimized prompt
    const prompt = getTranscriptionPrompt(userLang);
    const whisperLang = mapLangToWhisper(userLang);
    
    // Transcribe with retry
    const result = await transcribeWithRetry(
      async () => {
        return await transcribeAudio(audioBuffer, mimeType, {
          prompt,
          language: whisperLang,
          reqId
        });
      },
      { reqId, lang: userLang }
    );
    
    // Detect actual language
    const detectedLang = detectLanguageFromText(result.text);
    
    console.log(JSON.stringify({
      level: 'info',
      msg: 'audio_transcribed',
      reqId,
      expectedLang: userLang,
      detectedLang,
      textLength: result.text.length
    }));
    
    return { ok: true, text: result.text, detectedLang };
    
  } catch (error) {
    // Classify and get appropriate error message
    const errorType = classifyAudioError(error);
    const errorMessage = getAudioErrorMessage(errorType, userLang);
    
    console.error(JSON.stringify({
      level: 'error',
      msg: 'audio_processing_failed',
      reqId,
      errorType,
      error: error.message
    }));
    
    return { ok: false, errorMessage, errorType };
  }
}
```

## Testing

Run the test suite:

```bash
cd project
node --test test/audioErrorMessages.test.js
node --test test/audioLanguageDetection.test.js
node --test test/audioChunking.test.js
```

All 39 tests should pass ✅

## Future Enhancements

1. **Audio Splitting**: Integrate ffmpeg for actual audio file splitting
2. **Quality Detection**: Pre-check audio quality before transcription
3. **Multi-language**: Support code-switching in single transcript
4. **Caching**: Cache transcriptions to avoid re-processing
5. **Streaming**: Support real-time transcription for live audio

## Support

For issues or questions:
- Check the test files for usage examples
- Review the JSDoc comments in source files
- Consult the main README.md for project setup
