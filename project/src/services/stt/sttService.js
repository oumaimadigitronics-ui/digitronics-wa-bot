const DEFAULT_DARIJA_PROMPT = 'الدارجة المغربية: ثمن، توصيل، ضمان، شحال، بغيت، كاين، ماكاينش، آش من، ماركة، TV، climatiseur، هاتف.';
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';

function parseBase64Audio(base64) {
  if (!base64) return { buffer: null, mimeType: '' };
  const match = base64.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
  }
  return { buffer: Buffer.from(base64, 'base64'), mimeType: '' };
}

export async function transcribeAudio({ url, base64, mimeType, preferredLangHint, requestId, cfg, fetcher = fetch } = {}) {
  const apiKey = cfg?.OPENAI_API_KEY;
  if (!apiKey) return null;
  let audioBuffer = null;
  let resolvedMimeType = mimeType || '';

  if (base64) {
    const parsed = parseBase64Audio(base64);
    audioBuffer = parsed.buffer;
    if (!resolvedMimeType) resolvedMimeType = parsed.mimeType;
  } else if (url) {
    const response = await fetcher(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    audioBuffer = Buffer.from(arrayBuffer);
    if (!resolvedMimeType) resolvedMimeType = response.headers.get('content-type') || '';
  }

  if (!audioBuffer) return null;

  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: resolvedMimeType || 'audio/mpeg' });
  form.append('file', blob, 'audio');
  form.append('model', cfg?.OPENAI_STT_MODEL || DEFAULT_MODEL);
  if (preferredLangHint) form.append('language', preferredLangHint);
  form.append('prompt', cfg?.OPENAI_STT_DARIJA_PROMPT || DEFAULT_DARIJA_PROMPT);

  const resp = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'x-request-id': requestId || '',
    },
    body: form,
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  const text = String(data.text || '').trim();
  return text || null;
}
