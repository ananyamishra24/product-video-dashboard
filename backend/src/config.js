import 'dotenv/config';
export const config = {
  port: Number(process.env.PORT) || 4000,
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  apifyToken: process.env.APIFY_TOKEN || '',
  igActor: process.env.APIFY_IG_ACTOR || 'apify/instagram-hashtag-scraper',
  metaActor: process.env.APIFY_META_ACTOR || 'apify/facebook-ads-scraper',
  metaCountry: process.env.META_COUNTRY || 'IN',
  threshold: Number(process.env.MATCH_THRESHOLD) || 60,
  target: 20,
};
export const mockBrain = !config.geminiKey;
export const mockCollectors = !config.apifyToken;
