/**
 * Vision Service - Image Description
 * 
 * Utilities for converting images to data URLs and getting AI descriptions
 */

/**
 * Convert image buffer or URL to data URL string suitable for vision APIs
 * 
 * @param {Buffer|Uint8Array|string|{url: string}} image - Image data
 * @param {string} mime - MIME type (default: "image/jpeg")
 * @returns {string} Data URL or HTTP(S) URL
 * @throws {Error} If image format is unsupported
 */
export function toImageUrlString(image, mime = "image/jpeg") {
  if (typeof image === "string") {
    if (/^(https?:|data:)/i.test(image)) return image;
    throw new Error("Image string must start with http or data:");
  }

  if (Buffer.isBuffer(image) || image instanceof Uint8Array) {
    const buf = Buffer.isBuffer(image) ? image : Buffer.from(image);
    const b64 = buf.toString("base64");
    return `data:${mime};base64,${b64}`;
  }

  if (image && typeof image === "object") {
    if (typeof image.url === "string") return toImageUrlString(image.url, mime);
    console.error("Invalid image object keys:", Object.keys(image || {}));
    throw new Error("Unsupported image object for vision: expected string, Buffer/Uint8Array, or { url }");
  }

  throw new Error("Unsupported image type for vision input");
}

/**
 * Check if a model name indicates vision capabilities
 * 
 * @param {string} modelName - Model name to check
 * @returns {boolean} True if model supports vision
 */
export function isVisionCapableModel(modelName) {
  const m = String(modelName || "").toLowerCase();
  return /gpt-4o|gpt-4\.1|o3|vision/.test(m);
}

/**
 * Select an appropriate vision model from available options
 * Uses configured vision model, falls back to default model or gpt-4o-mini
 * 
 * @param {Object} cfg - Configuration object with openaiVisionModel
 * @param {string} defaultModel - Default model to use
 * @returns {string} Selected model name
 */
export function pickVisionModel(cfg, defaultModel) {
  if (cfg && cfg.openaiVisionModel && isVisionCapableModel(cfg.openaiVisionModel)) {
    return cfg.openaiVisionModel;
  }
  if (defaultModel && isVisionCapableModel(defaultModel)) {
    return defaultModel;
  }
  // Default to a known vision-capable model if none provided
  return "gpt-4o-mini";
}

/**
 * Get a brief description of an image using OpenAI vision API
 * 
 * @param {Object} params - Parameters
 * @param {Buffer|string} params.image - Image buffer or URL
 * @param {string} params.model - Model to use
 * @param {Object} openaiClient - OpenAI client instance
 * @returns {Promise<string>} Description text from the model
 */
export async function describeImage({ image, model }, openaiClient) {
  const imageUrl = toImageUrlString(image);
  console.log("vision image typeof:", typeof image, "isBuffer:", Buffer.isBuffer(image));
  if (typeof imageUrl === "string" && /^(data:|https?:)/i.test(imageUrl)) {
    console.log("vision image_url preview:", imageUrl.slice(0, 80));
  }
  
  const resp = await openaiClient.responses.create({
    model: model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract brand/model/size/category + any visible text. Return ONE compact line. No URLs. No question marks.",
          },
          { type: "input_image", image_url: imageUrl },
        ],
      },
    ],
  });

  const outText =
    (resp && (resp.output_text || resp.text)) ||
    (resp &&
      resp.output &&
      Array.isArray(resp.output) &&
      resp.output[0] &&
      (resp.output[0].content || resp.output[0].text)) ||
    "";
  return String(outText || "").trim();
}
