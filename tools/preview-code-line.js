/* preview-code-line.js — 开发期目视校对：把「右下防伪块」用真实渲染引擎画一遍，
 * 记录每个字形的落点/字号/颜色，导出成 SVG（可用浏览器直接打开放大看）。
 * 不参与线上功能，也不被 index.html 引用。
 *
 * 用法: node tools/preview-code-line.js [输出目录]
 *
 * 说明：Node 里没有 canvas 字体度量，这里用与 verify.js 同源的度量 shim；
 * SVG 里保留真实 font-family/font-size/font-weight，字形由看图端渲染
 * （Windows 上会落到微软雅黑，与浏览器效果一致）。
 * 为了让预览聚焦在右下角，这里只画 logo + 防伪码行（不画信息表格）。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = process.argv[2] || path.join(root, 'tools', '_data');
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 字体度量 shim（与 verify.js / test-render.js 同源） ---------- */
const CJK = 1.0, DIGIT = 0.556, UPPER = 0.66, LOWER = 0.52, PUNCT = 0.30, SPACE = 0.28;
const isCJK = (ch) => /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch);
const fontPxOf = (f) => { const m = /(\d+(?:\.\d+)?)px/.exec(String(f || '')); return m ? parseFloat(m[1]) : 0; };

function makeCtx() {
  let size = 16, fontStr = '16px sans-serif';
  const ops = [];
  const noop = () => {};
  const ctx = {
    ops, globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, shadowOffsetX: 0,
    textBaseline: 'alphabetic', textAlign: 'start',
    save: noop, restore: noop, setTransform: noop, clearRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, arcTo: noop, closePath: noop,
    rect: noop, arc: noop, clip: noop, fill: noop, fillRect: noop, drawImage: noop,
    translate: noop, rotate: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fillText(t, x, y) { ops.push({ t: String(t), x, y, size, font: fontStr, color: String(ctx.fillStyle) }); },
    measureText(text) {
      let w = 0;
      for (const ch of String(text)) {
        if (isCJK(ch)) w += size * CJK;
        else if (ch === ' ') w += size * SPACE;
        else if (/[0-9]/.test(ch)) w += size * DIGIT;
        else if (/[A-Z]/.test(ch)) w += size * UPPER;
        else if (/[a-z]/.test(ch)) w += size * LOWER;
        else if (/[.:·\-/_]/.test(ch)) w += size * PUNCT;
        else w += size * 0.5;
      }
      return { width: w };
    }
  };
  Object.defineProperty(ctx, 'font', {
    get() { return fontStr; },
    set(v) { const m = /(\d+(?:\.\d+)?)px/.exec(v); size = m ? parseFloat(m[1]) : 16; fontStr = String(v); },
    enumerable: true, configurable: true
  });
  return ctx;
}

/* ---------- 载入真实渲染引擎 ---------- */
const ctx = makeCtx();
global.document = { createElement: () => ({ getContext: () => ctx }) };
global.Image = function () {
  this.naturalWidth = 295; this.naturalHeight = 135;
  Object.defineProperty(this, 'src', {
    set() { if (this.onload) setTimeout(() => this.onload(), 0); },
    get() { return ''; }
  });
};
const mod = { exports: {} };
new Function('module', 'window', 'globalThis', 'document', 'Image',
  fs.readFileSync(path.join(root, 'src', 'render.js'), 'utf8'))(mod, global, global, global.document, global.Image);
const WM = global.FreyaWM;
const M = WM.M;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = 'Microsoft YaHei, PingFang SC, Hiragino Sans GB, sans-serif';

