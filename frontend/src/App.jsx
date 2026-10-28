import { useEffect, useMemo, useRef, useState } from 'react';

const TARGET = 20;
const TABS = [{ key: 'instagram', label: 'Instagram Reels' }, { key: 'meta', label: 'Meta Ad Library' }];

async function api(path, opts) {
  const res = await fetch(path, opts);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

function VideoCard({ v, threshold, starred, onStar }) {
  const [play, setPlay] = useState(false);
  const low = v.score < threshold;
  const tone = v.score >= 85 ? 'good' : v.score >= threshold ? 'ok' : 'bad';
  return (
    <div className={`card ${low ? 'low' : ''}`}>
      <div className="thumb">
        {play && v.videoUrl
          ? <video src={v.videoUrl} controls autoPlay playsInline />
          : <img src={v.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />}
        <span className="badge">{v.platform === 'instagram' ? 'Instagram' : 'Meta Ad'}</span>
        <span className={`score ${tone}`}>{v.score}</span>
        <button className={`star ${starred ? 'on' : ''}`} onClick={onStar} title="Save to shortlist">★</button>
        {v.videoUrl && !play && <button className="playbtn" onClick={() => setPlay(true)}>▶</button>}
      </div>
      <div className="body">
        {low && <div className="lowtag">Low match</div>}
        <p className="reason">{v.reason}</p>
        <p className="caption">{v.caption || <em>No caption</em>}</p>
        <div className="meta">{v.advertiser || (v.author && '@' + v.author) || ''}{v.postedAt ? ` · ${new Date(v.postedAt).toLocaleDateString()}` : ''}</div>
        <a href={v.url} target="_blank" rel="noreferrer">Open original ↗</a>
      </div>
    </div>
  );
}

export default function App() {
  const [input, setInput] = useState('');
  const [image, setImage] = useState(null);
  const [includeSeen, setIncludeSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState([]);
  const [search, setSearch] = useState(null);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState('instagram');
  const [sort, setSort] = useState('score');
  const [hideLow, setHideLow] = useState(false);
  const [shortlist, setShortlist] = useState({});
  const esRef = useRef(null);

  const loadHistory = () => api('/api/history').then(setHistory).catch(() => {});
  useEffect(() => { loadHistory(); return () => esRef.current?.close(); }, []);

  async function open(id) {
    esRef.current?.close();
    setError(''); setProgress([]);
    const s = await api(`/api/search/${id}`);
    setSearch(s);
    if (s.status === 'done' || s.status === 'error') { setBusy(false); if (s.status === 'error') setError(s.error || 'Search failed'); return; }
    setBusy(true);
    const es = new EventSource(`/api/search/${id}/events`);
    esRef.current = es;
    es.addEventListener('progress', (e) => setProgress((p) => [...p, JSON.parse(e.data).message]));
    es.addEventListener('product', async () => setSearch(await api(`/api/search/${id}`)));
    es.addEventListener('done', async () => { es.close(); setSearch(await api(`/api/search/${id}`)); setBusy(false); loadHistory(); });
    es.addEventListener('error', (e) => {
      if (e.data) { setError(JSON.parse(e.data).message); setBusy(false); es.close(); loadHistory(); }
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (input.trim().length < 2) return setError('Type a product name or paste a product link first.');
    setBusy(true); setSearch(null); setProgress(['Queued…']);
    try {
      const { id } = await api('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: input.trim(), imageBase64: image || undefined, includeSeen }) });
      await open(id);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return setImage(null);
    if (f.size > 6e6) return setError('Image is too large (max 6 MB).');
    const r = new FileReader(); r.onload = () => setImage(r.result); r.readAsDataURL(f);
  }

  const threshold = search?.stats?.threshold ?? 60;
  const byPlatform = useMemo(() => {
    const out = { instagram: [], meta: [] };
    (search?.results || []).forEach((v) => out[v.platform]?.push(v));
    return out;
  }, [search]);

  const shown = useMemo(() => {
    let list = [...(byPlatform[tab] || [])];
    if (hideLow) list = list.filter((v) => v.score >= threshold);
    list.sort((a, b) => (sort === 'newest' ? (b.postedAt || 0) - (a.postedAt || 0) : b.score - a.score));
    return list;
  }, [byPlatform, tab, sort, hideLow, threshold]);

  const star = (v) => setShortlist((s) => { const n = { ...s }; n[v.uid] ? delete n[v.uid] : (n[v.uid] = v); return n; });
  const starred = Object.values(shortlist);
  function exportShortlist() {
    const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const csv = ['platform,url,score,reason,caption', ...starred.map((v) => [v.platform, v.url, v.score, v.reason, v.caption].map(cell).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'shortlist.csv'; a.click();
  }

  const attrs = search?.product?.attrs;
  return (
    <div className="layout">
      <aside className="side">
        <h3>Search history</h3>
        {!history.length && <p className="muted">No searches yet.</p>}
        {history.map((h) => (
          <button key={h.id} className={`hist ${search?.id === h.id ? 'active' : ''}`} onClick={() => open(h.id)}>
            <span>{h.input.length > 38 ? h.input.slice(0, 38) + '…' : h.input}</span>
            <small>{h.status} · {h.videos} videos</small>
          </button>
        ))}
        <h3>Shortlist ({starred.length})</h3>
        <button className="btn small" disabled={!starred.length} onClick={exportShortlist}>Export CSV</button>
      </aside>

      <main className="main">
        <h1>Product Video Discovery</h1>
        <form className="searchbar" onSubmit={submit}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Product name or product link (Shopify, Amazon, brand site)…" />
          <label className="file">{image ? 'Image ✓' : 'Upload image'}<input type="file" accept="image/*" onChange={onFile} hidden /></label>
          <button className="btn" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
          <label className="check"><input type="checkbox" checked={includeSeen} onChange={(e) => setIncludeSeen(e.target.checked)} /> Show previously seen</label>
        </form>

        {error && <div className="alert">⚠ {error}<br /><small>Try: a shorter keyword, uploading the product photo, or pasting a different product link.</small></div>}

        {busy && (
          <div className="progress">
            <div className="spinner" />
            <ul>{progress.slice(-6).map((m, i) => <li key={i} className={i === Math.min(progress.length, 6) - 1 ? 'cur' : ''}>{m}</li>)}</ul>
          </div>
        )}

        {search?.product && (
          <section className="product">
            {search.product.imageUrl && <img src={search.product.imageUrl} alt="" referrerPolicy="no-referrer" />}
            <div>
              <h2>{search.product.title}</h2>
              {search.product.description && <p className="muted">{search.product.description}</p>}
              {attrs && (
                <dl>
                  <dt>Type</dt><dd>{attrs.product_type || '-'}</dd>
                  <dt>Colours</dt><dd>{attrs.colors?.join(', ') || '-'}</dd>
                  <dt>Print / graphic</dt><dd>{attrs.prints_graphics || '-'}</dd>
                  <dt>Logos</dt><dd>{attrs.logos || '-'}</dd>
                  <dt>Text</dt><dd>{attrs.text_on_product || '-'}</dd>
                  <dt>Material</dt><dd>{attrs.material || '-'}</dd>
                  <dt>Shape</dt><dd>{attrs.shape || '-'}</dd>
                </dl>
              )}
              {attrs?.hashtags?.length > 0 && <div className="tags">{attrs.hashtags.slice(0, 10).map((h) => <span key={h}>#{h}</span>)}</div>}
            </div>
          </section>
        )}

        {search && (
          <>
            <div className="tabs">
              {TABS.map((t) => {
                const n = byPlatform[t.key].length; const st = search.stats?.[t.key];
                return (
                  <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                    {t.label} <span className={`count ${n >= TARGET ? 'full' : 'short'}`}>{n}/{TARGET}</span>
                    {st && st.matched !== undefined && <small> · {st.matched} strong</small>}
                  </button>
                );
              })}
              <div className="spacer" />
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="score">Sort: match score</option><option value="newest">Sort: newest first</option>
              </select>
              <label className="check"><input type="checkbox" checked={hideLow} onChange={(e) => setHideLow(e.target.checked)} /> Hide low matches (&lt;{threshold})</label>
            </div>
            {search.stats?.[tab]?.shortfall && <div className="warn">Shortfall: {search.stats[tab].note}</div>}
            {!busy && !shown.length && <div className="empty">No videos to show here. {search.stats?.[tab]?.error ? 'The source failed - see the note above.' : 'Try widening the product name or untick "Hide low matches".'}</div>}
            <div className="grid">{shown.map((v) => <VideoCard key={v.uid} v={v} threshold={threshold} starred={!!shortlist[v.uid]} onStar={() => star(v)} />)}</div>
          </>
        )}

        {!search && !busy && !error && <div className="empty">Search a product to get 20 Instagram Reels + 20 Meta video ads, scored by how well they match the product photo.</div>}
      </main>
    </div>
  );
}
