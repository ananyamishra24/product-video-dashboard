# Product Video Discovery Dashboard

Type a product name or paste a product link -> get **20 Instagram Reels + 20 Meta Ad Library video ads**, each scored 0-100 by how closely it matches the product photo, with a reason shown on every card.

**Stack:** Node.js (Express) · React (Vite) · SQLite · Gemini vision · Apify (data provider) · SSE for live progress · Docker Compose

## Quick start (no keys needed - mock mode)

```bash
# terminal 1
cd backend && cp .env.example .env && npm install && npm run dev
# terminal 2
cd frontend && npm install && npm run dev      # open http://localhost:5173
```
With no keys, the app runs on **mock collectors + mock scoring** so you can see the full flow (progress, 20/20 counters, dedupe, repeat search). Add keys to get real data:

| Key | Where to get it (free) | Effect |
|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Real image analysis + match scoring |
| `APIFY_TOKEN` | https://console.apify.com -> Settings -> Integrations | Real Instagram + Meta Ad Library data |

One command with Docker: `docker compose up --build` -> http://localhost:8080 (needs `backend/.env`).
Tests: `cd backend && npm test`. 5-product evidence table: `npm run eval` (API running).

## Architecture
```
React --SSE/REST--> Express API --> in-process job queue (max 2 jobs) --> pipeline
 pipeline: URL extractor (SSRF-safe, cached) -> vision brain (cached) -> attributes -> queries/hashtags
           -> [Instagram collector || Meta collector]  (parallel, timeout + retry + isolation)
           -> exact filter -> thumbnail download + dHash -> dedupe (history + in-set)
           -> vision scoring (product photo vs thumbnails, batches of 4) -> shortfall loop (<=4 rounds)
           -> SQLite (searches, results, seen, cache)
```
Why these choices: SQLite = zero setup, enough for history + dedupe. SSE = simplest one-way progress. Express + zod = small and validated. In-process queue keeps setup to one command; **BullMQ + Redis** is the drop-in upgrade (same `enqueue(job)` shape).

## How each source is collected
- **Instagram Reels:** Instagram has no public keyword-search API for Reels (Graph API hashtag search is Business-only and capped). I use an **Apify hashtag scraper** behind a `Collector` interface (`collectors/apify.js`); the brain supplies hashtags.
- **Meta Ad Library:** the official API mostly returns political/social-issue ads, not commercial video ads in India. I use an **Apify Ad Library scraper** pointed at the public Ad Library search URL with `media_type=video`.
- **Failure handling:** each source runs in isolation (one failing never fails the search), with a 170 s timeout and 2 retries with exponential backoff. Bad token / no credits (401/402/403) stops retrying immediately. Items with no thumbnail still count but score 0 and are marked.
- **Shortfall (<20 usable):** up to 4 rounds, each using new hashtags / phrases (`queriesFor`) and more results. If still short, the UI shows `14/20` plus a yellow note with the reason - never a silent failure.
- TikTok (bonus) is not implemented; it would be a third collector behind its own toggle.

## Image-analysis brain
1. **Attribute extraction:** Gemini (vision, JSON output) reads the product photo -> type, colours, prints/graphics, logos, on-product text, material, shape, keywords, hashtags, ad-search phrases. *Why Gemini:* free tier, strong vision, cheap, supports multiple images per request.
2. **Query generation:** hashtags -> Instagram; phrases -> Meta; later rounds add new variants.
3. **Scoring:** the product photo + 4 video thumbnails per call; model returns `score`, `same_product`, `reason` using a fixed rubric (85+ exact, 60-84 very close, 30-59 same category, <30 different).
4. **Threshold:** `MATCH_THRESHOLD=60`. Below it a video is greyed and tagged **Low match** (not hidden; there is a "Hide low matches" filter). 60 = "very close" in the rubric.
5. If no product image exists (keyword search, no upload), scoring compares thumbnails against the text attributes - less accurate; upload a photo for best results.

## De-duplication
- **Exact:** `platform:video_id`, else SHA-1 of the normalised URL (no query string / trailing slash). Stored in `seen` with the search id.
- **Near-duplicates:** 64-bit **dHash** of thumbnail, Hamming distance <= 6 (reposts/re-uploads); OR caption shingle (3-word) **Jaccard >= 0.85** with >= 4 shingles (same ad copy under different IDs).
- **Across searches:** everything returned is saved to `seen`; new searches filter against it unless **Show previously seen** is ticked. Old results are always reachable from Search history.
- **Refill:** if dedupe leaves < 20, the shortfall loop fetches more with expanded queries.
- Logic lives in `backend/src/dedupe.js` (pure functions, unit-tested).

## Backend security / quality
Zod input validation · SSRF guard (http/https only, DNS resolved and checked against private/loopback/link-local ranges, every redirect re-checked, size + time limits) · product-page and vision analysis cached 7 days · secrets only in env · structured pino logs · parallel collectors with `Promise.all` over isolated, never-throwing sources.

## Test evidence (fill in after `npm run eval` with real keys)
| Product | Instagram | Meta | Matched >= 60 (IG / Meta) | Avg score (IG / Meta) |
|---|---|---|---|---|
| (paste table here) | | | | |

Good / bad match examples: paste from eval output + add screenshots.

## Known limitations (be honest here)
- Scrapers via a provider can break or be rate limited; scraping may conflict with platform ToS - production should use official partnerships/licensed data.
- Instagram/Facebook thumbnail URLs expire; thumbnails are re-fetched at search time but old history cards may show broken images.
- Product-page extraction fails on bot-protected sites (e.g. some Amazon pages); fallback = keyword or image upload.
- Scoring uses thumbnails only (one frame), not whole videos.
- In-process queue loses queued jobs on restart; DNS-rebinding between check and fetch is not fully eliminated.
- No auth / per-user history; no rate limiting on the API.

## Next steps
BullMQ + Redis worker · CLIP embeddings as a cheap pre-filter · multi-frame scoring · TikTok collector · per-user history · Playwright fallback for Ad Library.


## Test results

| Product | Instagram | Meta Ad Library |
|---|---|---|
| oversized graphic tee | 20 | 20 |
  white sneakers | 20 | 20 |
  vitamin c serum | 20 | 20 |
## Known limitations
- Only one product (oversized graphic tee) was fully tested end to end; the assignment asks for five, and I ran out of time to run the rest.
- Instagram and Meta collection returned 20 and 20 videos for that search.
- The Gemini API returned temporary 503 and 429 errors during testing, so some runs showed "Scoring unavailable" and a score of 0.
- A search with an uploaded photo produced real scores only after switching the model to gemini-3.5-flash-lite.