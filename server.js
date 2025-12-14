import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import FormData from "form-data";

const app = express();
app.use(express.json());

/**
 * Health check / home route
 * This fixes "Cannot GET /" on Render
 */
app.get("/", (req, res) => {
  res.status(200).send("OK - DigiTronics WA Bot is running");
});


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const {
  PORT = 3000,
  WA_VERIFY_TOKEN,
  WA_PHONE_NUMBER_ID,
  WA_ACCESS_TOKEN,
  OPENAI_MODEL = "gpt-5.2",
  OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
} = process.env;

// TEMP system prompt (we will replace later)
const SYSTEM_PROMPT = `
You are DigiBot for Digitronics.ma.
Always reply in Moroccan Darija (latin), short and direct.
If message comes from voice note transcription, treat it like normal text.
`;

// =====================
// WEBHOOK VERIFICATION
// =====================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// =====================
// RECEIVE MESSAGES
// =====================
app.post("/webhook", async (req, res) => {
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
    }

    if (type === "audio") {
      const mediaId = message.audio?.id;
      if (!mediaId) return;

      const mediaUrl = await getMediaUrl(mediaId);
      const audioBuffer = await downloadMedia(mediaUrl);
      userText = await transcribeAudio(audioBuffer);
    }

    if (!userText.trim()) return;

    const reply = await generateReply(userText);
    await sendWhatsAppMessage(from, reply);

  } catch (err) {
    console.error("ERROR:", err.message);
  }
});

// =====================
// HELPERS
// =====================
async function getMediaUrl(mediaId) {
  const url = `https://graph.facebook.com/v20.0/${mediaId}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` }
  });
  return data.url;
}

async function downloadMedia(mediaUrl) {
  const res = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` }
  });
  return Buffer.from(res.data);
}

async function transcribeAudio(buffer) {
  const form = new FormData();
  form.append("model", OPENAI_TRANSCRIBE_MODEL);
  form.append("file", buffer, { filename: "voice.ogg" });

  const res = await axios.post(
    "https://api.openai.com/v1/audio/transcriptions",
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders()
      }
    }
  );

  return res.data.text;
}

async function generateReply(text) {
  const r = await openai.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: text }
    ]
  });

  return r.output_text || "m3lich 3awd sowlni";
}

async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v20.0/${WA_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    },
    {
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` }
    }
  );
}

// =====================
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
