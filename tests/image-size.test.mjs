// Intrinsic image sizes read from file headers (scripts/lib/image-size.mjs):
// the static snapshot writes them as width/height so covers reserve their space.
import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSize } from '../scripts/lib/image-size.mjs';

const u16be = (n) => [n >> 8, n & 255];
const u16le = (n) => [n & 255, n >> 8];
const u24le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const u32be = (n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u32le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const ascii = (s) => [...Buffer.from(s, 'ascii')];
const buf = (...parts) => Buffer.from(parts.flat());

const png = (w, h) => buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), ascii('IHDR'), u32be(w), u32be(h), [8, 6, 0, 0, 0]);

/** A JPEG with an optional EXIF orientation and a baseline frame header. */
function jpeg(w, h, orientation, order = 'II') {
  const le = order === 'II';
  const w16 = le ? u16le : u16be, w32 = le ? u32le : u32be;
  const tiff = [...ascii(order), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(orientation ?? 1), 0, 0, ...w32(0)];
  const exif = [...ascii('Exif'), 0, 0, ...tiff];
  const app1 = orientation === undefined ? [] : [0xff, 0xe1, ...u16be(exif.length + 2), ...exif];
  const app0 = [0xff, 0xe0, ...u16be(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, ...u16be(17), 8, ...u16be(h), ...u16be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return buf([0xff, 0xd8], app0, app1, sof, [0xff, 0xda, 0, 2]);
}

test('PNG and GIF read their header dimensions', () => {
  assert.deepEqual(imageSize(png(1600, 1000)), { width: 1600, height: 1000 });
  assert.deepEqual(imageSize(buf(ascii('GIF89a'), u16le(320), u16le(200), [0, 0, 0])), { width: 320, height: 200 });
});

test('JPEG: frame size, with EXIF orientations 5–8 swapping width and height', () => {
  assert.deepEqual(imageSize(jpeg(4000, 3000)), { width: 4000, height: 3000 });
  assert.deepEqual(imageSize(jpeg(4000, 3000, 1)), { width: 4000, height: 3000 });
  assert.deepEqual(imageSize(jpeg(4000, 3000, 6)), { width: 3000, height: 4000 }, 'portrait phone photo stored landscape');
  assert.deepEqual(imageSize(jpeg(4000, 3000, 8, 'MM')), { width: 3000, height: 4000 }, 'big-endian EXIF');
  assert.deepEqual(imageSize(jpeg(4000, 3000, 3)), { width: 4000, height: 3000 }, '180° keeps the shape');
});

test('WebP (lossy, lossless, extended) and AVIF', () => {
  const riff = (chunk, body) => buf(ascii('RIFF'), u32le(4 + 8 + body.length), ascii('WEBP'), ascii(chunk), u32le(body.length), body);
  assert.deepEqual(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(800), ...u16le(600), 0, 0])), { width: 800, height: 600 });
  const bits = (799) | ((599) << 14);
  assert.deepEqual(imageSize(riff('VP8L', [0x2f, ...u32le(bits), 0, 0, 0, 0, 0])), { width: 800, height: 600 });
  assert.deepEqual(imageSize(riff('VP8X', [0, 0, 0, 0, ...u24le(1919), ...u24le(1079), 0, 0])), { width: 1920, height: 1080 });

  const box = (type, body) => [...u32be(8 + body.length), ...ascii(type), ...body];
  const avif = (irot) => buf(box('ftyp', [...ascii('avif'), ...u32be(0), ...ascii('mif1avif')]),
    box('ispe', [0, 0, 0, 0, ...u32be(1200), ...u32be(900)]), irot === undefined ? [] : box('irot', [irot]));
  assert.deepEqual(imageSize(avif()), { width: 1200, height: 900 });
  assert.deepEqual(imageSize(avif(1)), { width: 900, height: 1200 }, 'irot 90°');
});

test('unknown, truncated or empty input is null, never a throw', () => {
  assert.equal(imageSize(Buffer.alloc(0)), null);
  assert.equal(imageSize(undefined), null);
  assert.equal(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(imageSize(png(1600, 1000).subarray(0, 18)), null);
  assert.equal(imageSize(jpeg(4000, 3000).subarray(0, 26)), null, 'cut inside the frame header');
  assert.equal(imageSize(png(0, 10)), null, 'zero size');
});
