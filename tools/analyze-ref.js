/* analyze-ref.js — 从参考图量取水印的几何与配色（开发期用）
 *
 * 依赖 tools/ref_rgb24.raw（由 tools/init-ref.ps1 生成）。
 * 用法: node tools/analyze-ref.js
 *
 * 输出的数字就是 README「参考图还原依据」表格里那些实测值。
 */
const fs = require('fs');
const path = require('path');

const rawPath = path.join(__dirname, '_data', 'ref_rgb24.raw');
if (!fs.existsSync(rawPath)) {
  console.error('缺少 ' + rawPath);
  console.error('请先运行:  powershell -File tools/init-ref.ps1');
  process.exit(1);
}

const raw = fs.readFileSync(rawPath);
const W = raw.readInt32LE(0), H = raw.readInt32LE(4);
const px = raw.subarray(8);
const at = (x, y) => { const i = (y * W + x) * 3; return [px[i], px[i + 1], px[i + 2]]; };
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

console.log(`参考图 ${W} × ${H}`);

/* ---------- 1. 表格外框 ---------- */
let tx0 = W, tx1 = -1, ty0 = H, ty1 = -1;
for (let y = Math.floor(H * 0.7); y < H; y++) {
  for (let x = 0; x < Math.floor(W * 0.7); x++) {
    if (lum(at(x, y)) > 120) {
      if (x < tx0) tx0 = x; if (x > tx1) tx1 = x;
      if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
    }
  }
}
const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
console.log('\n=== 表格');
console.log(`  x ${tx0}..${tx1}（宽 ${tw}）y ${ty0}..${ty1}（高 ${th}）`);
console.log(`  左边距 ${tx0}、底边距 ${H - 1 - ty1}`);
console.log(`  宽度 / 短边 = ${(tw / Math.min(W, H)).toFixed(4)}   ← M.tableW`);
console.log(`  高度 / 短边 = ${(th / Math.min(W, H)).toFixed(4)}`);

/* ---------- 2. 顶部蓝色渐变条 ----------
 * 注意：表格顶部是一条 66px 高的蓝色渐变条（下面就是白色卡片），
 *       所以这里用「整行都偏蓝」的行范围来界定，而不是用亮度。
 */
let hb0 = ty0, hb1 = ty0 - 1;
for (let y = ty0; y <= ty1; y++) {
  let sum = 0, n = 0;
  for (let x = tx0 + 40; x <= tx1 - 40; x++) { const c = at(x, y); sum += c[2] - c[0]; n++; }
  if (sum / n > 40) hb1 = y; else if (y > hb0 + 8) break;
}
console.log('\n=== 顶部蓝色条（表格最上方）');
if (hb1 < hb0) {
  console.log('  未检测到蓝色条');
} else {
  console.log(`  y ${hb0}..${hb1}（高 ${hb1 - hb0 + 1}）  ← M.headerH = ${((hb1 - hb0 + 1) / Math.min(W, H)).toFixed(4)}`);
  const gx = tx1 - 60;   // 右侧取样，避开左侧黄色圆点
  const top = at(gx, hb0 + 2), bottom = at(gx, hb1 - 2), mid = at(gx, Math.round((hb0 + hb1) / 2));
  console.log(`  渐变（x=${gx}）：上 ${hex(top)} → 中 ${hex(mid)} → 下 ${hex(bottom)}`);
}

/* ---------- 3. 配色 ---------- */
const mode = (x0, x1, y0, y1, pred) => {
  const m = new Map();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = at(x, y); if (!pred || pred(c)) { const k = hex(c); m.set(k, (m.get(k) || 0) + 1); }
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
};
console.log('\n=== 配色');
console.log('  顶栏主色:', mode(tx0 + 40, tx1 - 40, hb0 + 6, hb1 - 6, (c) => c[2] - c[0] > 30).map((e) => e[0]).join(' '));
console.log('  表格底色:', mode(tx0 + 60, tx1 - 60, hb1 + 20, hb1 + 90, (c) => lum(c) > 200).map((e) => e[0]).join(' '));
console.log('  正文颜色:', mode(tx0, tx1, hb1 + 10, ty1 - 10, (c) => lum(c) < 80).map((e) => e[0]).join(' '));

