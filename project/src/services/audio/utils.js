/**
 * Shared utilities for audio service modules.
 */

import { execFile } from "child_process";

/**
 * Promise wrapper for child_process.execFile.
 * @param {string} cmd - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} opts - Options for execFile
 * @returns {Promise<{stdout: string, stderr: string}>} Promise resolving to stdout/stderr
 */
export function execFilePromise(cmd, args, opts = {}) {
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

/**
 * Check if a system command exists.
 * @param {string} cmd - Command name to check
 * @returns {Promise<boolean>} True if command exists
 */
export async function commandExists(cmd) {
  try {
    await execFilePromise("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}
