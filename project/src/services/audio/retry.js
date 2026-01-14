/**
 * Audio transcription retry logic with exponential backoff.
 * Automatically retries transcription on transient errors.
 */

import { classifyAudioError } from './errorMessages.js';

// Errors that should trigger a retry
const RETRYABLE_ERRORS = ['network_error', 'quota_exceeded', 'transcription_failed'];

// Maximum number of retry attempts
const MAX_RETRIES = 2;

// Base delay for retry in milliseconds
const RETRY_DELAY_MS = 1000;

/**
 * Sleep for a specified duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Transcribe audio with automatic retry on transient errors.
 * @param {Function} transcribeFunc - Transcription function to call
 * @param {Object} opts - Options
 * @param {string} opts.reqId - Request ID for logging
 * @param {string} opts.lang - Language code
 * @returns {Promise<Object>} Transcription result with text
 * @throws {Error} Last error if all retries fail
 */
export async function transcribeWithRetry(transcribeFunc, opts = {}) {
  const { reqId } = opts;
  
  let lastError = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Add delay before retry attempts (exponential backoff)
      if (attempt > 0) {
        const delayMs = RETRY_DELAY_MS * attempt;
        console.log(JSON.stringify({
          level: 'info',
          msg: 'audio_transcribe_retry',
          reqId,
          attempt,
          maxRetries: MAX_RETRIES,
          delayMs
        }));
        await sleep(delayMs);
      }
      
      // Call the transcription function
      const result = await transcribeFunc();
      
      // Check if result is valid
      if (result && result.text) {
        if (attempt > 0) {
          console.log(JSON.stringify({
            level: 'info',
            msg: 'audio_transcribe_retry_success',
            reqId,
            attempt
          }));
        }
        return result;
      }
      
      // Empty result - treat as error with descriptive message
      throw new Error('Audio transcription returned no text content');
      
    } catch (error) {
      lastError = error;
      const errorType = classifyAudioError(error);
      
      console.error(JSON.stringify({
        level: 'warn',
        msg: 'audio_transcribe_attempt_failed',
        reqId,
        attempt,
        errorType,
        error: error?.message || String(error)
      }));
      
      // Don't retry non-retryable errors
      if (!RETRYABLE_ERRORS.includes(errorType)) {
        console.log(JSON.stringify({
          level: 'info',
          msg: 'audio_error_not_retryable',
          reqId,
          errorType,
          attempt
        }));
        break;
      }
    }
  }
  
  // All retries exhausted
  throw lastError || new Error('transcription_failed');
}
