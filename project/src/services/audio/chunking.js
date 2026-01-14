/**
 * Audio chunking utilities for processing long audio files.
 * Splits audio into manageable chunks for transcription.
 */

// Maximum duration per chunk (4 minutes)
const CHUNK_DURATION_MS = 4 * 60 * 1000;

// Maximum number of chunks to process (20 minutes total)
const MAX_CHUNKS = 5;

// Overlap between chunks to avoid word loss (2 seconds)
const OVERLAP_MS = 2000;

/**
 * Combine transcripts from multiple chunks, removing duplicates at boundaries.
 * Uses an efficient algorithm to detect overlapping word sequences.
 * @param {Array<Object>} transcripts - Array of transcript objects with index, text, startMs, endMs
 * @returns {string} Combined transcript text
 */
export function combineChunkTranscripts(transcripts) {
  // Sort by index to ensure correct order
  transcripts.sort((a, b) => a.index - b.index);
  
  let combined = '';
  
  for (let i = 0; i < transcripts.length; i++) {
    const text = transcripts[i].text.trim();
    
    if (i === 0) {
      // First chunk - use as-is
      combined = text;
    } else {
      // Subsequent chunks - detect and remove overlap efficiently
      const prevWords = combined.split(/\s+/).slice(-10); // Only check last 10 words
      const currWords = text.split(/\s+/);
      
      // Find longest matching suffix-prefix overlap
      let maxOverlap = 0;
      const searchLimit = Math.min(prevWords.length, currWords.length, 10);
      
      for (let len = searchLimit; len > 0; len--) {
        const prevSlice = prevWords.slice(-len).join(' ').toLowerCase();
        const currSlice = currWords.slice(0, len).join(' ').toLowerCase();
        
        if (prevSlice === currSlice) {
          maxOverlap = len;
          break; // Found longest match
        }
      }
      
      // Append non-overlapping portion
      combined += ' ' + currWords.slice(maxOverlap).join(' ');
    }
  }
  
  return combined.trim();
}

/**
 * Note: Audio splitting functionality is not implemented in this stub.
 * This would require ffmpeg or similar audio processing tool to split audio files.
 * For now, we provide the structure for future implementation.
 * 
 * Split audio buffer into chunks for transcription.
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} mimeType - MIME type
 * @param {Object} opts - Options
 * @param {number} opts.chunkDuration - Duration per chunk in ms
 * @param {number} opts.overlap - Overlap between chunks in ms
 * @param {number} opts.maxChunks - Maximum number of chunks
 * @returns {Promise<Array<Object>>} Array of chunk objects with buffer, startMs, endMs
 */
async function splitAudioIntoChunks(audioBuffer, mimeType, opts = {}) {
  // This is a placeholder. Real implementation would use ffmpeg or similar
  // to split audio files into chunks.
  throw new Error('Audio splitting not yet implemented - requires ffmpeg integration');
}

/**
 * Transcribe long audio by splitting into chunks.
 * @param {Buffer} audioBuffer - Audio buffer
 * @param {string} mimeType - MIME type
 * @param {Function} transcribeFunc - Function to transcribe a single chunk
 * @param {Object} opts - Options
 * @param {string} opts.reqId - Request ID for logging
 * @param {string} opts.lang - Language code
 * @param {number} opts.duration - Audio duration in milliseconds
 * @returns {Promise<Object>} Result with text, chunked flag, numChunks
 */
export async function transcribeLongAudio(audioBuffer, mimeType, transcribeFunc, opts = {}) {
  const { reqId, lang, duration } = opts;
  
  // If audio is short enough, transcribe directly
  if (!duration || duration <= CHUNK_DURATION_MS) {
    const result = await transcribeFunc();
    return { text: result.text, chunked: false, numChunks: 1 };
  }
  
  const numChunks = Math.min(Math.ceil(duration / CHUNK_DURATION_MS), MAX_CHUNKS);
  
  console.log(JSON.stringify({
    level: 'info',
    msg: 'audio_chunking_start',
    reqId,
    totalDuration: duration,
    numChunks
  }));
  
  try {
    // Split audio into chunks
    const chunks = await splitAudioIntoChunks(audioBuffer, mimeType, {
      chunkDuration: CHUNK_DURATION_MS,
      overlap: OVERLAP_MS,
      maxChunks: MAX_CHUNKS
    });
    
    const transcripts = [];
    
    // Transcribe each chunk
    for (let i = 0; i < chunks.length; i++) {
      try {
        const result = await transcribeFunc(chunks[i].buffer, {
          ...opts,
          reqId: `${reqId}_chunk${i}`
        });
        
        if (result && result.text) {
          transcripts.push({
            index: i,
            text: result.text,
            startMs: chunks[i].startMs,
            endMs: chunks[i].endMs
          });
        }
      } catch (error) {
        console.error(JSON.stringify({
          level: 'warn',
          msg: 'audio_chunk_failed',
          reqId,
          chunkIndex: i,
          error: error?.message || String(error)
        }));
        // Continue with other chunks even if one fails
      }
    }
    
    if (transcripts.length === 0) {
      throw new Error('all_chunks_failed');
    }
    
    // Combine transcripts
    const combined = combineChunkTranscripts(transcripts);
    
    console.log(JSON.stringify({
      level: 'info',
      msg: 'audio_chunking_complete',
      reqId,
      chunksProcessed: transcripts.length,
      totalChunks: chunks.length,
      combinedLength: combined.length
    }));
    
    return { text: combined, chunked: true, numChunks: transcripts.length };
    
  } catch (error) {
    // If chunking fails, fall back to direct transcription
    if (error.message === 'Audio splitting not yet implemented - requires ffmpeg integration') {
      console.log(JSON.stringify({
        level: 'info',
        msg: 'audio_chunking_not_available',
        reqId
      }));
      const result = await transcribeFunc();
      return { text: result.text, chunked: false, numChunks: 1 };
    }
    throw error;
  }
}
