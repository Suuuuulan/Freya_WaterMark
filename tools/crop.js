/* crop.js — 从 raw RGB24 裁剪区域并写出 PNG（可放大），用于目视校对
 * 用法: node _tools/crop.js x y w h scale out.png
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePNG(file, w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
}

const [x0, y0, cw, ch, sc, out] = process.argv.slice(2);
const X = +x0, Y = +y0, CW = +cw, CH = +ch, S = +(sc || 1);
const raw = fs.readFileSync(path.join(__dirname, '_data', 'ref_rgb24.raw'));
const W = raw.readInt32LE(0), H = raw.readInt32LE(4);
const px = raw.subarray(8);

const OW = CW * S, OH = CH * S;
const rgba = Buffer.alloc(OW * OH * 4);
for (let y = 0; y < OH; y++) {
  for (let x = 0; x < OW; x++) {
    const sx = X + Math.floor(x / S), sy = Y + Math.floor(y / S);
    const si = (Math.min(H - 1, sy) * W + Math.min(W - 1, sx)) * 3;
    const di = (y * OW + x) * 4;
    rgba[di] = px[si]; rgba[di + 1] = px[si + 1]; rgba[di + 2] = px[si + 2]; rgba[di + 3] = 255;
  }
}
writePNG(path.join(__dirname, out), OW, OH, rgba);
console.log(`wrote ${out} from (${X},${Y}) ${CW}x${CH} scale ${S} → ${OW}x${OH}`);
