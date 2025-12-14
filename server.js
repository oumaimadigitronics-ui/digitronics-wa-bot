import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import FormData from "form-data";

const app = express();
app.use(express.json({ limit: "25mb" }));

// =====================
// ENV + CLIENTS
// =====================
const {
  PORT = 3000,

  // Meta / WhatsApp Cloud API (only needed if you use /webhook and sendWhatsAppMessage)
  WA_VERIFY_TOKEN,
  WA_PHONE_NUMBER_ID,
  WA_ACCESS_TOKEN,

  // OpenAI
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-5.2",
  OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe",
} = process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// TEMP system prompt (edit as you want)
cconst SYSTEM_PROMPT = `
You are DigiBot for Digitronics.ma.

RULES (MANDATORY):
- Always reply in Moroccan Darija (LATIN letters only).
- NEVER use Arabic script.
- NEVER say you are an AI or chatbot.
- Be short, direct, and commercial.
- Use ONLY the information provided below.
- Do NOT invent prices, models, or products.

COMPANY INFO:
Address: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230
Phone/WhatsApp: 06 60 111 438
Email: contact@digitronics.ma

GENERAL RULES:
- All prices include delivery.
- Delivery to all cities in Morocco (1–7 days).
- Payment: cash on delivery only.
- Warranty: 1 year for all products.
- All TVs include a FREE wall mount.

TV SYSTEM RULES:
- VISIO TVs = Google TV EXCEPT 32VB23E (LED only)
- TCL TVs = QLED
- MORSAT TVs = Android TV

PRODUCT OFFERS (USE EXACTLY):

VISIO:
- 32VB23E 32 inch LED TV — 845 MAD
- 32WV9650EG 32 inch Google TV — 1099 MAD
- 40WE9530AG 40 inch Google TV — 1849 MAD
- 43WV9650EG 43 inch Google TV — 1989 MAD
- 50WV9540KG 50 inch Google TV — 3099 MAD
- 55WV9540KG 55 inch Google TV — 3599 MAD
- 65WV9540KG 65 inch Google TV — 5199 MAD
- 75WG9522KG 75 inch Google TV — 6999 MAD
- VB50 Mini Bar 46L — 999 MAD
- V3XVG60 Washing Machine 6kg — 2399 MAD
- V3XUG70 Washing Machine 7kg — 2599 MAD

TCL (ALL QLED):
- 32S5K — 1499 MAD
- 40S5K — 2769 MAD
- 43P7K — 3389 MAD
- 50P7K — 4189 MAD
- 55P7K — 4599 MAD
- 65P7K — 6699 MAD
- F50SD Refrigerator — 1219 MAD
- F120SD Refrigerator — 2049 MAD

MORSAT (ALL ANDROID):
- MOR24F1 24 inch — 899 MAD
- MOR24SM 24 inch — 989 MAD
- MOR32F1 32 inch — 999 MAD
- MOR32SM 32 inch — 1119 MAD
- MOR43SM 43 inch — 1999 MAD

SAMSUNG:
- 32H5000F — 1429 MAD
- 43F6000 — 2619 MAD
- 43U8020 — 3559 MAD
- 50U8200 — 3709 MAD
- 55U8200 — 4769 MAD

TRIO_KROHLER:
- Pack — 2799 MAD

CANDY:
- CS1082DGG 8kg — 2799 MAD
- CS1292DRRE/1-S 9kg — 2899 MAD
- CS1092DBB 9kg — 2899 MAD
- CNCQ2T618EXMA Combi Inox — 4799 MAD
- CF3E7LOS Dishwasher 13 places — 2799 MAD
- CANDY Pack — 9999 MAD

ORDER RULES (VERY IMPORTANT):
- If the user wants to BUY or ORDER:
  DO NOT ask name, phone, or address.
  Send ONLY this link and nothing else:
  https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header

Reply like:
"mzyan! 3mr had formulaire bach nkmlo l-commande: [LINK]"

- If user says they already filled it:
"choukran! wsltna lma3loumat dyalk, ghadi ntslô bik قريب"

AFTER-SALES:
- Order status:
"3tini ra9m dyal l-commande bach ncheckiwha"
- After service:
"t9dr t3ayat l 0605123934 bach n3awnouk mzyan"

UNKNOWN INFO:
- If product not listed:
"daba 3ndna had l-offre dyal had l-produits, ila katqelleb 3la chi 7aja okhra t9der tzour site dyalna: https://digitronics.ma/"
- If unsure:
"ghadi njawb 3la had l-moudou3 mnn ba3d bach nkoon mttaakd"
`;


