import { describe, it, expect } from 'vitest';
import { hamming, normCaption, jaccard, shingles, dedupe, videoUid, nearDuplicateReason } from '../src/dedupe.js';

describe('helpers', () => {
  it('hamming', () => { expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64); expect(hamming('00000000000000ff', '0000000000000000')).toBe(8); });
  it('normCaption strips hashtags, mentions, urls, emoji', () => {
    expect(normCaption('Love this!! 😍 #fyp @bob https://x.com/a Tee')).toBe('love this tee');
  });
  it('jaccard', () => { expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3); expect(jaccard(new Set(), new Set(['a']))).toBe(0); });
  it('videoUid uses platform id, else hashed url without query', () => {
    expect(videoUid({ platform: 'instagram', id: '1' })).toBe('instagram:1');
    expect(videoUid({ platform: 'meta', url: 'https://a.com/x?utm=1' })).toBe(videoUid({ platform: 'meta', url: 'https://a.com/x/?utm=2' }));
  });
});

describe('dedupe', () => {
  const v = (uid, phash, cap = '') => ({ uid, phash, cap });
  it('removes exact duplicates inside one set', () => {
    const { kept, dropped } = dedupe([v('a', '0'.repeat(16)), v('a', 'f'.repeat(16))]);
    expect(kept).toHaveLength(1); expect(dropped.exact + dropped.near).toBe(1);
  });
  it('removes near-duplicate thumbnails (re-uploads)', () => {
    const { kept } = dedupe([v('a', '0000000000000000'), v('b', '0000000000000003')]);
    expect(kept.map((k) => k.uid)).toEqual(['a']);
  });
  it('keeps distinct thumbnails', () => {
    expect(dedupe([v('a', '0000000000000000'), v('b', 'ffffffffffffffff')]).kept).toHaveLength(2);
  });
  it('detects same ad copy under different ids', () => {
    const cap = 'shop our new oversized graphic tee today limited offer free shipping';
    expect(nearDuplicateReason(v('a', null, cap), v('b', null, cap))).toBe('caption');
  });
  it('filters videos seen in earlier searches', () => {
    const { kept, dropped } = dedupe([v('a', '0'.repeat(16)), v('c', 'f'.repeat(16))], { seen: [v('a', '0'.repeat(16))] });
    expect(kept.map((k) => k.uid)).toEqual(['c']); expect(dropped.seen).toBe(1);
  });
  it('includeSeen=true lets old videos through', () => {
    expect(dedupe([v('a', '0'.repeat(16))], { seen: [v('a', '0'.repeat(16))], includeSeen: true }).kept).toHaveLength(1);
  });
  it('respects already-accepted items', () => {
    expect(dedupe([v('a', '0'.repeat(16))], { existing: [v('a', '0'.repeat(16))] }).kept).toHaveLength(0);
  });
});
