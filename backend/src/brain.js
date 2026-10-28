import { config, mockBrain } from './config.js';
import { geminiJson, imgPart } from './gemini.js';
import { cacheGet, cacheSet } from './db.js';
import { sha1, withRetry } from './utils.js';

const PROMPT = (p) => `You are a product-vision analyst for social media video search.
Product title: "${p.title}"
Product description: "${p.description || ''}"
${p.hasImage ? 'The attached image is the product photo. Describe ONLY what you can see.' : 'No image is available; infer from the text.'}
Return JSON with exactly these keys:
{"product_type": string, "colors": string[], "prints_graphics": string, "logos": string, "text_on_product": string,
 "material": string, "shape": string,
 "keywords": string[]            // 6-10 short search keywords
 "hashtags": string[]            // 10-15 Instagram hashtags WITHOUT '#', lowercase, no spaces, specific first then broader
 "search_phrases": string[]}     // 8-12 phrases suited to Meta Ad Library text search`;

export async function analyzeProduct(product, image) {
  const key = 'brain:' + sha1(`${product.title}|${product.description}|${image ? sha1(image.buffer.toString('base64')) : ''}`);
  const cached = cacheGet(key);
  if (cached) return { ...cached, _cached: true };

  let attrs;
  if (mockBrain) attrs = mockAttrs(product.title);
  else {
    const parts = [{ text: PROMPT({ ...product, hasImage: !!image }) }];
    if (image) parts.push(imgPart(image));
    attrs = await withRetry(() => geminiJson(parts), { retries: 2, timeoutMs: 70000, label: 'vision analysis' });
  }
  attrs = sanitize(attrs, product.title);
  cacheSet(key, attrs);
  return attrs;
}

function mockAttrs(title) {
  const words = title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
  return {
    product_type: words.slice(-2).join(' '), colors: [], prints_graphics: '(mock mode - no vision key)', logos: '', text_on_product: '',
    material: '', shape: '', keywords: words, hashtags: [words.join(''), ...words], search_phrases: [title, ...words],
  };
}

const arr = (x) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
function sanitize(a, title) {
  const out = {
    product_type: String(a.product_type || title), colors: arr(a.colors), prints_graphics: String(a.prints_graphics || ''),
    logos: String(a.logos || ''), text_on_product: String(a.text_on_product || ''), material: String(a.material || ''),
    shape: String(a.shape || ''), keywords: arr(a.keywords), search_phrases: arr(a.search_phrases),
    hashtags: arr(a.hashtags).map((h) => h.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()).filter(Boolean),
  };
  return out;
}

const SUFFIXES = ['review', 'unboxing', 'haul', 'tryon', 'ad', 'new', 'trending', 'india'];
const uniq = (a) => [...new Set(a.filter(Boolean))];

// Pure function: which queries to run in a given expansion round.
export function queriesFor(attrs, platform, round) {
  const base = (attrs.hashtags[0] || attrs.product_type.replace(/\s+/g, '').toLowerCase());
  if (platform === 'instagram') {
    const pool = uniq([...attrs.hashtags, ...SUFFIXES.map((s) => base + s)]);
    return pool.slice(round * 4, round * 4 + 4);
  }
  const colorType = attrs.colors[0] ? `${attrs.colors[0]} ${attrs.product_type}` : '';
  const pool = uniq([...attrs.search_phrases, colorType, ...attrs.keywords, ...SUFFIXES.map((s) => `${attrs.product_type} ${s}`)]);
  return pool.slice(round * 3, round * 3 + 3);
}
