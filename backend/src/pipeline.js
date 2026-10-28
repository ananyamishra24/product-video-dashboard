import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { db, cacheGet, cacheSet } from './db.js';
import { log } from './logger.js';
import { extractProduct, fetchImage } from './extractor.js';
import { analyzeProduct, queriesFor } from './brain.js';
import { collectors } from './collectors/index.js';
import { dedupe, videoUid, normCaption } from './dedupe.js';
import { dhash, shrink } from './phash.js';
import { scoreBatch, isLowMatch } from './scorer.js';
import { mapLimit, withRetry, sha1 } from './utils.js';

const MAX_ROUNDS = 4;      // shortfall expansion rounds per source
const EXTRA = 4;           // score a few more than 20 so low matches don't cause a shortfall alone
const LABEL = { instagram: 'Instagram', meta: 'Meta Ad Library' };

// ---------- tiny in-process event bus + job queue (BullMQ+Redis is the production upgrade) ----------
const bus = new EventEmitter();
bus.setMaxListeners(100);
const events = new Map();
export const getEvents = (id) => events.get(id) || [];
export const subscribe = (id, fn) => { bus.on(id, fn); return () => bus.off(id, fn); };
const makeEmit = (id) => { events.set(id, []); return (type, data) => { const e = { type, data }; events.get(id).push(e); bus.emit(id, e); }; };

const queue = []; let active = 0; const MAX_JOBS = 2;
export function enqueue(job) { queue.push(job); pump(); }
function pump() {
  while (active < MAX_JOBS && queue.length) {
    const job = queue.shift(); active++;
    runSearch(job).catch((e) => log.error({ err: e.message }, 'unhandled pipeline error')).finally(() => { active--; pump(); });
  }
}

// ---------- helpers ----------
function decodeImage(s) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(s);
  return { buffer: Buffer.from(m ? m[2] : s, 'base64'), mime: m ? m[1] : 'image/jpeg' };
}

async function resolveContext(body, emit) {
  let product;
  if (body.type === 'url') {
    emit('progress', { step: 'fetch', message: 'Fetching product page…' });
    const key = 'page:' + sha1(body.input);
    product = cacheGet(key);
    if (!product) { product = await extractProduct(body.input); cacheSet(key, product); }
  } else product = { title: body.input, description: '' };

  let image = null;
  if (body.imageBase64) image = decodeImage(body.imageBase64);
  else if (product.imageUrl) {
    try { image = await fetchImage(product.imageUrl); }
    catch (e) { emit('progress', { step: 'fetch', message: `Could not download product image (${e.message}); using text only` }); }
  }
  if (image) {
    image = await shrink(image.buffer, 512);
    if (body.imageBase64) product.imageUrl = `data:image/jpeg;base64,${(await shrink(image.buffer, 256)).buffer.toString('base64')}`;
  }
  return { product, image };
}

function loadSeen(platform) {
  return db.prepare('SELECT uid, phash, cap FROM seen WHERE platform=?').all(platform);
}

