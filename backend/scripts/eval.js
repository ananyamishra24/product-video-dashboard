// Usage: node scripts/eval.js   (API must be running). Prints a markdown table for your README.
const API = process.env.API || 'http://localhost:4000';
const PRODUCTS = process.argv.slice(2).length ? process.argv.slice(2) : [
  'oversized graphic tee', 'protein dark chocolate', 'white running sneakers', 'vitamin c face serum', 'stainless steel water bottle',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = []; const examples = [];
for (const p of PRODUCTS) {
  const { id } = await (await fetch(`${API}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: p }) })).json();
  let s; do { await sleep(3000); s = await (await fetch(`${API}/api/search/${id}`)).json(); } while (!['done', 'error'].includes(s.status));
  const avg = (pl) => { const r = s.results.filter((v) => v.platform === pl); return r.length ? Math.round(r.reduce((a, v) => a + v.score, 0) / r.length) : 0; };
  const st = s.stats || {};
  rows.push(`| ${p} | ${st.instagram?.count ?? 0}/20 | ${st.meta?.count ?? 0}/20 | ${st.instagram?.matched ?? 0} / ${st.meta?.matched ?? 0} | ${avg('instagram')} / ${avg('meta')} | ${s.status} |`);
  const sorted = [...s.results].sort((a, b) => b.score - a.score);
  examples.push(`\n**${p}**\n- Good: ${sorted.slice(0, 2).map((v) => `${v.score} - ${v.reason} (${v.url})`).join('\n- Good: ')}\n- Bad: ${sorted.slice(-2).map((v) => `${v.score} - ${v.reason} (${v.url})`).join('\n- Bad: ')}`);
}
console.log('| Product | Instagram | Meta | Matched >= threshold (IG / Meta) | Avg score (IG / Meta) | Status |\n|---|---|---|---|---|---|\n' + rows.join('\n'));
console.log(examples.join('\n'));
