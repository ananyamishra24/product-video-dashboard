import { sha1 } from './utils.js';

export const hamming = (a, b) => {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
};

export const normCaption = (s = '') => s.toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ').replace(/[#@]\S+/g, ' ')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export const shingles = (s, k = 3) => {
  const w = s.split(' ').filter(Boolean);
  if (w.length < k) return new Set(w.length ? [w.join(' ')] : []);
  const out = new Set();
  for (let i = 0; i <= w.length - k; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
};

export const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / (a.size + b.size - i);
};

export const normUrl = (u = '') => u.split('?')[0].replace(/\/$/, '').toLowerCase();
export const videoUid = (v) => (v.id ? `${v.platform}:${v.id}` : `${v.platform}:h${sha1(normUrl(v.url))}`);

// Returns 'thumbnail' | 'caption' | null
export function nearDuplicateReason(a, b, { hamMax = 6, jacMin = 0.85, minShingles = 4 } = {}) {
  if (a.phash && b.phash && hamming(a.phash, b.phash) <= hamMax) return 'thumbnail';
  const sa = shingles(a.cap || ''), sb = shingles(b.cap || '');
  if (sa.size >= minShingles && sb.size >= minShingles && jaccard(sa, sb) >= jacMin) return 'caption';
  return null;
}

/**
 * candidates: [{uid, phash?, cap}]   seen: [{uid, phash, cap}] from earlier searches
 * existing: already accepted in THIS search (same platform)
 */
export function dedupe(candidates, { seen = [], existing = [], includeSeen = false } = {}) {
  const seenUids = new Set(includeSeen ? [] : seen.map((s) => s.uid));
  const seenList = includeSeen ? [] : seen;
  const kept = [];
  const dropped = { seen: 0, exact: 0, near: 0 };
  const taken = new Set(existing.map((e) => e.uid));
  for (const c of candidates) {
    if (taken.has(c.uid)) { dropped.exact++; continue; }
    if (seenUids.has(c.uid)) { dropped.seen++; continue; }
    if (seenList.some((s) => nearDuplicateReason(c, s))) { dropped.seen++; continue; }
    if ([...existing, ...kept].some((k) => nearDuplicateReason(c, k))) { dropped.near++; continue; }
    kept.push(c); taken.add(c.uid);
  }
  return { kept, dropped };
}
