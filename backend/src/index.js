import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { config, mockBrain, mockCollectors } from './config.js';
import { db } from './db.js';
import { log } from './logger.js';
import { enqueue, getEvents, subscribe } from './pipeline.js';
import { assertPublicUrl } from './ssrf.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use((req, _res, next) => { log.info({ method: req.method, url: req.url }); next(); });

const Body = z.object({
  input: z.string().trim().min(2, 'Enter a product name or a link').max(2000),
  imageBase64: z.string().max(10_000_000).optional(),
  includeSeen: z.boolean().optional(),
});

app.get('/api/health', (_q, res) => res.json({ ok: true, mockBrain, mockCollectors }));

app.post('/api/search', async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const body = parsed.data;
  body.type = /^https?:\/\//i.test(body.input) ? 'url' : 'keyword';
  if (body.type === 'url') {
    try { await assertPublicUrl(body.input); }
    catch (e) { return res.status(400).json({ error: `Blocked or invalid URL: ${e.message}` }); }
  }
  const id = randomUUID();
  db.prepare('INSERT INTO searches(id,input,input_type,status,created_at) VALUES(?,?,?,?,?)').run(id, body.input, body.type, 'queued', Date.now());
  enqueue({ id, body });
  res.status(202).json({ id });
});

const parse = (s) => (s ? JSON.parse(s) : null);
function getSearch(id) {
  const r = db.prepare('SELECT * FROM searches WHERE id=?').get(id);
  if (!r) return null;
  const results = db.prepare('SELECT data FROM results WHERE search_id=? ORDER BY score DESC').all(id).map((x) => JSON.parse(x.data));
  return { id: r.id, input: r.input, type: r.input_type, status: r.status, error: r.error, createdAt: r.created_at, product: parse(r.product), stats: parse(r.stats), results };
}

app.get('/api/search/:id', (req, res) => {
  const s = getSearch(req.params.id);
  return s ? res.json(s) : res.status(404).json({ error: 'Search not found' });
});

app.get('/api/search/:id/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
  getEvents(req.params.id).forEach(send);
  const off = subscribe(req.params.id, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { off(); clearInterval(ping); });
});

app.get('/api/history', (_q, res) => {
  const rows = db.prepare(`SELECT s.id, s.input, s.input_type, s.status, s.created_at,
    (SELECT COUNT(*) FROM results r WHERE r.search_id=s.id) AS videos
    FROM searches s ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows);
});

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
app.get('/api/search/:id/export.csv', (req, res) => {
  const s = getSearch(req.params.id);
  if (!s) return res.status(404).json({ error: 'Search not found' });
  const head = ['platform', 'url', 'score', 'reason', 'caption'];
  const rows = s.results.map((v) => [v.platform, v.url, v.score, v.reason, v.caption].map(csvCell).join(','));
  res.type('text/csv').attachment('videos.csv').send([head.join(','), ...rows].join('\n'));
});

app.use((err, _req, res, _next) => { log.error({ err: err.message }); res.status(500).json({ error: 'Internal server error' }); });

app.listen(config.port, () => log.info({ port: config.port, mockBrain, mockCollectors }, 'API ready'));
