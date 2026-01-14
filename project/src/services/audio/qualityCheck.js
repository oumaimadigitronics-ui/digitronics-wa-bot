/**
 * Audio quality pre-checks before transcription.
 * Validates duration and file size to prevent unnecessary API calls.
 */

const MIN_AUDIO_DURATION_MS = 1000;  // 1 second minimum
const MAX_AUDIO_DURATION_MS = 5 * 60 * 1000;  // 5 minutes maximum
const MIN_AUDIO_SIZE_BYTES = 1000;  // ~1KB minimum

/**
 * Check audio quality before transcription.
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {number} durationMs - Audio duration in milliseconds
 * @param {Object} opts - Options
 * @param {string} opts.reqId - Request ID for logging
 * @returns {Object} Result with ok flag and reason if failed
 */
export function checkAudioQuality(audioBuffer, durationMs, opts = {}) {
  const { reqId } = opts;
  
  // Check minimum duration
  if (durationMs && durationMs < MIN_AUDIO_DURATION_MS) {
    console.log(JSON.stringify({
      level: 'warn',
      msg: 'audio_quality_check_failed',
      reqId,
      reason: 'audio_too_short',
      durationMs
    }));
    return { ok: false, reason: 'audio_too_short', durationMs };
  }
  
  // Check maximum duration
  if (durationMs && durationMs > MAX_AUDIO_DURATION_MS) {
    console.log(JSON.stringify({
      level: 'warn',
      msg: 'audio_quality_check_failed',
      reqId,
      reason: 'audio_too_long',
      durationMs
    }));
    return { ok: false, reason: 'audio_too_long', durationMs };
  }
  
  // Check minimum size (likely empty/corrupt)
  if (audioBuffer && audioBuffer.length < MIN_AUDIO_SIZE_BYTES) {
    console.log(JSON.stringify({
      level: 'warn',
      msg: 'audio_quality_check_failed',
      reqId,
      reason: 'audio_file_too_small',
      sizeBytes: audioBuffer.length
    }));
    return { ok: false, reason: 'audio_file_too_small', sizeBytes: audioBuffer.length };
  }
  
  console.log(JSON.stringify({
    level: 'info',
    msg: 'audio_quality_check_passed',
    reqId,
    durationMs,
    sizeBytes: audioBuffer?.length
  }));
  
  return { ok: true };
}
