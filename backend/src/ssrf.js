import dns from 'node:dns/promises';
import net from 'node:net';

const bl = new net.BlockList();
[['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
 ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]
  .forEach(([a, p]) => bl.addSubnet(a, p, 'ipv4'));
bl.addAddress('::1', 'ipv6');
bl.addSubnet('fc00::', 7, 'ipv6');
bl.addSubnet('fe80::', 10, 'ipv6');

export function isPrivateIp(ip) {
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const fam = net.isIP(ip);
  if (!fam) return true; // unparseable => treat as unsafe
  return bl.check(ip, fam === 4 ? 'ipv4' : 'ipv6');
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('URL points to a non-public address');
  return u;
}

// Re-validates every redirect hop (redirect: 'manual').
export async function safeFetch(raw, { maxRedirects = 3, timeoutMs = 10000, headers = {} } = {}) {
  let url = raw;
  for (let i = 0; i <= maxRedirects; i++) {
    const u = await assertPublicUrl(url);
    const res = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ProductVideoBot/1.0)', ...headers },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, u).toString(); continue; }
    return res;
  }
  throw new Error('Too many redirects');
}

export async function readLimited(res, maxBytes = 5e6) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('Response too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('Response too large');
  return buf;
}
