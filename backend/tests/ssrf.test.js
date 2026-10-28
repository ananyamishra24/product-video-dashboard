import { describe, it, expect } from 'vitest';
import { isPrivateIp, assertPublicUrl } from '../src/ssrf.js';

describe('ssrf guard', () => {
  it('flags private ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fe80::1']) expect(isPrivateIp(ip)).toBe(true);
  });
  it('allows public', () => { expect(isPrivateIp('8.8.8.8')).toBe(false); });
  it('rejects bad schemes and internal hosts', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('http://127.0.0.1:6379')).rejects.toThrow();
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicUrl('http://user:pw@8.8.8.8')).rejects.toThrow();
    await expect(assertPublicUrl('not a url')).rejects.toThrow();
  });
});
