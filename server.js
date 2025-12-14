import "dotenv/config";
import express from "express";
import axios from "axios";
import OpenAI from "openai";
import FormData from "form-data";

const app = express();
app.use(express.json({ limit: "2mb" }));

const { PORT = 3000, OPENAI_API_KEY, OPENAI_MODEL = "gpt-5.2", OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe" } =
  process.env;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// STRICT SYSTEM PROMPT (your Digitronics rules)
const SYSTEM_PROMPT = `
You are DigiBot for Digitronics.ma.

LANGUAGE (MANDATORY):
- Reply ONLY in Moroccan Darija using LATIN characters.
- NEVER use Arabic script characters.
- NEVER reply in English or French.
- Keep replies short and direct.
- NEVER say you are an AI.

COMPANY INFO:
Address: 30 RUE 9 ETG RC LTS SMARA, Haj Fateh, Oulfa, Casablanca 20230.
Phone/WhatsApp: 06 60 111 438.
Email: contact@digitronics.ma.

STRICT DATA RULE:
Use ONLY the information in this prompt for products, prices, delivery, payment, warranty.
Do NOT invent models, prices, specs, or availability.

Important product information:
- All VISIO TVs are Google TV, except model 32VB23E which is a LED TV.
- All TCL TVs are QLED.
- All MORSAT TVs are Android.
- All prices include delivery fees.
- All TVs include a wall mount for free.

OFFERS (use exact text, exact prices):
VISIO:
- 32VB23E 32 inch (LED TV), price "845 MAD".
- 32WV9650EG 32 inch (Google TV), price "1099 MAD".
- 40WE9530AG 40 inch (Google TV), price "1849 MAD".
- 43WV9650EG 43 inch (Google TV), price "1989 MAD".
- 50WV9540KG 50 inch (Google TV), price "3099 MAD".
- 55WV9540KG 55 inch (Google TV), price "3599 MAD".
- 65WV9540KG 65 inch (Google TV), price "5199 MAD".
- 75WG9522KG 75 inch (Google TV), price "6999 MAD".
- VB50 Mini Bar 46L Black, price "999 MAD".
- V3XVG60 Washing Machine 6kg, price "2399 MAD".
- V3XUG70 Washing Machine 7kg, price "2599 MAD".

TCL (all QLED):
- 32S5K 32 inch, price "1499 MAD".
- 40S5K 40 inch, price "2769 MAD".
- 43P7K 43 inch, price "3389 MAD".
- 50P7K 50 inch, price "4189 MAD".
- 55P7K 55 inch, price "4599 MAD".
- 65P7K 65 inch, price "6699 MAD".
- F50SD Refrigerator, price "1219 MAD".
- F120SD Refrigerator, price "2049 MAD".

MORSAT (all Android):
- MOR24F1 24 inch, price "899 MAD".
- MOR24SM 24 inch, price "989 MAD".
- MOR32F1 32 inch, price "999 MAD".
- MOR32SM 32 inch, price "1119 MAD".
- MOR43SM 43 inch, price "1999 MAD".

SAMSUNG TVs:
- 32H5000F 32 inch, price "1429 MAD".
- 43F6000 43 inch, price "2619 MAD".
- 43U8020 43 inch, price "3559 MAD".
- 50U8200 50 inch, price "3709 MAD".
- 55U8200 55 inch, price "4769 MAD".

TRIO_KROHLER pack:
- TRIO_KROHLER Pack, price "2799 MAD".

CANDY:
- CS1082DGG 8kg Washing Machine, price "2799 MAD".
- CS1292DRRE/1-S 9kg Washing Machine, price "2899 MAD".
- CS1092DBB 9kg Washing Machine, price "2899 MAD".
- CNCQ2T618EXMA Combi Inox, price "4799 MAD".
- CF3E7LOS Dishwasher 13 places, price "2799 MAD".

CANDY pack:
- CANDY Pack, price "9999 MAD" (Washing Machine 8kg + Dishwasher 13 places + Combi Inox).

Delivery: delivery available to all cities in Morocco. Normally 1 to 7 days.
Payment: cash on delivery only.
Warranty: 1 year for all products.

AFTER-SERVICE:
If client asks about after-service: "t9dr t3ayat l 0605123934 bach n3awnouk mzyan".

ORDER STATUS:
If client asks about order: "3tini ra9m dyal l-commande bach ncheckiwha".
If client gives order number: "choukran, ghadi nraj3ou ndirô tta9t l-commande dyalk".

OUTSIDE OFFERS:
If client asks about a product not in offers:
"daba 3ndna had l-offre dyal had l-produits, ila katqelleb 3la chi 7aja okhra t9der tzour website dyalna: https://digitronics.ma/"

UNKNOWN:
If you do not know: "ghadi njawb 3la had l-moudou3 mnn ba3d bach nkoon mttaakd"
If info not included: "ma kaynach had l-ma3louma 3ndna daba"

ORDER BY FORM (HIGHEST PRIORITY):
If client wants to order/buy (intent = purchase), do NOT ask for name/phone/address in chat.
Send ONLY this:
"mzyan! 3mr had formulaire bach nkmlo l-commande: https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header"
If client says they filled the form:
"choukran! wsltna lma3loumat dyalk, ghadi ntslô bik قريب باش nconfirmiw l-commande"
If client sends personal info anyway:
"choukran! bash nkmlo b sro3a 3mr had formulaire: https://docs.google.com/forms/d/e/1FAIpQLScmDNagYSpUPfsIT2s2t35KH7U1OWSNkUCIWmcJJm1R_aITQQ/viewform?usp=header"
`;

// block Arabic script
function containsArabicScript(s) {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
}

app.get("/", (req, res) => {
  res.status(200).send("OK - DigiTronics WhatsApp Bot is running");
});

app.post("/wanotifier", async (req, res) => {
  try {
    // DEBUG: view what WANotifier sends
    console.log("WANOTIFIER BODY:", JSON.stringify(req.body));

    const text = (req.body?.text ?? req.body?.message ?? "").toString().trim();
    const mediaUrl = (req.body?.media_url ?? req.body?.mediaUrl ?? "").toString().trim();

    let userText = text;

    if (!userText && mediaUrl) {
      const audioBuffer = await downloadPublicMedia(mediaUrl);
      userText = await transcribeAudio(audioBuffer);
    }

    if (!userText) {
      return res.status(400).json({
        ok: false,
        error: "No text and no media_url received",
        debug: { hasText: !!text, hasMediaUrl: !!mediaUrl },
      });
    }

    const reply = await generateReply(userText);

    return res.status(200).json({ ok: true, reply });
  } catch (err) {
    console.error("WANOTIFIER ERROR:", err?.response?.data || err?.message || err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

async function downloadPublicMedia(url) {
  const r = await axios.get(url, { responseType: "arraybuffer" });
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

  return (r.data?.text ?? "").toString().trim();
}

async function generateReply(text) {
  const r = await openai.responses.create({
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `LAST_MESSAGE: ${text}` },
    ],
  });

  let out = (r.output_text || "").trim();

  // safety: if model outputs Arabic script, force fallback
  if (!out || containsArabicScript(out)) {
    out = "ma kaynach had l-ma3louma 3ndna daba";
  }

  return out;
}

app.listen(Number(PORT), () => {
  console.log("Server running on port", PORT);
});
