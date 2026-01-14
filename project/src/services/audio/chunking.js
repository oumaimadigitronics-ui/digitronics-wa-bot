/**
 * Audio chunking utilities for processing long audio files.
 * Splits audio into manageable chunks for transcription.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
 * NOTE: Audio splitting functionality requires ffmpeg integration.
 * This implements actual ffmpeg-based audio splitting.
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
  const { chunkDuration = CHUNK_DURATION_MS, overlap = OVERLAP_MS, maxChunks = MAX_CHUNKS } = opts;
  
  // Write buffer to temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-chunk-'));
  const inputPath = path.join(tmpDir, 'input.wav');
  fs.writeFileSync(inputPath, audioBuffer);
  
  try {
    // Get audio duration using ffprobe
    const duration = await getAudioDuration(inputPath);
    const numChunks = Math.min(Math.ceil(duration / chunkDuration), maxChunks);
    
    const chunks = [];
    for (let i = 0; i < numChunks; i++) {
      const startMs = Math.max(0, i * chunkDuration - (i > 0 ? overlap : 0));
      const endMs = Math.min(duration, (i + 1) * chunkDuration);
      
      const outputPath = path.join(tmpDir, `chunk_${i}.wav`);
      await extractAudioChunk(inputPath, outputPath, startMs, endMs);
      
      chunks.push({
        buffer: fs.readFileSync(outputPath),
        startMs,
        endMs,
        index: i
      });
    }
    
    return chunks;
  } finally {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Validate file path to prevent command injection.
 * @param {string} filePath - File path to validate
 * @returns {boolean} True if path is safe
 */
function isValidFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  
  // Check for command injection attempts
  const dangerousChars = /[;&|`$()<>]/;
  if (dangerousChars.test(filePath)) return false;
  
  // Must be an absolute path
  if (!path.isAbsolute(filePath)) return false;
  
  return true;
}

/**
 * Get audio duration using ffprobe.
 * @param {string} filePath - Path to audio file
 * @returns {Promise<number>} Duration in milliseconds
 */
export async function getAudioDuration(filePath) {
  // Validate file path to prevent command injection
  if (!isValidFilePath(filePath)) {
    throw new Error('Invalid file path for audio duration detection');
  }
  
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    
    let output = '';
    let errorOutput = '';
    
    proc.stdout.on('data', (data) => { output += data; });
    proc.stderr.on('data', (data) => { errorOutput += data; });
    
    // Add timeout protection (10 seconds)
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('ffprobe duration detection timed out'));
    }, 10000);
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const duration = parseFloat(output);
        if (isNaN(duration)) {
          reject(new Error(`Invalid duration output: ${output}`));
        } else {
          resolve(duration * 1000); // Convert to ms
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}: ${errorOutput}`));
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`ffprobe process error: ${err.message}`));
    });
  });
}

/**
 * Extract a chunk from audio file using ffmpeg.
 * @param {string} inputPath - Input audio file path
 * @param {string} outputPath - Output audio file path
 * @param {number} startMs - Start time in milliseconds
 * @param {number} endMs - End time in milliseconds
 * @returns {Promise<void>}
 */
async function extractAudioChunk(inputPath, outputPath, startMs, endMs) {
  // Validate file paths to prevent command injection
  if (!isValidFilePath(inputPath)) {
    throw new Error('Invalid input file path for audio chunk extraction');
  }
  if (!isValidFilePath(outputPath)) {
    throw new Error('Invalid output file path for audio chunk extraction');
  }
  
  // Validate time parameters
  if (typeof startMs !== 'number' || startMs < 0) {
    throw new Error('Invalid start time for audio chunk extraction');
  }
  if (typeof endMs !== 'number' || endMs < startMs) {
    throw new Error('Invalid end time for audio chunk extraction');
  }
  
  return new Promise((resolve, reject) => {
    const startSec = startMs / 1000;
    const durationSec = (endMs - startMs) / 1000;
    
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-ss', startSec.toString(),
      '-t', durationSec.toString(),
      '-ac', '1',
      '-ar', '16000',
      outputPath
    ]);
    
    let errorOutput = '';
    proc.stderr.on('data', (data) => { errorOutput += data; });
    
    // Add timeout protection (60 seconds for chunk extraction)
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('ffmpeg chunk extraction timed out'));
    }, 60000);
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg chunk extraction failed with code ${code}: ${errorOutput.slice(-500)}`));
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`ffmpeg process error: ${err.message}`));
    });
  });
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
    console.log(JSON.stringify({
      level: 'warn',
      msg: 'audio_chunking_failed',
      reqId,
      error: error?.message || String(error)
    }));
    const result = await transcribeFunc();
    return { text: result.text, chunked: false, numChunks: 1 };
  }
}
