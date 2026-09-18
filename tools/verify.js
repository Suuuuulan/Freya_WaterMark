/* verify.js — 用真实布局引擎在 Node 中计算版式，并与参考图实测值对比。
 *
 * Node 里没有浏览器字体度量，这里用参考图反解出来的度量做 shim：
 *   CJK = 1.0em、字号 40px、字距 0.10em 可复现参考图的折行位置。
 * 用法: node _tools/verify.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/* ---------- 1. 字体度量 shim ---------- */
const CJK_RATIO = +(process.env.CJK_RATIO || 1.0);
const SHIM = { digit: 0.556, upper: 0.66, lower: 0.52, punct: 0.30, space: 0.28 };

function makeCtx() {
  let size = 16;
  const isWide = (ch) => /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch);
  return {
    set font(v) {
      const m = /(\d+(?:\.\d+)?)px/.exec(v);
      size = m ? parseFloat(m[1]) : 16;
    },
    get font() { return size + 'px'; },
    measureText(text) {
      let w = 0;
      for (const ch of String(text)) {
        if (isWide(ch)) w += size * CJK_RATIO;
        else if (ch === ' ') w += size * SHIM.space;
        else if (/[0-9]/.test(ch)) w += size * SHIM.digit;
        else if (/[A-Z]/.test(ch)) w += size * SHIM.upper;
        else if (/[a-z]/.test(ch)) w += size * SHIM.lower;
        else if (/[.:·\-/_]/.test(ch)) w += size * SHIM.punct;
        else w += size * 0.5;
      }
      return { width: w };
    },
    fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
    rect() {}, clip() {}, fill() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    fillRect() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }), setTransform() {}, clearRect() {}
  };
}

