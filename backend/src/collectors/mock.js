import { sha1 } from '../utils.js';

// Deterministic fake data so you can build + demo the whole UI with zero API keys.
// Item #7 of every query shares item #0's thumbnail under a different id => exercises near-dup detection.
function make(platform, q, i) {
  const h = sha1(q).slice(0, 6);
  const seedIdx = i === 7 ? 0 : i;
  const id = `mock_${platform}_${h}_${i}`;
  return {
    platform, id,
    url: platform === 'instagram' ? `https://www.instagram.com/reel/${id}/` : `https://www.facebook.com/ads/library/?id=${id}`,
    thumbnail: `https://picsum.photos/seed/${platform}${h}${seedIdx}/360/640`,
    videoUrl: null,
    caption: platform === 'instagram' ? `Reel ${i} about ${q} #${q} #fyp` : `Shop ${q} today - limited offer ${h}${i}`,
    advertiser: platform === 'meta' ? `Brand ${h}` : undefined,
    author: platform === 'instagram' ? `creator_${h}` : undefined,
    postedAt: Date.now() - (i + 1) * 86400000 * 3,
  };
}
export const mockCollector = (platform) => ({
  async collect({ queries, limit }) {
    return queries.flatMap((q) => Array.from({ length: 8 }, (_, i) => make(platform, q, i))).slice(0, limit);
  },
});
