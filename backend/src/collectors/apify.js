import { config } from '../config.js';

async function runActor(actor, input, timeoutSec = 150) {
  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items?timeout=${timeoutSec}&clean=true&format=json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apifyToken}` },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout((timeoutSec + 15) * 1000),
  });
  if (!res.ok) {
    const err = new Error(`Apify ${actor} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    if ([401, 402, 403].includes(res.status)) err.noRetry = true; // bad token / no credits: retrying won't help
    throw err;
  }
  return res.json();
}

const ts = (t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : t ? Date.parse(t) || null : null);

// ---- Instagram Reels (hashtag scraper). CHECK the actor's output in Apify Console and adjust field names if needed.
export const instagramCollector = {
  async collect({ queries, limit }) {
    const items = await runActor(config.igActor, {
      hashtags: queries, resultsType: 'reels', resultsLimit: Math.ceil(limit / queries.length) + 2,
    });
    return items
      .filter((it) => it.videoUrl || it.type === 'Video' || /\/reel\//.test(it.url || ''))
      .map((it) => ({
        platform: 'instagram',
        id: it.id || it.shortCode,
        url: it.url || (it.shortCode ? `https://www.instagram.com/reel/${it.shortCode}/` : null),
        thumbnail: it.displayUrl || it.thumbnailUrl || it.imageUrl || null,
        videoUrl: it.videoUrl || null,
        caption: it.caption || '',
        author: it.ownerUsername,
        postedAt: ts(it.timestamp),
      }))
      .filter((v) => v.url);
  },
};

// ---- Meta Ad Library (video ads) through the public Ad Library search URL.
const libUrl = (q) => `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${config.metaCountry}&media_type=video&q=${encodeURIComponent(q)}&search_type=keyword_unordered`;

export const metaCollector = {
  async collect({ queries, limit }) {
    const items = await runActor(config.metaActor, {
      startUrls: queries.map((q) => ({ url: libUrl(q) })),
      resultsLimit: Math.ceil(limit / queries.length) + 2,
    });
    return items.map((it) => {
      const snap = it.snapshot || {};
      const vid = (snap.videos || [])[0] || (snap.cards || []).find((c) => c.video_hd_url || c.video_sd_url) || {};
      const id = it.adArchiveID || it.ad_archive_id || it.adArchiveId;
      return {
        platform: 'meta',
        id,
        url: it.adLibraryUrl || (id ? `https://www.facebook.com/ads/library/?id=${id}` : null),
        thumbnail: vid.video_preview_image_url || vid.videoPreviewImageUrl || null,
        videoUrl: vid.video_hd_url || vid.video_sd_url || null,
        caption: snap.body?.text || snap.body || snap.caption || snap.title || '',
        advertiser: snap.page_name || it.pageName,
        postedAt: ts(it.startDate || it.start_date),
      };
    }).filter((v) => v.url && (v.videoUrl || v.thumbnail));
  },
};