async function processSource(platform, ctx, emit) {
  const label = LABEL[platform];
  const stats = { target: config.target, count: 0, matched: 0, lowMatch: 0, fetched: 0, droppedSeen: 0, droppedNear: 0, rounds: 0, error: null, shortfall: false, note: '' };
  const kept = [];
  const handled = new Set();
  const seen = ctx.includeSeen ? [] : loadSeen(platform);
  const seenUids = new Set(seen.map((s) => s.uid));

  for (let round = 0; round < MAX_ROUNDS && kept.length < config.target; round++) {
    const queries = queriesFor(ctx.attrs, platform, round);
    if (!queries.length) { stats.note = 'Ran out of query variations. '; break; }
    stats.rounds = round + 1;
    emit('progress', { step: platform, message: `${label}: round ${round + 1}${round ? ' (widening search)' : ''} - ${queries.join(', ')}` });

    let raw;
    try {
      raw = await withRetry(() => collectors[platform].collect({ queries, limit: 30 }), { retries: 2, timeoutMs: 170000, label: `${label} collect` });
    } catch (e) {
      stats.error = e.message; log.warn({ platform, err: e.message }, 'collector failed');
      emit('progress', { step: platform, message: `${label}: ${e.message}` });
      break;
    }
    stats.fetched += raw.length;

    // cheap exact filter BEFORE downloading thumbnails
    const fresh = raw.map((v) => ({ ...v, uid: videoUid(v) }))
      .filter((v) => !handled.has(v.uid) && !seenUids.has(v.uid));
    raw.forEach((v) => handled.add(videoUid(v)));
    stats.droppedSeen += raw.length - fresh.length;

    const need = config.target + EXTRA - kept.length;
    const prepared = (await mapLimit(fresh.slice(0, need * 2), 6, async (v) => {
      try {
        if (!v.thumbnail) return { ...v, thumb: null, cap: normCaption(v.caption) };
        const { buffer } = await fetchImage(v.thumbnail);
        const thumb = await shrink(buffer, 512);
        return { ...v, thumb, phash: await dhash(thumb.buffer), cap: normCaption(v.caption) };
      } catch { return { ...v, thumb: null, cap: normCaption(v.caption) }; }
    }));

    const { kept: fresh2, dropped } = dedupe(prepared, { seen, existing: kept, includeSeen: ctx.includeSeen });
    stats.droppedSeen += dropped.seen; stats.droppedNear += dropped.near + dropped.exact;
    const batch = fresh2.slice(0, need);
    if (!batch.length) continue;

    emit('progress', { step: 'score', message: `Scoring ${batch.length} ${label} videos against the product…` });
    const groups = []; for (let i = 0; i < batch.length; i += 4) groups.push(batch.slice(i, i + 4));
    await mapLimit(groups, 3, async (g) => {
      let scores;
      try { scores = await scoreBatch(ctx.product, ctx.attrs, ctx.image, g); }
      catch (e) { log.warn({ err: e.message }, 'scoring failed'); scores = g.map(() => ({ score: 0, reason: 'Scoring unavailable: ' + e.message.slice(0, 80), sameProduct: false })); }
      g.forEach((v, i) => { v.score = scores[i].score; v.reason = scores[i].reason; v.lowMatch = isLowMatch(v.score); });
    });
    kept.push(...batch);
    emit('progress', { step: platform, message: `${label}: ${Math.min(kept.length, config.target)}/${config.target} collected` });
  }

  kept.sort((a, b) => b.score - a.score);
  kept.splice(config.target);
  stats.count = kept.length;
  stats.matched = kept.filter((v) => !v.lowMatch).length;
  stats.lowMatch = stats.count - stats.matched;
  stats.shortfall = kept.length < config.target;
  if (stats.shortfall) stats.note += `Only ${kept.length}/${config.target} unique videos after ${stats.rounds} round(s).${stats.error ? ' Source error: ' + stats.error : ' The source returned limited results.'}`;
  return { videos: kept, stats };
}

// ---------- the pipeline ----------
export async function runSearch({ id, body }) {
  const emit = makeEmit(id);
  const setStatus = (status, extra = {}) => db.prepare('UPDATE searches SET status=?, product=COALESCE(?,product), stats=COALESCE(?,stats), error=COALESCE(?,error) WHERE id=?')
    .run(status, extra.product ? JSON.stringify(extra.product) : null, extra.stats ? JSON.stringify(extra.stats) : null, extra.error || null, id);
  try {
    setStatus('running');
    const { product, image } = await resolveContext(body, emit);
    emit('progress', { step: 'analyse', message: image ? 'Analysing product image…' : 'Analysing product text (no image)…' });
    const attrs = await analyzeProduct(product, image);
    const productOut = { ...product, attrs };
    setStatus('running', { product: productOut });
    emit('product', productOut);

    const ctx = { product, attrs, image, includeSeen: !!body.includeSeen };
    const [ig, meta] = await Promise.all([processSource('instagram', ctx, emit), processSource('meta', ctx, emit)]);

    emit('progress', { step: 'save', message: 'Saving results…' });
    const insR = db.prepare('INSERT OR REPLACE INTO results VALUES(?,?,?,?,?)');
    const insS = db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?,?,?,?)');
    db.transaction(() => {
      for (const v of [...ig.videos, ...meta.videos]) {
        const { thumb, phash, cap, ...data } = v;
        insR.run(id, v.uid, v.platform, v.score, JSON.stringify(data));
        insS.run(v.uid, v.platform, phash || null, cap || '', id);
      }
    })();
    setStatus('done', { stats: { instagram: ig.stats, meta: meta.stats, threshold: config.threshold } });
    emit('done', { id });
  } catch (e) {
    log.error({ err: e.message, id }, 'search failed');
    setStatus('error', { error: e.message });
    emit('error', { message: e.message });
  } finally {
    setTimeout(() => { events.delete(id); }, 30 * 60 * 1000).unref();
  }
}
