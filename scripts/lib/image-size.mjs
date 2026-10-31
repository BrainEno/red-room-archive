/**
 * Intrinsic image size from the first bytes of a file — PNG, GIF, JPEG
 * (honouring the EXIF orientation browsers apply), WebP and AVIF/HEIF.
 * No dependencies. Used by the static snapshot to write width/height on
 * <img> tags, so the browser reserves the space before the image arrives and
 * the article does not jump while the reader starts scrolling.
 *
 * Returns `{ width, height }` or `null` when the bytes are not a recognised,
 * complete image header. 64 KiB is enough for every supported format except
 * JPEGs with very large embedded metadata, which simply return `null`.
 */

export const IMAGE_HEADER_BYTES = 64 * 1024;

const ok = (width, height) =>
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 65535 * 4 && height <= 65535 * 4
    ? { width, height }
    : null;

function png(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return ok(b.readUInt32BE(16), b.readUInt32BE(20));
}

function gif(b) {
  if (b.length < 10 || !/^GIF8[79]a$/.test(b.toString('ascii', 0, 6))) return null;
  return ok(b.readUInt16LE(6), b.readUInt16LE(8));
}

function webp(b) {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return ok(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
  if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return ok(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
}

/** EXIF orientation 5–8 rotates the picture by 90°, so the displayed size is swapped. */
function exifRotated(b, start, end) {
  if (b.toString('ascii', start, start + 6) !== 'Exif\0\0') return false;
  const tiff = start + 6;
  const order = b.toString('ascii', tiff, tiff + 2);
  if (order !== 'II' && order !== 'MM') return false;
  const u16 = (at) => (order === 'II' ? b.readUInt16LE(at) : b.readUInt16BE(at));
  const u32 = (at) => (order === 'II' ? b.readUInt32LE(at) : b.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return false;
    if (u16(entry) === 0x0112) return u16(entry + 8) >= 5 && u16(entry + 8) <= 8;
  }
  return false;
}

function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2, rotated = false;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) { at++; continue; }                       // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
    const length = b.readUInt16BE(at + 2);
    if (length < 2) return null;
    if (marker === 0xe1 && at + 2 + length <= b.length) rotated = rotated || exifRotated(b, at + 4, at + 2 + length);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = b.readUInt16BE(at + 5), width = b.readUInt16BE(at + 7);
      return rotated ? ok(height, width) : ok(width, height);
    }
    if (marker === 0xda || marker === 0xd9) return null;           // image data before any frame header
    at += 2 + length;
  }
  return null;
}

/** AVIF / HEIF: the first `ispe` property (image spatial extent), swapped by an `irot` of 90°/270°. */
function isobmff(b) {
  if (b.length < 16 || b.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brands = b.toString('ascii', 8, Math.min(b.length, 8 + b.readUInt32BE(0)));
  if (!/avif|avis|heic|heix|mif1|msf1/.test(brands)) return null;
  const ispe = b.indexOf('ispe');
  if (ispe < 4 || ispe + 16 > b.length) return null;
  let width = b.readUInt32BE(ispe + 8), height = b.readUInt32BE(ispe + 12);
  const irot = b.indexOf('irot');
  if (irot > 0 && irot + 5 <= b.length && (b[irot + 4] & 0x03) % 2 === 1) [width, height] = [height, width];
  return ok(width, height);
}

export function imageSize(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  try {
    return png(b) ?? gif(b) ?? webp(b) ?? jpeg(b) ?? isobmff(b);
  } catch {
    return null;                                                   // truncated header
  }
}
