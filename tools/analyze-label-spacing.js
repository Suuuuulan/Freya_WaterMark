/* analyze-label-spacing.js — 从参照图里量出「标签字间距」与「冒号→值」的间距
 * 用法: node tools/analyze-label-spacing.js <图片路径>
 * 只做开发期量取，不参与线上功能。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- 最小 PNG 解码（只支持 8bit RGB/RGBA，无隔行） ---------- */
function readPNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (bitDepth !== 8) throw new Error('仅支持 8bit，实际 ' + bitDepth);
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error('仅支持 RGB/RGBA，colorType=' + colorType);
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 3] = line[x * ch];
      out[(y * w + x) * 3 + 1] = line[x * ch + 1];
      out[(y * w + x) * 3 + 2] = line[x * ch + 2];
    }
    prev = line;
  }
  return { w, h, rgb: out };
}

const file = process.argv[2];
if (!file) { console.error('用法: node tools/analyze-label-spacing.js <png>'); process.exit(1); }
const img = readPNG(file);
const { w, h, rgb } = img;
const at = (x, y) => { const i = (y * w + x) * 3; return [rgb[i], rgb[i + 1], rgb[i + 2]]; };
const isDark = (x, y) => {
  const [r, g, b] = at(x, y);
  // 卡片内文字是纯黑；用「暗且饱和度低」排除照片里的彩色/半暗像素
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return (r + g + b) / 3 < 90 && (mx - mn) < 45;
};

/* 找「白色卡片」区域：整行里白色像素占比高的行 */
const isWhiteRow = [];
for (let y = 0; y < h; y++) {
  let n = 0;
  for (let x = 0; x < w; x++) { const [r, g, b] = at(x, y); if (r > 225 && g > 225 && b > 225) n++; }
  isWhiteRow.push(n / w > 0.5);
}
/* 卡片上下边界 = 连续白色行块里最高的那块 */
let cardTop = -1, cardBot = -1, best = 0;
for (let y = 0; y < h; y++) {
  if (!isWhiteRow[y]) continue;
  let y2 = y; while (y2 + 1 < h && isWhiteRow[y2 + 1]) y2++;
  if (y2 - y + 1 > best) { best = y2 - y + 1; cardTop = y; cardBot = y2; }
  y = y2;
}
/* 卡片左右边界：在卡片中间一行找白色横向范围（取该行最宽的白色连续段） */
const probeY = cardBot - 4;
let cardL = 0, cardR = w - 1, bestW = 0, xs = -1;
for (let x = 0; x < w; x++) {
  const [r, g, b] = at(x, probeY);
  const white = r > 225 && g > 225 && b > 225;
  if (white && xs < 0) xs = x;
  else if (!white && xs >= 0) { if (x - xs > bestW) { bestW = x - xs; cardL = xs; cardR = x - 1; } xs = -1; }
}
if (xs >= 0 && w - xs > bestW) { cardL = xs; cardR = w - 1; }
console.log(`白色卡片: x=${cardL}..${cardR}  y=${cardTop}..${cardBot}  （正文区高 ${cardBot - cardTop + 1}px）`);

/* 卡片内的文字行（蓝色顶栏在 cardTop 之上，不参与）；
 * 每条文字带只取「竖直投影最饱满的那一段」，避免照片噪点混入 */
const textRows = [];
for (let y = cardTop; y <= cardBot; y++) {
  let dark = 0;
  for (let x = cardL; x <= cardR; x++) if (isDark(x, y)) dark++;
  if (dark > (cardR - cardL) * 0.02) textRows.push({ y, dark });
}
/* 把相邻行聚成文字行带 */
const bands = [];
for (const r of textRows) {
  const last = bands[bands.length - 1];
  if (last && r.y - last.end <= 2) { last.end = r.y; last.rows.push(r); }
  else bands.push({ start: r.y, end: r.y, rows: [r] });
}
console.log(`${path.basename(file)}  ${w}×${h}`);
console.log('检测到 ' + bands.length + ' 条文字带：');
for (const b of bands) console.log(`  y=${b.start}..${b.end}  高=${b.end - b.start + 1}`);

/* 对每条带做列投影，找字符簇（只在卡片内部投影，避免照片噪点） */
function clusters(b) {
  const colHas = [];
  for (let x = cardL; x <= cardR; x++) {
    let d = 0;
    for (let y = b.start; y <= b.end; y++) if (isDark(x, y)) d++;
    colHas.push(d >= 2);          // 至少 2 个暗像素才算字形，滤掉单点噪点
  }
  const out = [];
  let s = -1;
  for (let i = 0; i < colHas.length; i++) {
    if (colHas[i] && s < 0) s = i;
    else if (!colHas[i] && s >= 0) { out.push({ x0: cardL + s, x1: cardL + i - 1, w: i - s }); s = -1; }
  }
  if (s >= 0) out.push({ x0: cardL + s, x1: cardR, w: cardR - (cardL + s) + 1 });
  return out;
}
console.log('\n各文字带的字符簇（x0..x1，宽度 → 与下一个簇的间隙）：');
bands.forEach((b, i) => {
  const cl = clusters(b);
  if (cl.length < 3) return;
  console.log(`\n带${i + 1} (y=${b.start}..${b.end}, 高 ${b.end - b.start + 1}px)  簇数=${cl.length}`);
  console.log('  ' + cl.map((c, j) => `${j}:${c.x0}-${c.x1}(${c.w})${j < cl.length - 1 ? ' gap→' + (cl[j + 1].x0 - c.x1 - 1) : ''}`).join('  '));
});