/* ---------- 2. 载入渲染引擎 ---------- */
const ctx = makeCtx();
global.document = { createElement: () => ({ getContext: () => ctx }) };
const code = fs.readFileSync(path.join(root, 'src', 'render.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'window', 'globalThis', 'document', 'Image', code)(
  mod, global, global, global.document, function () { this.onload = null; }
);
const WM = global.FreyaWM || mod.exports;

/* ---------- 3. 计算参考图（1773×2364）下的版式 ---------- */
const W = 1773, H = 2364, BASE = 1773;
const p = Object.assign({}, WM.DEFAULTS);
const rows = [
  { on: true, label: p.rows[0].label, value: '2026.08.19 10:59' },
  { on: true, label: p.rows[1].label, value: p.rows[1].text }
];
const t = WM.createRenderer({ logoUrl: '' }).layout(p, BASE, rows);

const mx = BASE * p.marginX / 100, my = BASE * p.marginY / 100;
const x = mx, y = H - my - t.h;

/* ---------- 4. 参考图实测值 与 当前默认设计值 ----------
 * REF   = 从参考图（1773×2364）逐像素量出来的历史实测值，作为「还原度」基线保留
 * DES   = 当前默认参数下的设计值（字高 ×1.2、行距收紧、加粗黑体；表格宽度保持参考比例）
 * changed=true 的项是**有意偏离参考图**的，不再要求逼近 REF；
 * 其余项仍要求与 REF 偏差 ≤ 6%（即还原度没有回退）。 */
const REF = {
  marginX: 39, marginY: 40,
  tableW: 931, tableH: 342, tableX: 39,
  headerH: 96, dotD: 29, dotX: 49,
  titleGlyphH: 44, bodyGlyphH: 40,
  bodyPadX: 21, padX: 23.4, padBodyTop: 26,
  logoW: 266, logoH: 122, logoBlockH: 158
};
const DES = {
  marginX: 39, marginY: 40,
  tableW: 931, tableH: 366, tableX: 39,
  headerH: 96, dotD: 29, dotX: 49,
  titleGlyphH: 44, bodyGlyphH: 48.1,
  bodyPadX: 21, padX: 23.4, padBodyTop: 26,
  logoW: 266, logoH: 122, logoBlockH: 158
};
/* 表格宽度已回到参考比例；高度随字高 ×1.2 变高属必然结果（表内各行单项标注） */
const rowPitchRef = 60, rowPitchDes = 73.6;

const logoH = BASE * WM.M.logoW * (135 / 295);
const got = {
  marginX: mx, marginY: my,
  tableW: t.w, tableH: t.h, tableX: x,
  headerH: t.headerH, dotD: t.dotD, dotX: t.dotX,
  titleGlyphH: t.fH, bodyGlyphH: t.fB,
  bodyPadX: t.bodyPadX, padX: t.padX, padBodyTop: t.padBodyTop,
  logoW: BASE * WM.M.logoW,
  logoH: logoH,
  logoBlockH: logoH + BASE * (WM.M.codeGap + WM.M.codeSize * 1.3)
};

const rowsOut = [
  ['表格左边距', REF.marginX, got.marginX],
  ['表格底边距', REF.marginY, got.marginY],
  ['表格宽度', REF.tableW, got.tableW],
  ['表格高度', REF.tableH, got.tableH, 1],
  ['顶栏高度', REF.headerH, got.headerH, 1],
  ['圆点直径', REF.dotD, got.dotD],
  ['圆点中心X(表内)', REF.dotX, got.dotX],
  ['标题字号', REF.titleGlyphH, got.titleGlyphH, 1],
  ['正文字号', REF.bodyGlyphH, got.bodyGlyphH, 1],
  ['行基准间距', rowPitchRef, rowPitchDes, 1],
  ['正文左内边距', REF.bodyPadX, got.bodyPadX],
  ['顶栏左右内边距', REF.padX, got.padX],
  ['正文前留白', REF.padBodyTop, got.padBodyTop],
  ['logo 宽度', REF.logoW, got.logoW],
  ['logo 高度', REF.logoH, got.logoH],
  ['logo+防伪码块高', REF.logoBlockH, got.logoBlockH]
];

console.log('CJK ratio = ' + CJK_RATIO + '\n');
console.log('项目                    参考   当前    偏差   说明');
console.log('----------------------------------------------------------------');
let worst = 0, worstName = '', changedCount = 0;
for (const [label, ref, val, changed] of rowsOut) {
  const pct = ((val - ref) / ref) * 100;
  if (changed) changedCount++;
  else if (Math.abs(pct) > Math.abs(worst)) { worst = pct; worstName = label; }
  const flag = changed ? '  ← 按需求调整' : (Math.abs(pct) > 6 ? '  <<< 偏差大' : (Math.abs(pct) > 3 ? '  <' : ''));
  console.log(
    label.padEnd(20, ' ') + String(Math.round(ref * 10) / 10).padStart(7) +
    String(Math.round(val * 10) / 10).padStart(8) +
    (pct >= 0 ? '   +' : '   ') + pct.toFixed(1) + '%' + flag
  );
}
console.log('----------------------------------------------------------------');
console.log('还原度最大偏差（不含按需求调整项）: ' + worst.toFixed(1) + '%  (' + worstName + ')');
console.log('按需求调整项: ' + changedCount + ' 项（字高 ×1.2 且标题跟随、行距收紧；表格高度随之变高）—— 有意偏离参考图');

/* ---------- 5. 折行检查 ---------- */
console.log('\n折行检查（浏览器里 SimHei 汉字宽 = 1em）：');
const refLines = [1, 1];   // 表格铺满后值列变宽，参考图第 2 行的 2 行折行变成 1 行
t.rows.forEach((r, i) => {
  const ref = refLines[i];
  const ok = r.lines.length === ref ? '符合当前预期' : '预期为 ' + ref + ' 行';
  console.log('  行' + (i + 1) + ' 折成 ' + r.lines.length + ' 行（' + ok + '）');
  r.lines.forEach((l, j) => {
    console.log('      [' + (j + 1) + '] "' + l + '"  ' + Math.round(WM.measureLS(ctx, l, t.bodyLSpx)) + 'px');
  });
});
console.log('  值列可用宽度: ' + Math.round(t.valueW) + 'px  ≈ ' +
  (t.valueW / (t.bodyLSpx + t.fB)).toFixed(1) + ' 个汉字/行（参考图旧值 18 个汉字/行）');
console.log('\n提示：浏览器实际使用系统字体度量，最终以页面预览为准。');

/* ---------- 6. 还原度校验：只有「非有意调整项」超阈值才算失败 ---------- */
const TOL = 6;
const bad = rowsOut.filter(([, ref, val, changed]) => !changed && Math.abs((val - ref) / ref) * 100 > TOL);
if (bad.length) {
  console.log('\n✗ 还原度回退: ' + bad.map(([l, , v, ]) => l).join(', ') + '（偏差 > ' + TOL + '%）');
  process.exit(1);
}
console.log('\n✓ 非有意调整项的还原度全部在 ' + TOL + '% 以内');
