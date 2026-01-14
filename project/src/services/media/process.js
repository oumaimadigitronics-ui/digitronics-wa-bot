/**
 * Media Processing Service
 * 
 * Main orchestration for media processing - handles incoming media,
 * classifies type, and routes to appropriate handlers (vision/audio).
 */

/**
 * Sanitize derived text by removing URLs and cleaning
 * @param {string} text - Text to sanitize
 * @param {Function} stripUrlQueriesInText - URL stripping function
 * @returns {string} - Sanitized text
 */
export function sanitizeDerivedText(text, stripUrlQueriesInText) {
  return stripUrlQueriesInText(String(text || "").replace(/https?:\/\/\S+/g, "")).trim();
}

/**
 * Derive text from media (image or audio)
 * @param {Object} mediaInput - Media input object
 * @param {string} lang - Language code
 * @param {string} reqId - Request ID
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} - Result object with ok status and text/error
 */
export async function deriveMediaText(mediaInput, lang, reqId, deps) {
  const {
    normalizeMedia,
    guessMediaKind,
    fetchMedia,
    sniffImageMime,
    describeImage,
    getOpenAIClient,
    ensureNoQuestion,
    stripUrlQueriesInText,
    CFG,
    processIncomingMediaForAudio,
  } = deps;

  const normalized = normalizeMedia(mediaInput);
  if (!normalized) return { ok: false, reason: "media_missing" };
  if (CFG.mediaMode === "disabled") return { ok: false, disabled: true };

  const raw = (normalized && normalized.raw) || {};
  const baseKind = normalized.kind || guessMediaKind({ mime: normalized.mime, type: raw.type, kind: raw.kind });
  if (baseKind === "audio") {
    // Audio processing is now enabled - will be handled by the audio transcription pipeline
    console.log(JSON.stringify({ level: "info", msg: "audio_processing_enabled", reqId }));
    
    // Route to audio transcription pipeline if available
    if (processIncomingMediaForAudio) {
      try {
        const audioResult = await processIncomingMediaForAudio({
          mediaInfo: normalized,
          mediaMeta: normalized,
          msgType: "audio",
          lang,
          key: reqId, // Use reqId as key for audio-only processing
          reqId,
        });
        
        // If transcription succeeded, return the text
        if (audioResult && audioResult.userText) {
          return { 
            ok: true, 
            path: "audio", 
            kind: "audio", 
            text: audioResult.userText,
            sizeBytes: audioResult.sizeBytes,
            transcriptChars: audioResult.transcriptChars,
            mimeType: audioResult.mimeType,
            normalized 
          };
        }
        
        // If transcription failed but has a reply (error message), return it
        if (audioResult && audioResult.reply) {
          return { 
            ok: false, 
            path: "audio", 
            kind: "audio",
            error: new Error("transcription_failed"),
            reply: audioResult.reply,
            normalized 
          };
        }
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "audio_transcription_failed", reqId, error: (err && err.message) || String(err) }));
        return { 
          ok: false, 
          path: "audio", 
          kind: "audio",
          error: err,
          normalized 
        };
      }
    }
    
    // Fallback if no audio processor available
    return { ok: true, path: "audio", kind: "audio", normalized };
  }

  if (baseKind === "image" || baseKind === "unknown") {
    try {
      let buffer = null;
      let mimeType = normalized.mime || "";
      let sizeBytes = 0;

      if (normalized.url) {
        const fetched = await fetchMedia(normalized.url, {
          maxBytes: CFG.mediaMaxBytesImage,
          timeoutMs: CFG.mediaFetchTimeoutMs,
          allowHttp: CFG.mediaAllowHttp,
          getFetch: deps.getFetch,
          sniffImageMime,
          CFG,
        });
        buffer = fetched.buffer;
        sizeBytes = fetched.sizeBytes || fetched.buffer.length || 0;
        mimeType = mimeType || fetched.mimeType || "image/jpeg";
      } else if (normalized.base64 || raw.base64 || raw.payload || raw.data) {
        const b64 = String(normalized.base64 || raw.base64 || raw.payload || raw.data || "");
        const buf = Buffer.from(b64, "base64");
        sizeBytes = buf.length;
        if (sizeBytes > CFG.mediaMaxBytesImage) throw new Error("image_too_large");
        const sniffed = sniffImageMime(buf);
        mimeType = mimeType || raw.mimeType || raw.contentType || sniffed || "image/jpeg";
        buffer = buf;
      } else {
        throw new Error("media_url_missing");
      }

      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      const desc = await describeImage(
        { image: dataUrl, model: CFG.openaiVisionModel || "gpt-4o-mini" },
        getOpenAIClient()
      );
      const safe = ensureNoQuestion(sanitizeDerivedText(desc, stripUrlQueriesInText));
      if (!safe) throw new Error("vision_description_empty");
      return { ok: true, text: safe.slice(0, 1800), path: "image", sizeBytes, mimeType };
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "media_image_derive_fail", reqId, error: (err && err.message) || String(err) }));
      return { ok: false, error: err };
    }
  }

  return { ok: false, reason: "unsupported_media" };
}

/**
 * Process incoming media from webhook
 * Note: This function contains audio processing that should be extracted to audio service in Phase 10B
 * For now, it delegates to the existing server.js implementation
 * 
 * @param {Object} params - Parameters
 * @param {Object} deps - Dependencies (including server functions for audio)
 * @returns {Promise<Object>} - Processing result
 */
export async function processIncomingMedia(params, deps) {
  const { mediaInfo, mediaMeta, msgType, lang, key, reqId } = params;
  const {
    normalizeMediaInput,
    classifyMediaRoute,
    handleVisionMedia,
    handleAudioProcessing,
    shortenNoQuestion,
    CFG,
  } = deps;

  const normalizedMedia = normalizeMediaInput(mediaInfo || mediaMeta || null);
  const route = classifyMediaRoute(normalizedMedia, msgType || (mediaMeta && mediaMeta.kind));

  // Audio processing - delegate to server.js implementation until Phase 10B is complete
  if (route.audioLikely && normalizedMedia && handleAudioProcessing) {
    return await handleAudioProcessing({ normalizedMedia, route, lang, key, reqId });
  }

  // Vision processing
  if (route.imageLikely && normalizedMedia) {
    try {
      const visionReply = await handleVisionMedia(normalizedMedia, lang, key, { reqId });
      const reply = shortenNoQuestion(visionReply.reply, CFG.maxReplyChars);
      return { ...route, reply };
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "vision_failed", reqId, error: (e && e.message) || String(e) }));
      return { ...route, visionError: e };
    }
  }

  // Other media types
  if (normalizedMedia && route.path === "other") {
    return { ...route, reply: "I received a file. Please send text, an image, or a voice note." };
  }

  return route;
}
