import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DB_PATH || 'data/app.db';
fs.mkdirSync(path.dirname(file), { recursive: true });
export const db = new Database(file);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS searches(
  id TEXT PRIMARY KEY, input TEXT, input_type TEXT, status TEXT,
  product TEXT, stats TEXT, error TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS results(
  search_id TEXT, uid TEXT, platform TEXT, score INTEGER, data TEXT,
  PRIMARY KEY(search_id, uid));
CREATE TABLE IF NOT EXISTS seen(
  uid TEXT PRIMARY KEY, platform TEXT, phash TEXT, cap TEXT, first_search TEXT);
CREATE TABLE IF NOT EXISTS cache(k TEXT PRIMARY KEY, v TEXT, created_at INTEGER);
`);

export function cacheGet(k, ttlMs = 7 * 864e5) {
  const r = db.prepare('SELECT v, created_at FROM cache WHERE k=?').get(k);
  return r && Date.now() - r.created_at < ttlMs ? JSON.parse(r.v) : null;
}
export function cacheSet(k, v) {
  db.prepare('INSERT OR REPLACE INTO cache VALUES(?,?,?)').run(k, JSON.stringify(v), Date.now());
}
