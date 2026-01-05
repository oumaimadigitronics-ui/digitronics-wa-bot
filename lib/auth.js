import crypto from "crypto";
import { getNowMs } from "../src/deps.js";

function timingSafeEqualStr(a, b) {
  try {
    const sa = Buffer.from(String(a || ""), "utf8");
    const sb = Buffer.from(String(b || ""), "utf8");
    if (sa.length !== sb.length) return false;
    return crypto.timingSafeEqual(sa, sb);
  } catch {
    return false;
  }
}

function validateWanotifierToken(req, cfg) {
  const token = cfg.wanotifierToken;
  if (!token) return true;

  const h = req.headers || {};
  const headerToken = String(h["x-wanotifier-token"] || "");
  const auth = String(h["authorization"] || "");
  if (headerToken && timingSafeEqualStr(headerToken, token)) return true;

  if (auth) {
    const parts = auth.split(" ");
    if (parts.length === 2 && parts[0].toLowerCase() === "bearer" && timingSafeEqualStr(parts[1], token)) return true;
  }

  return false;
}

function validateWanotifierHmac(req, cfg) {
  const secret = cfg.wanotifierHmacSecret;
  if (!secret) return true;

  const h = req.headers || {};
  let sig = String(h[cfg.wanotifierHmacHeader] || "").trim();
  const ts = String(h[cfg.wanotifierTsHeader] || "").trim();
  if (!sig || !ts) return false;

  if (/^sha256=/i.test(sig)) sig = sig.slice(7);

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;

  const nowSec = Math.floor(getNowMs() / 1000);
  const skew = Math.abs(nowSec - tsNum);
  if (skew > cfg.wanotifierMaxSkewSec) return false;

  const raw = String(req.rawBody || "");
  const base = ts + "." + raw;

  let expected = "";
  try {
    expected = crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
  } catch {
    return false;
  }

  return timingSafeEqualStr(sig, expected);
}

function allowStatusAccess(req, res, cfg, requireEnv) {
  if (!requireEnv) return true;
  const tokenExpected = cfg.statusToken;
  if (!tokenExpected) {
    res.status(403).json({ ok: false, error: "Forbidden", message: "STATUS_TOKEN must be set" });
    return false;
  }

  const headerToken = String(req.headers["x-status-token"] || "");
  const auth = String(req.headers["authorization"] || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const provided = headerToken || bearer;
  if (!provided || !timingSafeEqualStr(provided, tokenExpected)) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

export { timingSafeEqualStr, validateWanotifierToken, validateWanotifierHmac, allowStatusAccess };
