import { config, mockBrain } from './config.js';
import { geminiJson, imgPart } from './gemini.js';
import { sha1, withRetry } from './utils.js';

export const clampScore = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
export const isLowMatch = (score, threshold = config.threshold) => score < threshold;

// Make LLM output safe: always returns exactly `count` entries.
export function normalizeScores(raw, count) {
  const list = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];
  return Array.from({ length: count }, (_, i) => {
    const r = list.find((x) => Number(x?.index) === i);
    if (!r) return { score: 0, reason: 'No score returned by the model', sameProduct: false };
    return { score: clampScore(r.score), reason: String(r.reason || '').slice(0, 160) || 'No reason given', sameProduct: !!r.same_product };
  });
}

const RUBRIC = `Scoring rubric (0-100):
85-100 = same exact product (print/graphic, colour, logo, shape all match)
60-84  = very close visual match (same style/colour, small differences)
30-59  = same category but a different design
0-29   = different product or no product visible
Ignore text overlays, filters and people; judge the PRODUCT. Be strict.`;

// items: [{thumb:{buffer,mime}|null, caption}]
export async function scoreBatch(product, attrs, productImage, items) {
  const out = items.map(() => null);
  const withThumb = items.map((it, i) => [it, i]).filter(([it]) => it.thumb);
  items.forEach((it, i) => { if (!it.thumb) out[i] = { score: 0, reason: 'No thumbnail available to compare', sameProduct: false }; });
  if (!withThumb.length) return out;

  let scored;
  if (mockBrain) {
    scored = withThumb.map(([it]) => {
      const n = parseInt(sha1(it.thumb.buffer.toString('base64', 0, 200)).slice(0, 4), 16) % 66;
      return { score: 30 + n, reason: 'Mock score (add GEMINI_API_KEY for real image matching)', sameProduct: n > 40 };
    });
  } else {
    const parts = [{ text: `Product: "${product.title}". Attributes: ${JSON.stringify(attrs)}.\n${productImage ? 'Image 0 is the REFERENCE product photo.' : 'No reference photo; compare against the text attributes.'}\nThe next ${withThumb.length} images are video thumbnails numbered ${productImage ? '1..' : '0..'} in order.\n${RUBRIC}\nReturn JSON: {"results":[{"index":<thumbnail number as listed>,"score":int,"same_product":bool,"reason":"<=15 words, e.g. same print and colour, worn by a model"}]}` }];
    if (productImage) parts.push({ text: 'Reference:' }, imgPart(productImage));
    withThumb.forEach(([it], k) => { parts.push({ text: `Thumbnail ${productImage ? k + 1 : k}:` }, imgPart(it.thumb)); });
    const raw = await withRetry(() => geminiJson(parts), { retries: 2, timeoutMs: 70000, label: 'scoring' });
    // remap to 0-based positions
    const shift = productImage ? 1 : 0;
    const list = (raw.results || raw || []).map((r) => ({ ...r, index: Number(r.index) - shift }));
    scored = normalizeScores(list, withThumb.length);
  }
  withThumb.forEach(([, i], k) => { out[i] = scored[k]; });
  return out;
}
