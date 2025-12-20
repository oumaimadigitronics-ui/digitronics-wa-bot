// server.js — DigiBot Super Effect (Digitronics.ma)
import "dotenv/config";
import express from "express";
import crypto from "crypto";
import OpenAI from "openai";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "5mb" }));

// =====================
// 1. CONFIG & ENV
// =====================
const {
  PORT = "3000",
  OPENAI_API_KEY,
  OFFERS_CSV_URL = "",
  OFFERS_REFRESH_MS = "300000",
  ORDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header",
  MEMORY_MAX_MESSAGES = "12",
} = process.env;

const CFG = {
  refreshMs: Number(OFFERS_REFRESH_MS) || 300000,
  maxMsg: Number(MEMORY_MAX_MESSAGES) || 12,
};

const CONTACTS = {
  whatsapp: "0660111438",
  calls: ["0605123934", "0522895746"],
};

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// =====================
// 2. DATA STORES
// =====================
let OFFERS = { all: [], brands: new Set() };
const memoryStore = new Map();
const strikeStore = new Map();

// =====================
// 3. NORMALIZATION (ARABIC + LATIN)
// =====================
function norm(s) {
  const map = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
  let t = String(s || "").replace(/[٠-٩]/g, d => map[d] || d);
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// =====================
// 4. SUPER SEARCH ENGINE (THE FIX)
// =====================
function resolveOffers(text) {
  const s = norm(text);
  let candidates = OFFERS.all;

  // A. CLASS DETECTION (STRICT)
  let detectedCls = null;
  // If user says any of these, we ONLY show TVs
  if (s.match(/tv|télé|tele|تلفاز|شاشة|talfaz|shasha/)) {
    detectedCls = "tv";
  } 
  // If user says any of these, we ONLY show Fridges
  else if (s.match(/ref|fridge|refrig|ثلاجة|thallaja|تبريد/)) {
    detectedCls = "ref";
  }

  if (detectedCls) {
    candidates = candidates.filter(item => norm(item.class).includes(detectedCls));
  }

  // B. SIZE DETECTION
  // Specifically look for 2-digit numbers (like 32, 43, 50, 55, 65, 75)
  const sizeMatch = s.match(/\b(24|32|40|43|50|55|58|65|70|75|85|86|98)\b/);
  const detectedSize = sizeMatch ? sizeMatch[1] : null;

  if (detectedSize) {
    candidates = candidates.filter(item => item.size === detectedSize);
  }

  // C. BRAND DETECTION
  for (const b of OFFERS.brands) {
    if (s.includes(norm(b))) {
      candidates = candidates.filter(item => norm(item.brand) === norm(b));
      break;
    }
  }

  return { 
    matches: candidates.slice(0, 8), 
    isSpecific: !!(detectedCls || detectedSize) 
  };
}

// =====================
// 5. CSV LOADING
// =====================
async function loadCSV() {
  try {
    const res = await fetch(OFFERS_CSV_URL);
    const text = await res.text();
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
    
    OFFERS.all = records.map(r => ({
      brand: r.brand || "",
      name: r.name || r.model || "",
      class: r.class || r.type || "",
      size: String(r.size || "").replace(/\D/g, ""), // Keep only numbers for size
      price: r.price || "Contact Us",
      stock: Number(r.stock || 0),
      link: r.link || ""
    })).filter(r => r.stock > 0);

    OFFERS.brands = new Set(OFFERS.all.map(r => r.brand));
    console.log(`✅ SYNC: ${OFFERS.all.length} products ready.`);
  } catch (e) { console.error("❌ CSV ERROR:", e.message); }
}

loadCSV();
setInterval(loadCSV, CFG.refreshMs);

// =====================
// 6. CHAT HANDLER
// =====================
app.post("/message", async (req, res) => {
  const phone = req.body.waId || req.body.sender || "unknown";
  const userText = req.body.text || req.body.message || "";
  
  if (!memoryStore.has(phone)) memoryStore.set(phone, []);
  const history = memoryStore.get(phone);
  history.push({ role: "user", content: userText });

  const s = norm(userText);

  // 1. BUY INTENT
  if (s.match(/buy|commander|chri|بغيت|shira|acheter/)) {
    const reply = `Mzyan! Bach t'commander, 3mmer had l-formulaire: ${ORDER_FORM_URL}`;
    return res.json({ ok: true, reply });
  }

  // 2. SEARCH
  const { matches, isSpecific } = resolveOffers(userText);
  let reply = "";

  if (matches.length > 0) {
    strikeStore.set(phone, 0); // Reset strikes
    const list = matches.map(m => `• *${m.brand}* ${m.name} (${m.size}"): *${m.price} DH*`).join("\n\n");
    reply = `Hahouma l-offres li lqit lik:\n\n${list}\n\nBghiti t-commander chi wahed fihom?`;
  } else {
    // 3. STRIKE & GPT FALLBACK
    const strikes = (strikeStore.get(phone) || 0) + 1;
    strikeStore.set(phone, strikes);

    if (strikes >= 3) {
      reply = `Smeh lya bzaf, ma-fhemtch chno bghiti t-3ni. T9der t-tassel bina direct: ${CONTACTS.calls.join(" / ")}`;
      strikeStore.set(phone, 0);
    } else {
      const prompt = `You are DigiBot for Digitronics.ma. Use Darija & French. 
      If user asks for something not in stock, apologize and suggest they ask about brands like DAIKO or TCL.
      Current context: ${userText}`;

      const ai = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "system", content: prompt }, ...history.slice(-3)]
      });
      reply = ai.choices[0].message.content;
    }
  }

  history.push({ role: "assistant", content: reply });
  if (history.length > CFG.maxMsg) history.shift();
  
  res.json({ ok: true, reply });
});

app.get("/refresh", async (req, res) => {
    await loadCSV();
    res.send("Data Refreshed");
});

app.listen(PORT, () => console.log(`🚀 SUPER BOT ONLINE ON PORT ${PORT}`));