// =====================
// HEALTH CHECK (fixes "Cannot GET /")
// =====================
app.get("/", (req, res) => {
  res.status(200).send("OK - DigiTronics WhatsApp Bot is running");
});

// =====================
// 1) WANotifier -> Your server (NO Meta needed)
// WANotifier “Send API request” should call this.
// =====================
app.post("/wanotifier", async (req, res) => {
  try {
    // WANotifier body example:
    // { "message": "{{contact.last_message}}" }
    const message =
      req.body?.message ??
      req.body?.text ??
      req.body?.input ??
      "";

    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, error: "Missing message" });
    }

    const reply = await generateReply(String(message));

    // WANotifier says: "we only accept JSON responses"
    // Return JSON so you can map it in the next step.
    return res.status(200).json({
      ok: true,
      reply,
    });
  } catch (err) {
    console.error("WANOTIFIER ERROR:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================
// 2) META WEBHOOK VERIFICATION (optional)
// Meta will call GET /webhook when you verify the webhook URL.
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === WA_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// =====================
// 3) RECEIVE WHATSAPP MESSAGES FROM META (optional)
// Meta will POST incoming messages here.
// =====================
app.post("/webhook", async (req, res) => {
  // Always ACK fast
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;

    const from = message.from;
    const type = message.type;

    let userText = "";

    if (type === "text") {
      userText = message.text?.body || "";
    } else if (type === "audio") {
      const mediaId = message.audio?.id;
      if (!mediaId) return;

      const mediaUrl = await getMediaUrl(mediaId);
      const audioBuffer = await downloadMedia(mediaUrl);
      userText = await transcribeAudio(audioBuffer);
    } else {
      // ignore other types for now
      return;
    }

    if (!userText.trim()) return;

    const reply = await generateReply(userText);

    // If you want Meta->Server->Meta reply:
    // Requires WA_PHONE_NUMBER_ID + WA_ACCESS_TOKEN env vars.
    if (WA_PHONE_NUMBER_ID && WA_ACCESS_TOKEN) {
      await sendWhatsAppMessage(from, reply);
    } else {
      console.log("Reply generated but WA_* env vars missing. Reply:", reply);
    }
  } catch (err) {
    console.error("WEBHOOK ERROR:", err?.message || err);
  }
});

// =====================
// HELPERS (Meta media + OpenAI)
// =====================
async function getMediaUrl(mediaId) {
  if (!WA_ACCESS_TOKEN) throw new Error("Missing WA_ACCESS_TOKEN");
  const url = `https://graph.facebook.com/v20.0/${mediaId}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  });
  return data.url;
}

async function downloadMedia(mediaUrl) {
  if (!WA_ACCESS_TOKEN) throw new Error("Missing WA_ACCESS_TOKEN");
  const r = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  });
  return Buffer.from(r.data);
}

async function transcribeAudio(buffer) {
  const form = new FormData();
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  form.append("file", buffer, { filename: "voice.ogg" });

  const r = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      ...form.getHeaders(),
    },
  });

  return r.data.text;
}

async function generateReply(text) {
  const r = await openai.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
  });

  return r.output_text || "Sorry — please repeat your question.";
}

async function sendWhatsAppMessage(to, body) {
  if (!WA_ACCESS_TOKEN) throw new Error("Missing WA_ACCESS_TOKEN");
  if (!WA_PHONE_NUMBER_ID) throw new Error("Missing WA_PHONE_NUMBER_ID");

  const url = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    },
    {
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
    }
  );
}

// =====================
app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
