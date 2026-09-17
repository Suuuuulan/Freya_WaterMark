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
    rect() {}, clip() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {},
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

/* ---------- 4. 参考图实测值 ---------- */
const REF = {
  marginX: 39, marginY: 40,
  tableW: 931, tableH: 335, tableX: 39,
  headerH: 96, dotD: 29, dotX: 49,
  titleGlyphH: 44, bodyGlyphH: 40, rowPitch: 60,
  bodyPadX: 21, padX: 23.4, padBodyTop: 26,
  labelEndX: 324, valueX: 359, valueRightX: 921,
  logoW: 266, logoH: 122, logoBlockH: 158,
  row1Lines: 1, row2Lines: 2
};

const logoH = BASE * WM.M.logoW * (135 / 295);
const got = {
  marginX: mx, marginY: my,
  tableW: t.w, tableH: t.h, tableX: x,
  headerH: t.headerH, dotD: t.dotD, dotX: t.dotX,
  titleGlyphH: t.fH, bodyGlyphH: t.fB,
  rowPitch: t.lineH + t.rowGap,  bodyPadX: t.bodyPadX, padX: t.padX, padBodyTop: t.padBodyTop,
  labelEndX: x + t.bodyPadX + t.labelW,
  valueX: x + t.bodyPadX + t.labelW + t.gap,
  valueRightX: x + t.bodyPadX + t.labelW + t.gap + t.valueW,
  logoW: BASE * WM.M.logoW,
  logoH: logoH,
  logoBlockH: logoH + BASE * (WM.M.codeGap + WM.M.codeSize * 1.3)
};

const rowsOut = [
  ['表格左边距', REF.marginX, got.marginX],
  ['表格底边距', REF.marginY, got.marginY],
  ['表格宽度', REF.tableW, got.tableW],
  ['表格高度', REF.tableH, got.tableH],
  ['顶栏高度', REF.headerH, got.headerH],
  ['圆点直径', REF.dotD, got.dotD],
  ['圆点中心X(表内)', REF.dotX, got.dotX],
  ['标题字号', REF.titleGlyphH, got.titleGlyphH],
  ['正文字号', REF.bodyGlyphH, got.bodyGlyphH],
  ['行基准间距', REF.rowPitch, got.rowPitch],
  ['正文左内边距', REF.bodyPadX, got.bodyPadX],
  ['顶栏左右内边距', REF.padX, got.padX],
  ['正文前留白', REF.padBodyTop, got.padBodyTop],
  ['标签列结束X', REF.labelEndX, got.labelEndX],
  ['值列起始X', REF.valueX, got.valueX],
  ['值列结束X', REF.valueRightX, got.valueRightX],
  ['logo 宽度', REF.logoW, got.logoW],
  ['logo 高度', REF.logoH, got.logoH],
  ['logo+防伪码块高', REF.logoBlockH, got.logoBlockH]
];

console.log('CJK ratio = ' + CJK_RATIO + '\n');
console.log('项目                    参考   计算    偏差');
console.log('------------------------------------------------');
let worst = 0, worstName = '';
for (const [label, ref, val] of rowsOut) {
  const pct = ((val - ref) / ref) * 100;
  if (Math.abs(pct) > Math.abs(worst)) { worst = pct; worstName = label; }
  const flag = Math.abs(pct) > 6 ? '  <<< 偏差大' : (Math.abs(pct) > 3 ? '  <' : '');
  console.log(
    label.padEnd(20, ' ') + String(Math.round(ref * 10) / 10).padStart(7) +
    String(Math.round(val * 10) / 10).padStart(8) +
    (pct >= 0 ? '   +' : '   ') + pct.toFixed(1) + '%' + flag
  );
}
console.log('------------------------------------------------');
console.log('最大偏差: ' + worst.toFixed(1) + '%  (' + worstName + ')');

/* ---------- 5. 折行检查 ---------- */
console.log('\n折行检查（浏览器里 Microsoft YaHei 汉字宽 = 1em）：');
t.rows.forEach((r, i) => {
  const ref = i === 0 ? REF.row1Lines : REF.row2Lines;
  const ok = r.lines.length === ref ? '与参考一致' : '参考为 ' + ref + ' 行';
  console.log('  行' + (i + 1) + ' 折成 ' + r.lines.length + ' 行（' + ok + '）');
  r.lines.forEach((l, j) => {
    console.log('      [' + (j + 1) + '] "' + l + '"  ' + Math.round(WM.measureLS(ctx, l, t.bodyLSpx)) + 'px');
  });
});
console.log('  值列可用宽度: ' + Math.round(t.valueW) + 'px  ≈ ' +
  (t.valueW / (t.fB + t.bodyLSpx)).toFixed(1) + ' 个汉字/行');
console.log('  参考图值列约 18 个汉字/行');
console.log('\n提示：浏览器实际使用系统字体度量，最终以页面预览为准。');
