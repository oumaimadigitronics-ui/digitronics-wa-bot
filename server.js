import "dotenv/config";
import express from "express";
import crypto from "crypto";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "5mb" }));

const { PORT = "3000", OPENAI_API_KEY, RATE_LIMIT_WINDOW_MS = "60000", RATE_LIMIT_MAX = "25" } = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing env var: OPENAI_API_KEY");
  process.exit(1);
}

const CFG = {
  rateWindowMs: Number(RATE_LIMIT_WINDOW_MS) || 60000,
  rateMax: Number(RATE_LIMIT_MAX) || 25,
};

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function stableReqId() {
  return crypto.randomBytes(8).toString("hex");
}

function shorten(text, max = 420) {
  const t = String(text || "").trim();
  return t.length > max ? t.slice(0, max).trim() : t;
}

// WANotifier payload normalizer
function normalizeWanotifierPayload(body = {}) {
  const waNumber =
    body?.wa_number ??
    body?.whatsapp_number ??
    body?.whatsapp ??
    body?.from ??
    body?.sender ??
    body?.contact ??
    body?.phone ??
    body?.msisdn ??
    body?.number ??
    "unknown";

  const text =
    body?.text ??
    body?.message ??
    body?.body ??
    body?.content ??
    body?.msg ??
    body?.data?.text ??
    body?.data?.message ??
    "";

  const media =
    body?.media_url ??
    body?.mediaUrl ??
    body?.media ??
    body?.attachment ??
    body?.data?.media_url ??
    body?.data?.media ??
    null;

  return {
    waNumber: String(waNumber || "").trim(),
    text: String(text || "").trim(),
    media,
  };
}

function looksLikeAudioMessage(body) {
  const payload = normalizeWanotifierPayload(body);
  const hasMedia = Boolean(payload.media);
  const txt = String(payload.text || "").trim().toLowerCase();
  if (hasMedia && !txt) return true;
  if (txt.includes("voice") || txt.includes("vocal") || txt.includes("audio")) return true;
  return false;
}

// Simple per-number rate limit
const rateStore = new Map(); // wa -> { windowStart:number, count:number }

function normalizeNumber(x) {
  const raw = String(x || "").trim();
  const cleaned = raw.replace(/[^\d+]/g, "").slice(0, 32);
  return cleaned || "unknown";
}

function rateLimitOk(waNumber) {
  const key = normalizeNumber(waNumber);
  const now = Date.now();
  const entry = rateStore.get(key) || { windowStart: now, count: 0 };

  if (now - entry.windowStart > CFG.rateWindowMs) {
    entry.windowStart = now;
    entry.count = 0;
  }
  entry.count += 1;

  rateStore.set(key, entry);
  return entry.count <= CFG.rateMax;
}