/* ---------- 4. 圆点 ---------- */
let dx0 = W, dx1 = -1, dy0 = H, dy1 = -1, dn = 0, ds = [0, 0, 0];
for (let y = hb0; y <= hb1; y++) for (let x = tx0; x < tx0 + 400; x++) {
  const c = at(x, y);
  if (c[0] > 150 && c[1] > 100 && c[0] - c[2] > 60) {
    dn++; ds[0] += c[0]; ds[1] += c[1]; ds[2] += c[2];
    if (x < dx0) dx0 = x; if (x > dx1) dx1 = x; if (y < dy0) dy0 = y; if (y > dy1) dy1 = y;
  }
}
console.log('\n=== 圆点');
console.log(`  直径 ${dx1 - dx0 + 1}（← M.dotD = ${((dx1 - dx0 + 1) / Math.min(W, H)).toFixed(4)}）` +
  `  中心距表格左 ${((dx0 + dx1) / 2 - tx0).toFixed(0)}（← M.dotX = ${(((dx0 + dx1) / 2 - tx0) / Math.min(W, H)).toFixed(4)}）`);
console.log('  颜色 ' + hex(ds.map((v) => v / dn)));

/* ---------- 5. 文本行位置 ---------- */
function band(y0, y1, x0, x1, pred, minCount) {
  const out = [];
  const span = x1 - x0 + 1;
  const need = minCount == null ? 4 : (minCount < 1 ? Math.max(4, span * minCount) : minCount);
  let cur = null;
  for (let y = y0; y <= y1; y++) {
    let n = 0, f = -1, l = -1;
    for (let x = x0; x <= x1; x++) if (pred(at(x, y))) { n++; if (f < 0) f = x; l = x; }
    const active = n > need;
    if (active && !cur) cur = { y0: y, y1: y, f, l };
    else if (active) { cur.y1 = y; cur.f = Math.min(cur.f, f); cur.l = Math.max(cur.l, l); }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
console.log('\n=== 标题（白色像素）');
for (const b of band(hb0, hb1, tx0, tx1, (c) => c[0] > 215 && c[1] > 225 && c[2] > 230, 2)) {
  console.log(`  y ${b.y0}..${b.y1}（高 ${b.y1 - b.y0 + 1}）x ${b.f}..${b.l}（宽 ${b.l - b.f + 1}）`);
  console.log(`  字号 ≈ ${((b.y1 - b.y0 + 1) * 0.79).toFixed(1)}（← M.headerFont）`);
}
console.log('\n=== 正文行（深色像素）');
const lines = band(hb1, ty1, tx0 + 10, tx1 - 10, (c) => lum(c) < 150, 0.02);
lines.forEach((b, i) => {
  const pitch = i > 0 ? b.y0 - lines[i - 1].y0 : 0;
  console.log(`  行${i + 1}: y ${b.y0}..${b.y1}（高 ${b.y1 - b.y0 + 1}）x ${b.f}..${b.l}` +
    (pitch ? `  与上一行基准间距 ${pitch}` : ''));
});
if (lines.length > 1) {
  const pitches = [];
  for (let i = 1; i < lines.length; i++) pitches.push(lines[i].y0 - lines[i - 1].y0);
  const pitch = Math.round(pitches.reduce((s, v) => s + v, 0) / pitches.length);
  console.log(`  平均行基准间距 ${pitch}  ← M.lineH = ${(pitch / Math.min(W, H)).toFixed(5)}`);
  const firstGap = lines[0].y0 - (hb1 + 1);
  console.log(`  首个文字行距顶栏下沿 ${firstGap}  ← M.padBodyTop = ${(firstGap / Math.min(W, H)).toFixed(5)}`);
  const lastGap = ty1 - lines[lines.length - 1].y1;
  console.log(`  末行到表格底部 ${lastGap}  ← M.padBottom 参考值 ≈ ${(lastGap / Math.min(W, H)).toFixed(5)}`);
}

/* ---------- 6. 右下 logo ---------- */
let lx0 = W, lx1 = -1, ly0 = H, ly1 = -1;
for (let y = Math.floor(H * 0.85); y < H; y++) for (let x = Math.floor(W * 0.72); x < W; x++) {
  if (lum(at(x, y)) > 75) {
    if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
    if (y < ly0) ly0 = y; if (y > ly1) ly1 = y;
  }
}
const lw = lx1 - lx0 + 1, lh = ly1 - ly0 + 1;
console.log('\n=== 右下 logo（含防伪码行）');
console.log(`  x ${lx0}..${lx1}（宽 ${lw}）y ${ly0}..${ly1}（高 ${lh}）`);
console.log(`  右边距 ${W - 1 - lx1}、底边距 ${H - 1 - ly1}`);
console.log(`  logo 宽度 / 短边 = ${(lw / Math.min(W, H)).toFixed(4)}   ← M.logoW`);
console.log(`  logo 高:宽 = ${(lh / lw).toFixed(4)}（提供的 PNG 为 ${(135 / 295).toFixed(4)}）`);
console.log(`  防伪码行高 ≈ ${Math.round(lh - lw * (135 / 295))}  ← M.codeGap + M.codeSize*1.3`);
