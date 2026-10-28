import sharp from 'sharp';

// 64-bit difference hash as 16 hex chars.
export async function dhash(buffer) {
  const { data } = await sharp(buffer).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

// Shrink for cheaper LLM calls + consistent hashing.
export async function shrink(buffer, size = 512) {
  const out = await sharp(buffer).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { buffer: out, mime: 'image/jpeg' };
}
