import { describe, it, expect } from 'vitest';
import { clampScore, isLowMatch, normalizeScores } from '../src/scorer.js';
import { queriesFor } from '../src/brain.js';

describe('scoring', () => {
  it('clamps', () => { expect(clampScore(150)).toBe(100); expect(clampScore(-4)).toBe(0); expect(clampScore('abc')).toBe(0); expect(clampScore(72.6)).toBe(73); });
  it('threshold', () => { expect(isLowMatch(59, 60)).toBe(true); expect(isLowMatch(60, 60)).toBe(false); });
  it('normalizeScores always returns count entries, fills gaps', () => {
    const out = normalizeScores({ results: [{ index: 1, score: 88, reason: 'same print', same_product: true }] }, 3);
    expect(out).toHaveLength(3); expect(out[1].score).toBe(88); expect(out[0].score).toBe(0); expect(out[2].reason).toMatch(/No score/);
  });
  it('survives garbage', () => { expect(normalizeScores(null, 2)).toHaveLength(2); });
});

describe('queriesFor', () => {
  const attrs = { product_type: 'graphic tee', colors: ['black'], hashtags: ['graphictee', 'oversizedtee', 'streetwear', 'tees', 'mensfashion', 'ootd'], keywords: ['tee'], search_phrases: ['oversized graphic tee', 'black tee'] };
  it('gives different queries each round', () => {
    const a = queriesFor(attrs, 'instagram', 0), b = queriesFor(attrs, 'instagram', 1);
    expect(a).toHaveLength(4); expect(b.some((x) => a.includes(x))).toBe(false);
  });
  it('meta uses phrases', () => { expect(queriesFor(attrs, 'meta', 0)).toContain('oversized graphic tee'); });
});
