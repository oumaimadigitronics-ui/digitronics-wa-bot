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
const SYSTEM_PROMPT = `
You are DigiBot for Digitronics.ma.
Always reply in English, short and direct.
If message comes from voice note transcription, treat it like normal text.
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