// ======== YOUR FIXED-OFFERS SYSTEM PROMPT (paste exactly) ========
const DIGIBOT_SYSTEM_PROMPT = `You are DigiBot for Digitronics.ma. Always reply in Moroccan Darija never in arabic, short and direct. Do not say you are an AI.nnCompany info:nAddress: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.nPhone/WhatsApp: 06 60 111 438.nEmail: contact@digitronics.ma.nnUse ONLY this information for products, prices, delivery, payment, or warranty.nnImportant product information:n- All VISIO TVs are Google TV, except model 32VB23E which is a LED TV.n- All TCL TVs are QLED.n- All MORSAT TVs are Android.n- All prices include delivery fees.n- All TVs include a wall mount for free.nnExtra offers:nVISIO:n- 32VB23E 32 inch (LED TV), price \\"845 MAD\\".n- 32WV9650EG 32 inch (Google TV), price \\"1099 MAD\\".n- 40WE9530AG 40 inch (Google TV), price \\"1849 MAD\\".n- 43WV9650EG 43 inch (Google TV), price \\"1989 MAD\\".n- 50WV9540KG 50 inch (Google TV), price \\"3099 MAD\\".n- 55WV9540KG 55 inch (Google TV), price \\"3599 MAD\\".n- 65WV9540KG 65 inch (Google TV), price \\"5199 MAD\\".n- 75WG9522KG 75 inch (Google TV), price \\"6999 MAD\\".n- VB50 Mini Bar 46L Black, price \\"999 MAD\\".n- V3XVG60 Washing Machine 6kg, price \\"2399 MAD\\".n- V3XUG70 Washing Machine 7kg, price \\"2599 MAD\\".nnTCL (all QLED):n- 32S5K 32 inch, price \\"1499 MAD\\".n- 40S5K 40 inch, price \\"2769 MAD\\".n- 43P7K 43 inch, price \\"3389 MAD\\".n- 50P7K 50 inch, price \\"4189 MAD\\".n- 55P7K 55 inch, price \\"4599 MAD\\".n- 65P7K 65 inch, price \\"6699 MAD\\".n- F50SD Refrigerator, price \\"1219 MAD\\".n- F120SD Refrigerator, price \\"2049 MAD\\".nnMORSAT (all Android):n- MOR24F1 24 inch, price \\"899 MAD\\".n- MOR24SM 24 inch, price \\"989 MAD\\".n- MOR32F1 32 inch, price \\"999 MAD\\".n- MOR32SM 32 inch, price \\"1119 MAD\\".n- MOR43SM 43 inch, price \\"1999 MAD\\".nnSAMSUNG TVs:n- 32H5000F 32 inch, price \\"1429 MAD\\".n- 43F6000 43 inch, price \\"2619 MAD\\".n- 43U8020 43 inch, price \\"3559 MAD\\".n- 50U8200 50 inch, price \\"3709 MAD\\".n- 55U8200 55 inch, price \\"4769 MAD\\".nnTRIO_KROHLER pack:n- TRIO_KROHLER Pack, price \\"2799 MAD\\".nnCANDY:n- CS1082DGG 8kg Washing Machine, price \\"2799 MAD\\".n- CS1292DRRE/1-S 9kg Washing Machine, price \\"2899 MAD\\".n- CS1092DBB 9kg Washing Machine, price \\"2899 MAD\\".n- CNCQ2T618EXMA Combi Inox, price \\"4799 MAD\\".n- CF3E7LOS Dishwasher 13 places, price \\"2799 MAD\\".nnCANDY pack:n- CANDY Pack, price \\"9999 MAD\\" (Washing Machine 8kg + Dishwasher 13 places + Combi Inox).nnAutodetection rules:n- Always read the last six client messages and try to detect the brand, model, and size they are asking about (for example: 32WV9650EG, 43WV9650EG, 32S5K, MOR32SM, 32H5000F, 43F6000, etc.).n- If the client mentions a model or brand that exists in the offers above (VISIO, TCL, MORSAT, SAMSUNG, CANDY, TRIO_KROHLER), answer using the exact price and description from these offers.n- If the client asks about the size (32, 40, 43, 50, 55, 65, 75 inch) together with a known brand (VISIO, TCL, MORSAT, SAMSUNG), match it to the closest model in the list and answer with that model and its price.n- If the client asks if a specific TV is Google TV, QLED, or Android, answer based on the rules above (VISIO = Google TV except 32VB23E which is LED TV only, TCL = QLED, MORSAT = Android TV). If the brand is not covered by these rules, answer according to the information available above; if there is no info, use the generic unknown-info reply.n- If the client asks about wall mount, always say that all TVs include a free wall mount.n- If the client asks about delivery fees or if delivery is included in the price, always say that all prices already include delivery fees.n- If the client asks about a product or TV model that is not in the list above, treat it as a product outside the current offers.nnDelivery: delivery available to all cities in Morocco. Delivery time depends on the city, normally between 1 and 7 days.nPayment: cash on delivery only.nWarranty: 1 year for all products.nnIf the client asks about his order, ask: \\"3tini ra9m dyal l-commande bach ncheckiwha\\".nIf the client gives the order number: \\"choukran, ghadi nraj3ou ndirô tta9t l-commande dyalk\\".nnIf the client asks about after-service: \\"t9dr t3ayat l 0605123934 bach n3awnouk mzyan\\".nnIf the client asks about any product outside these offers: \\"daba 3ndna had l-offre dyal had l-produits, ila katqelleb 3la chi 7aja okhra t9der tzour website dyalna: https://digitronics.ma/\\".nnIf you do not know the answer: \\"ghadi njawb 3la had l-moudou3 mnn ba3d bach nkoon mttaakd\\".nIf info not included: \\"ma kaynach had l-ma3louma 3ndna daba\\".nnORDER BY FORM (important):n- If the client wants to order (buy), do NOT ask for name/phone/address in chat. Send only this form link and tell them to fill it: https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=headern- When sending the link, reply in Darija (Latin) like: \\"mzyan! 3mr had formulaire bach nkmlo l-commande: https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header\\".n- If the client says they already filled the form, reply: \\"choukran! wsltna lma3loumat dyalk, ghadi ntslô bik qrib bash nconfirmiw l-commande\\".n- If the client sends personal info in chat anyway (name/phone/address), reply: \\"choukran! bash nkmlo b sro3a 3mr had formulaire: https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header\\" and do not continue collecting info in chat.nnBuying flow priority:n- When the client intent is ordering, the form link has priority over product explanations.n- After sending the form link once, do not resend it unless the client asks again or says they cannot open it.`;

// Call OpenAI with the fixed-offers prompt
async function digibotReply(userText) {
  const r = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: DIGIBOT_SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    temperature: 0.2,
  });

  return r?.choices?.[0]?.message?.content?.trim() || "";
}

// Routes
app.get("/", (_req, res) => res.status(200).send("OK - Fixed-offers DigiBot running"));

app.post("/wanotifier", async (req, res) => {
  const reqId = stableReqId();
  const t0 = Date.now();

  try {
    const payload = normalizeWanotifierPayload(req.body || {});
    const waNumber = normalizeNumber(payload.waNumber);
    const userText = String(payload.text || "").trim().slice(0, 2000);

    if (!rateLimitOk(waNumber)) {
      return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
    }

    // Optional: block audio/media
    if (looksLikeAudioMessage(req.body || {})) {
      // Your system prompt already says "write message (no audio)" but this is faster.
      return res.status(200).json({ ok: true, reply: "3afak ktb msg b lktaba, bla vocal/audio." });
    }

    if (!userText) {
      return res.status(200).json({ ok: true, reply: "3afak ktb msg b lktaba, bla vocal/audio." });
    }

    const reply = await digibotReply(userText);

    const ms = Date.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "wanotifier_ok",
        reqId,
        waNumber,
        latencyMs: ms,
        replyChars: reply.length,
      })
    );

    return res.status(200).json({ ok: true, reply: shorten(reply, 420) });
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "wanotifier_error",
        reqId,
        latencyMs: ms,
        error: err?.message || String(err),
      })
    );
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
