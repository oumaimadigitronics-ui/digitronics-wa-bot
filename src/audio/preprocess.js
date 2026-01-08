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

async function getDurationSec(filePath, ffprobeAvailable) {
  if (!ffprobeAvailable) return null;
  try {
    const { stdout } = await execFilePromise("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const val = Number(String(stdout || "").trim());
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

async function preprocessAudio({ filePath, mimeType, maxBytes, allowFfmpeg = true }) {
  const stats = fs.statSync(filePath);
  const sizeBytes = stats.size;
  if (maxBytes && sizeBytes > maxBytes) throw new Error("audio_too_large");

  const ffmpegAvailable = allowFfmpeg ? await commandExists("ffmpeg") : false;
  const ffprobeAvailable = allowFfmpeg ? await commandExists("ffprobe") : false;

  const result = {
    processedPath: filePath,
    durationSec: await getDurationSec(filePath, ffprobeAvailable),
    sizeBytes,
    format: path.extname(filePath).replace(".", "") || "audio",
    preprocessApplied: false,
    tmpDir: null,
    mimeType: mimeType || null,
  };

  if (!ffmpegAvailable) return result;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "digibot-audio-pre-"));
  const outPath = path.join(tmpDir, "audio-preprocess.mp3");

  try {
    await execFilePromise("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-af",
      "loudnorm,aresample=16000,silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB:stop_periods=1:stop_duration=0.4:stop_threshold=-45dB",
      "-b:a",
      "64k",
      outPath,
    ]);
    const processedStats = fs.statSync(outPath);
    result.processedPath = outPath;
    result.sizeBytes = processedStats.size;
    result.format = "mp3";
    result.preprocessApplied = true;
    result.tmpDir = tmpDir;
    result.durationSec = await getDurationSec(outPath, ffprobeAvailable) || result.durationSec;
    return result;
  } catch (_err) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    return result;
  }
}

export { preprocessAudio, commandExists, getDurationSec };
