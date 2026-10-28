import { config } from './config.js';

export const imgPart = ({ buffer, mime }) => ({ inline_data: { mime_type: mime, data: buffer.toString('base64') } });

export async function geminiJson(parts) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const err = new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    if ([400, 401, 403].includes(res.status)) err.noRetry = true;
    throw err;
  }
  const j = await res.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}
