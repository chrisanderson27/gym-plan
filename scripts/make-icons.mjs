// Dependency-free PNG generator. Run `npm run icons`; the output in public/ is committed, not rebuilt.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [11, 11, 15, 255];
const FG = [74, 222, 128, 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// Barbell glyph from rectangles, in a 100x100 box scaled into `inner` of the canvas (safe zone).
const RECTS = [
  [10, 46, 80, 8], // bar
  [16, 30, 8, 40], // inner plates
  [76, 30, 8, 40],
  [6, 38, 8, 24], // outer plates
  [86, 38, 8, 24],
];

function png(size, inner) {
  const px = Buffer.alloc(size * size * 4);
  const scale = (size * inner) / 100;
  const off = (size - size * inner) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x - off) / scale;
      const gy = (y - off) / scale;
      const on = RECTS.some(([rx, ry, rw, rh]) => gx >= rx && gx < rx + rw && gy >= ry && gy < ry + rh);
      px.set(on ? FG : BG, (y * size + x) * 4);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/icon-192.png', png(192, 0.9));
writeFileSync('public/icon-512.png', png(512, 0.9));
writeFileSync('public/icon-maskable-512.png', png(512, 0.6)); // glyph inside the 80% safe zone
writeFileSync('public/apple-touch-icon.png', png(180, 0.9)); // opaque background; iOS ignores alpha
