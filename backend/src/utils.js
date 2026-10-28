import { createHash } from 'node:crypto';
export const sha1 = (s) => createHash('sha1').update(s).digest('hex');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(p, ms, label = 'operation') {
  let t;
  return Promise.race([
    p,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

// Exponential backoff retry. Set err.noRetry = true to stop early (e.g. bad token).
export async function withRetry(fn, { retries = 2, baseMs = 800, timeoutMs = 60000, label = 'operation' } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await withTimeout(fn(), timeoutMs, label); }
    catch (e) { last = e; if (e.noRetry) break; if (i < retries) await sleep(baseMs * 2 ** i); }
  }
  throw last;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
