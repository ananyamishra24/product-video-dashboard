import { mockCollectors } from '../config.js';
import { mockCollector } from './mock.js';
import { instagramCollector, metaCollector } from './apify.js';

// Common interface: collect({queries, limit}) -> Video[]. Swap providers here only.
export const collectors = mockCollectors
  ? { instagram: mockCollector('instagram'), meta: mockCollector('meta') }
  : { instagram: instagramCollector, meta: metaCollector };