/** 只画右下角防伪块（不画表格），导出 SVG + 打印关键几何 */
function renderCase(name, overrides, codeLen, label) {
  const p = Object.assign({}, WM.DEFAULTS, overrides, { codeLen, showTable: false });
  p.code = WM.randomCode(codeLen);
  const W = 1773, H = 2364, BASE = 1773;
  const rows = [];   // 预览聚焦防伪块：不画信息表格

  const rend = WM.createRenderer({ logoUrl: 'data:image/png;base64,x' });
  // 必须等 logo onload（否则引擎走 drawLogoFallback，预览的就不是真实效果）
  return new Promise((resolve) => setTimeout(() => {
    ctx.ops.length = 0;
    const out = rend.draw(ctx, p, W, H, BASE, rows);
    const L = out.logo;
    const blockH = out.bottom - L.y;                 // logo 图 + 防伪码行
    const PAD = 10;
    const bx = L.x - PAD, by = L.y - PAD;
    const bw = L.w + PAD * 2, bh = blockH + PAD * 2;

    const texts = ctx.ops.filter((o) => o.t !== undefined && o.y > L.y - 1);
    const codeTexts = texts.filter((o) => o.t.length === 1 && fontPxOf(o.font) < 19);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(bw * 2.4)}" height="${Math.round(bh * 2.4)}" `
      + `viewBox="${bx.toFixed(2)} ${by.toFixed(2)} ${bw.toFixed(2)} ${bh.toFixed(2)}">\n`;
    svg += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#2f343a"/>\n`;
    svg += `<!-- logo 图片占位（预览不内嵌真实 png，只看版式） -->\n`;
    svg += `<rect x="${L.x.toFixed(2)}" y="${L.y.toFixed(2)}" width="${L.w.toFixed(2)}" height="${L.h.toFixed(2)}" `
      + `fill="#14181c" stroke="#4a545f" stroke-width="0.7"/>\n`;
    svg += `<text x="${(L.x + L.w / 2).toFixed(2)}" y="${(L.y + L.h / 2).toFixed(2)}" font-family="${FONT}" `
      + `font-size="11" fill="#5d6670" text-anchor="middle" dominant-baseline="middle">logo 图片区域</text>\n`;
    // 图片右下边距参考线（虚线，用于核对防伪块是否贴边距）
    const mx = BASE * p.marginX / 100, my = BASE * p.marginY / 100;
    svg += `<line x1="${(W - mx).toFixed(2)}" y1="${by.toFixed(2)}" x2="${(W - mx).toFixed(2)}" y2="${(by + bh).toFixed(2)}" `
      + `stroke="#e05a5a" stroke-width="0.4" stroke-dasharray="3 2"/>\n`;
    svg += `<line x1="${bx.toFixed(2)}" y1="${(H - my).toFixed(2)}" x2="${(bx + bw).toFixed(2)}" y2="${(H - my).toFixed(2)}" `
      + `stroke="#e05a5a" stroke-width="0.4" stroke-dasharray="3 2"/>\n`;

    for (const o of texts) {
      const sz = fontPxOf(o.font) || o.size;
      svg += `<text x="${o.x.toFixed(2)}" y="${o.y.toFixed(2)}" font-family="${FONT}" font-size="${sz.toFixed(2)}" `
        + `font-weight="${/bold/.test(o.font) ? 'bold' : 'normal'}" fill="${o.color}" `
        + `dominant-baseline="middle" text-anchor="middle" xml:space="preserve">${esc(o.t)}</text>\n`;
    }
    svg += `</svg>\n`;
    const file = path.join(outDir, `code-line-${name}.svg`);
    fs.writeFileSync(file, svg, 'utf8');
    // 同时写一个 HTML 包装（SVG 用 UTF-8 内联，便于浏览器直接打开）
    fs.writeFileSync(path.join(outDir, `code-line-${name}.html`),
      `<!DOCTYPE html><html><head><meta charset="utf-8">`
      + `<style>html,body{margin:0;background:#3a3f45}svg{display:block}</style></head><body>`
      + svg + '</body></html>\n', 'utf8');

    const xs = codeTexts.map((o) => o.x).sort((a, b) => a - b);
    const fs1 = codeTexts.length ? fontPxOf(codeTexts[0].font) : 0;
    const labelTexts = texts.filter((o) => isCJK(o.t));
    console.log(`${label}\n  ${file}`);
    console.log(`  码=${p.code}（${codeLen} 位） 标签字号=${labelTexts.length ? fontPxOf(labelTexts[0].font).toFixed(1) : '-'}px 码字号=${fs1.toFixed(1)}px`);
    console.log(`  防伪块 x=${L.x.toFixed(1)} y=${L.y.toFixed(1)} 宽=${L.w.toFixed(1)} 高=${blockH.toFixed(1)} `
      + `右边距=${(W - L.x - L.w).toFixed(1)} 底边距=${(H - out.bottom).toFixed(1)}`);
    console.log(`  码字 x=${xs.length ? xs[0].toFixed(1) + '..' + xs[xs.length - 1].toFixed(1) : '-'} `
      + `步进=${xs.length > 1 ? (xs[1] - xs[0]).toFixed(2) : '-'} 颜色=${[...new Set(codeTexts.map((o) => o.color))].join('/')} `
      + `加粗=${[...new Set(codeTexts.map((o) => /bold/.test(o.font)))].join('/')}`);
    resolve();
  }, 30));
}

(async () => {
  await renderCase('default-10', {}, 10, '① 默认 10 位');
  await renderCase('ref-14', {}, 14, '② 参考图示例 14 位');
  await renderCase('long-24', {}, 24, '③ 上限 24 位');
  await renderCase('tiny-400px', { scale: 0.6 }, 14, '④ 小图（短边 400px 等效缩放）');
  console.log('\n用浏览器打开上面任意 .svg 可放大目视校对（红色虚线 = marginX/marginY 边距）。');
})();
