import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";

function execFilePromise(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function commandExists(cmd) {
  try {
    await execFilePromise("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

function getChunkingPlan({ durationSec, sizeBytes, minDurationSec = 15, targetDurationSec = 20, maxDurationSec = 30 }) {
  const duration = Number(durationSec || 0);
  const size = Number(sizeBytes || 0);
  const shouldChunk = Boolean(duration > 45 || size > 5 * 1024 * 1024);
  const target = Math.min(Math.max(targetDurationSec, minDurationSec), maxDurationSec);
  return { shouldChunk, targetDurationSec: target };
}

async function chunkAudio({ filePath, durationSec, sizeBytes, allowFfmpeg = true }) {
  const plan = getChunkingPlan({ durationSec, sizeBytes });
  if (!plan.shouldChunk) return { chunks: [filePath], chunksCount: 1, chunked: false };

  const ffmpegAvailable = allowFfmpeg ? await commandExists("ffmpeg") : false;
  if (!ffmpegAvailable) return { chunks: [filePath], chunksCount: 1, chunked: false, skipped: "ffmpeg_missing" };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "digibot-audio-chunks-"));
  const ext = path.extname(filePath) || ".mp3";
  const pattern = path.join(tmpDir, `chunk-%03d${ext}`);

  try {
    await execFilePromise("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-f",
      "segment",
      "-segment_time",
      String(plan.targetDurationSec),
      "-reset_timestamps",
      "1",
      "-c",
      "copy",
      pattern,
    ]);
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith("chunk-"))
      .sort()
      .map((f) => path.join(tmpDir, f));

    if (!files.length) throw new Error("chunk_failed");
    return { chunks: files, chunksCount: files.length, chunked: true, tmpDir };
  } catch (_err) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    return { chunks: [filePath], chunksCount: 1, chunked: false, skipped: "chunk_failed" };
  }
}

export { chunkAudio, getChunkingPlan };
