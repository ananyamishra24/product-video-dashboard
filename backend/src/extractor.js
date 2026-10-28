import * as cheerio from 'cheerio';
import { safeFetch, readLimited } from './ssrf.js';

export async function extractProduct(url) {
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`Product page returned HTTP ${res.status} (site may block bots - try a keyword or upload the product image)`);
  const html = (await readLimited(res, 3e6)).toString('utf8');
  const $ = cheerio.load(html);
  const meta = (p) => $(`meta[property="${p}"]`).attr('content') || $(`meta[name="${p}"]`).attr('content');

  let ld = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).text());
      const arr = [].concat(j, j['@graph'] || []);
      const p = arr.find((x) => x && [].concat(x['@type'] || []).includes('Product'));
      if (p) ld = p;
    } catch { /* ignore bad JSON-LD */ }
  });

  const title = (ld.name || meta('og:title') || $('title').text() || '').trim();
  if (!title) throw new Error('Could not find a product title on that page');
  const description = (ld.description || meta('og:description') || meta('description') || '').trim().slice(0, 500);
  let image = [].concat(ld.image || [])[0];
  if (image && typeof image === 'object') image = image.url;
  image = image || meta('og:image');
  return { title, description, imageUrl: image ? new URL(image, url).toString() : null, sourceUrl: url };
}

export async function fetchImage(url) {
  const res = await safeFetch(url, { headers: { accept: 'image/*' } });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!mime.startsWith('image/')) throw new Error('Not an image');
  return { buffer: await readLimited(res, 8e6), mime };
}
