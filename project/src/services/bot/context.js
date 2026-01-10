import { detectUserLanguage } from '../lang/detectUserLanguage.js';

export function buildBotContext(body = {}, ctxIn = {}) {
  const conversationId = body.conversationId || 'unknown';
  const requestId = ctxIn?.requestId;
  const isPhotoFlow = Boolean(body?.photoFlow);
  const userText = typeof body.text === 'string' ? body.text.trim() : '';
  const preferredLang = detectUserLanguage(userText) || 'dz';

  return {
    body,
    ctxIn,
    requestId,
    conversationId,
    isPhotoFlow,
    userText,
    preferredLang,
  };
}
