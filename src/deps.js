import http from "http";
import https from "https";
import OpenAI from "openai";

let injectedFetch = null;
let injectedOpenAI = null;
let injectedNow = null;
let defaultOpenAI = null;

function nodeFetch(url, options) {
  const opts = options || {};
  const method = String(opts.method || "GET").toUpperCase();
  const headers = opts.headers || {};
  const body = opts.body;

  return new Promise((resolve, reject) => {
    try {
      const u = new URL(String(url));
      const lib = u.protocol === "https:" ? https : http;

      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + (u.search || ""),
          method,
          headers,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            const text = buf.toString("utf8");
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode || 0,
              headers: {
                get: (name) => {
                  const k = String(name || "").toLowerCase();
                  return res.headers[k];
                },
              },
              arrayBuffer: async () => buf,
              text: async () => text,
              json: async () => {
                try {
                  return JSON.parse(text || "{}");
                } catch {
                  return {};
                }
              },
            });
          });
        }
      );

      req.on("error", (e) => reject(e));
      if (body) req.write(body);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function getFetch() {
  if (injectedFetch) return injectedFetch;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  return nodeFetch;
}

function getOpenAI() {
  if (injectedOpenAI) return injectedOpenAI;
  if (defaultOpenAI) return defaultOpenAI;
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to call OpenAI");
  defaultOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return defaultOpenAI;
}

function getNowMs() {
  if (typeof injectedNow === "function") return injectedNow();
  return Date.now();
}

function setDepsForTests({ fetchImpl = null, openai = null, nowMs = null } = {}) {
  injectedFetch = fetchImpl;
  injectedOpenAI = openai;
  injectedNow = nowMs;
}

export { getFetch, getOpenAI, getNowMs, setDepsForTests };
