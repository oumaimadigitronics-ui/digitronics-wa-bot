import { getOpenAI } from "../src/deps.js";

async function callOpenAIChat(messages, maxOut, model) {
  const maxTokens = Number(maxOut) || 380;
  const targetModel = model || process.env.OPENAI_MODEL || "gpt-5.2";
  const started = Date.now();
  let resp;
  try {
    resp = await getOpenAI().chat.completions.create({
      model: targetModel,
      messages,
      temperature: 0.3,
      max_completion_tokens: maxTokens,
    });
  } catch (_e) {
    resp = await getOpenAI().chat.completions.create({
      model: targetModel,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    });
  }

  const latencyMs = Date.now() - started;
  try {
    const usage = resp && resp.usage ? resp.usage : null;
    console.log(
      JSON.stringify({
        level: "info",
        msg: "openai_chat_completed",
        model: targetModel,
        latencyMs,
        usage,
      })
    );
  } catch {
    // ignore logging failures
  }

  return resp;
}

export { callOpenAIChat };
