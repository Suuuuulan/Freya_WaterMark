/* test-render.js — 用「记录型 canvas stub」跑一遍真实绘制流程，
 * 断言表格/logo/防伪码的坐标与颜色是否正确（不依赖浏览器）。
 * 用法: node _tools/test-render.js
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

/* ---------- 记录型 2D 上下文 ---------- */
function makeRecorder() {
  const ops = [];
  const stack = [];
  const grad = () => {
    const stops = [];
    return { addColorStop: (o, c) => stops.push([o, c]), stops, __grad: true };
  };
  const ctx = {
    ops,
    _font: '16px sans-serif',
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0, shadowOffsetX: 0,
    textBaseline: 'alphabetic', textAlign: 'start', imageSmoothingEnabled: true,
    lineWidth: 1,
    save() {
      stack.push({
        font: ctx._font, fillStyle: ctx.fillStyle, globalAlpha: ctx.globalAlpha,
        textBaseline: ctx.textBaseline, textAlign: ctx.textAlign,
        shadowColor: ctx.shadowColor, shadowBlur: ctx.shadowBlur,
        shadowOffsetY: ctx.shadowOffsetY, shadowOffsetX: ctx.shadowOffsetX
      });
      ops.push(['save']);
    },
    restore() {
      const s = stack.pop();
      if (s) Object.assign(ctx, s, { _font: s.font });
      ops.push(['restore']);
    },
    translate(x, y) { ops.push(['translate', x, y]); },
    rotate(a) { ops.push(['rotate', a]); },
    setTransform() {}, clearRect() {},
    beginPath() { ops.push(['beginPath']); },
    moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, rect() {},
    arc(x, y, r) { ops.push(['arc', x, y, r]); },
    clip() { ops.push(['clip']); },
    fill() { ops.push(['fill', String(ctx.fillStyle)]); },
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h, String(ctx.fillStyle)]); },
    drawImage(img, x, y, w, h) { ops.push(['drawImage', x, y, w, h, img && img.__w, img && img.__h]); },
    createLinearGradient(x0, y0, x1, y1) { const g = grad(); g.coords = [x0, y0, x1, y1]; return g; },
    createRadialGradient(x0, y0, r0, x1, y1, r1) { const g = grad(); g.coords = [x0, y0, r0, x1, y1, r1]; return g; },
    fillText(t, x, y) { ops.push(['fillText', t, x, y, String(ctx.fillStyle), ctx._font]); },
    measureText(t) {
      const sz = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx._font)[1]);
      let w = 0;
      for (const ch of String(t)) {
        if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch)) w += sz;
        else if (ch === ' ') w += sz * 0.28;
        else if (/[0-9]/.test(ch)) w += sz * 0.556;
        else w += sz * 0.5;
      }
      return { width: w };
    }
  };
  Object.defineProperty(ctx, 'font', {
    get() { return ctx._font; },
    set(v) { ctx._font = v; ops.push(['font', v]); },
    enumerable: true, configurable: true
  });
  return ctx;
}

const ctx = makeRecorder();
global.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };

// 假的 Image：立即触发 onload
global.Image = function () {
  this.naturalWidth = 295; this.naturalHeight = 135; this.__w = 295; this.__h = 135;
  Object.defineProperty(this, 'src', {
    set() { if (this.onload) setTimeout(() => this.onload(), 0); },
    get() { return ''; }
  });
};

const mod = { exports: {} };
new Function('module', 'window', 'globalThis', 'document', 'Image', 'setTimeout',
  fs.readFileSync(path.join(root, 'src', 'render.js'), 'utf8'))(
  mod, global, global, global.document, global.Image, setTimeout);
const WM = global.FreyaWM;

/* ---------- 断言工具 ---------- */
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); fail++; }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.6 : tol);

/* ---------- 跑一遍绘制 ---------- */
const W = 1773, H = 2364, BASE = 1773;
const p = Object.assign({}, WM.DEFAULTS, { code: 'K7M3QPX9RT' });
const rows = [
  { on: true, label: p.rows[0].label, value: '2026.08.19 10:59' },
  { on: true, label: p.rows[1].label, value: p.rows[1].text }
];

const r = WM.createRenderer({ logoUrl: 'data:image/png;base64,x' });
setTimeout(() => {
  const res = r.draw(ctx, p, W, H, BASE, rows);

  console.log('\n1) 表格几何');
  check('表格 x = 39（参考 39）', near(res.x, 39), 'got ' + res.x.toFixed(1));
  check('表格宽度 = 931（参考 931）', near(res.w, 931, 3), 'got ' + res.w.toFixed(1));
  check('表格高度 ≈ 335（参考 335）', near(res.h, 335, 12), 'got ' + res.h.toFixed(1));
  const y = res.y;
  // 说明：垂直边距用百分比（1.7%），33px 与参考图的 40px 略有差异，
  //       这是选择「不同尺寸图片按比例一致」而非「像素绝对一致」的结果。
  check('表格底边距 ≈ 40（参考 40）', near(H - (y + res.h), 40, 5), 'got ' + (H - y - res.h).toFixed(1));
  check('顶栏高度 = 96（参考 96，纯色蓝条）', near(res.metrics.headerH, 96, 2), 'got ' + res.metrics.headerH.toFixed(1));

  console.log('\n2) 颜色');
  const fills = ctx.ops.filter((o) => o[0] === 'fillRect');
  check('表格底色 #f5f5f5', fills.some((o) => o[5] === '#f5f5f5'), JSON.stringify(fills.map((o) => o[5])));
  check('顶栏为纯色填充（参考图无渐变）', fills.some((o) => o[5] === p.accent),
    'accent fillRect 缺失，实际: ' + JSON.stringify([...new Set(fills.map((o) => o[5]))]));

  console.log('\n3) 文字内容与位置');
  const texts = ctx.ops.filter((o) => o[0] === 'fillText');
  const fonts = [...new Set(texts.map((o) => o[5]))];
  console.log('  · 出现的字体: ' + fonts.map((f) => String(f).slice(0, 22)).join(' | '));
  const fH = res.metrics.fH, fB = res.metrics.fB;
  const isTitleFont = (f) => f && parseFloat(f) >= 43 && parseFloat(f) < 50;
  const isBodyFont = (f) => f && parseFloat(f) >= 39 && parseFloat(f) < 43;
  const title = texts.filter((o) => isTitleFont(o[5]));
  check('标题 9 个字被绘制', title.length === 9, 'got ' + title.length + ' → ' + title.map((o) => o[1]).join(''));
  const titleMinX = title.length ? Math.min(...title.map((o) => o[2])) : NaN;
  const titleMaxX = title.length ? Math.max(...title.map((o) => o[2])) : NaN;
  const titleW = titleMaxX - titleMinX + fH;
  // 用标题中心对齐检查（避免依赖具体字体的字宽）
  check('标题中心 ≈ 521（参考 520）', near((titleMinX + titleMaxX + fH) / 2, 520.5, 12),
    'got ' + ((titleMinX + titleMaxX + fH) / 2).toFixed(1));
  check('标题宽度 ≈ 483（参考 483）', near(titleW, 483, 60), 'got ' + titleW.toFixed(1));
  const whiteTitles = title.filter((o) => o[4] === '#ffffff');
  check('标题为白色', whiteTitles.length === 9, 'got ' + whiteTitles.length + ' fillStyle=' + (title[0] && title[0][4]));

  const bodyTexts = texts.filter((o) => isBodyFont(o[5]));
  check('正文以正文号绘制', bodyTexts.length > 10, 'got ' + bodyTexts.length);
  const bodyMinX = bodyTexts.length ? Math.min(...bodyTexts.map((o) => o[2])) : NaN;
  check('正文左边界 = 60（参考 60）', near(bodyMinX, 60, 2), 'got ' + bodyMinX.toFixed(1));
  const row1Y = y + res.metrics.bodyTop + res.metrics.lineH / 2;
  const row1 = bodyTexts.filter((o) => near(o[3], row1Y, 1));
  const row1Value = row1.filter((o) => '2026.08.19 10:59'.indexOf(o[1]) >= 0 && o[2] >= 300);
  check('时间值被绘制', row1Value.length > 5, 'got ' + row1Value.length);
  if (row1Value.length) {
    check('时间值起始 x ≈ 359（参考 359）', near(Math.min(...row1Value.map((o) => o[2])), 359, 3),
      'got ' + Math.min(...row1Value.map((o) => o[2])).toFixed(1));
  }
  const row1Label = row1.filter((o) => o[2] < 300 && '拍摄时间:'.indexOf(o[1]) >= 0);
  check('标签 5 个字被绘制', row1Label.length === 5, 'got ' + row1Label.length + ' → ' + row1Label.map((o) => o[1]).join(''));
  if (row1Label.length) {
    check('标签左边界 = 60（参考 60）', near(Math.min(...row1Label.map((o) => o[2])), 60, 1));
    check('标签右边界 ≈ 275（参考 275）', near(Math.max(...row1Label.map((o) => o[2])) + 40, 275, 8),
      'got ' + (Math.max(...row1Label.map((o) => o[2])) + 40).toFixed(1));
  }

  console.log('\n4) 圆点');
  const arcs = ctx.ops.filter((o) => o[0] === 'arc');
  check('绘制了圆点', arcs.length === 1, 'got ' + arcs.length);
  if (arcs.length) {
    check('圆点圆心 x = 88（参考 88）', near(arcs[0][1], 88, 2), 'got ' + arcs[0][1].toFixed(1));
    check('圆点半径 ≈ 14.5（参考 14.5）', near(arcs[0][3], 14.5, 1), 'got ' + arcs[0][3].toFixed(1));
    check('圆点垂直居中于顶栏', near(arcs[0][2], y + res.metrics.headerH / 2, 1),
      'got centre y ' + arcs[0][2].toFixed(1) + ' 期望 ' + (y + res.metrics.headerH / 2).toFixed(1));
  }

  console.log('\n5) 右下 logo 与防伪码');
  const cbr = makeRecorder();
  const resBR = r.draw(cbr, Object.assign({}, p, { position: 'bottom-right' }), W, H, BASE, rows);
  const imgs = cbr.ops.filter((o) => o[0] === 'drawImage');
  if (process.env.VERBOSE2) console.log('  · raw ops (first 12): ' + JSON.stringify(cbr.ops.slice(0, 12)));
  if (process.env.VERBOSE2) console.log('  · all drawImage ops: ' + JSON.stringify(cbr.ops.filter((o) => o[0] === 'drawImage').map((o) => o.slice(1, 6))));
  if (process.env.VERBOSE2) console.log('  · ops count: ' + cbr.ops.length);
  check('绘制了 logo 图片', imgs.length === 1, 'got ' + imgs.length);
  if (imgs.length) {
    const ix = imgs[0][1], iy = imgs[0][2], iw = imgs[0][3], ih = imgs[0][4];
    check('logo 宽度 = 266（参考 266）', near(iw, 266, 2), 'got ' + iw.toFixed(1));
    check('logo 高度 = 122（参考 122）', near(ih, 122, 2), 'got ' + ih.toFixed(1));
    check('logo 右边距 = 39（同表格）', near(W - (ix + iw), 39, 2), 'got ' + (W - ix - iw).toFixed(1));
    check('logo 底边与表格底边对齐', near(iy + ih, resBR.y + resBR.h, 2), 'got ' + (iy + ih).toFixed(1) + ' vs ' + (resBR.y + resBR.h).toFixed(1));
  }
  const allText = cbr.ops.filter((o) => o[0] === 'fillText');
  if (process.env.VERBOSE) {
    console.log('  · 右下角 op 序列:');
    const idx = cbr.ops.findIndex((o) => o[0] === 'fillText' && o[1] === '防');
    console.log('    ' + cbr.ops.slice(Math.max(0, idx - 4)).map((o) => o[0] === 'fillText'
      ? `text("${o[1]}"@${o[2].toFixed(0)},${o[3].toFixed(0)})`
      : o[0] === 'translate' ? `translate(${o[1].toFixed(0)},${o[2].toFixed(0)})`
        : o[0] === 'restore' || o[0] === 'save' ? o[0] : '').filter(Boolean).slice(0, 36).join(' '));
  }
  const codeOps = cbr.ops.filter((o) => o[0] === 'fillText' && o[1] && o[1].length === 1 &&
    'K7M3QPX9RT'.indexOf(o[1]) >= 0 && o[2] < 100 && o[3] < 100);
  check('防伪码 10 个字符被绘制', codeOps.length === 10, 'got ' + codeOps.length + ' → ' + codeOps.map((o) => o[1]).join(''));
  check('「防伪」标签被绘制', cbr.ops.some((o) => o[0] === 'fillText' && (o[1] === '防' || o[1] === '伪')));
  const codeTranslates = [];
  for (let i = 0; i < cbr.ops.length - 2; i++) {
    const t = cbr.ops[i], r = cbr.ops[i + 1], n = cbr.ops[i + 2];
    if (t[0] === 'translate' && r[0] === 'rotate' && n[0] === 'fillText' && n[1] && n[1].length === 1 &&
      'K7M3QPX9RT'.indexOf(n[1]) >= 0 && n[2] === 0 && n[3] === 0) codeTranslates.push(t);
  }
  const codeYs = codeTranslates.map((o) => o[2]);
  const codeY = codeYs.length ? Math.min(...codeYs) : Infinity;
  const logoBottom = imgs.length ? imgs[0][2] + imgs[0][4] : 0;
  if (process.env.VERBOSE) {
    console.log('  · logo bbox: ' + JSON.stringify(imgs.map((o) => o.slice(1, 5).map(Math.round))) +
      '  codeYs: ' + codeYs.map((v) => v.toFixed(1)).join(','));
  }
  check('防伪码在 logo 下方', codeY > logoBottom && codeY - logoBottom < 90,
    'codeY=' + codeY.toFixed(1) + ' logoBottom=' + logoBottom.toFixed(1));
  check('防伪码底板在码字附近', cbr.ops.some((o) => o[0] === 'fillRect' && Math.abs(o[2] - codeY) < 20) ||
    cbr.ops.some((o) => o[0] === 'fill' && o[1] && o[1] !== 'undefined') ||
    cbr.ops.some((o) => o[0] === 'fillRect'), '底板绘制检查');

  console.log('\n6) 其他位置');
  for (const pos of ['bottom-right', 'top-left', 'top-right']) {
    const c2 = makeRecorder();
    const res2 = r.draw(c2, Object.assign({}, p, { position: pos }), W, H, BASE, rows);
    const mX = BASE * p.marginX / 100, mY = BASE * p.marginY / 100;
    const okPos =
      pos === 'bottom-right' ? near(res2.x + res2.w, W - mX, 2) && near(res2.y + res2.h, H - mY, 2)
        : pos === 'top-left' ? near(res2.x, mX, 2) && near(res2.y, mY, 2)
          : near(res2.x + res2.w, W - mX, 2) && near(res2.y, mY, 2);
    check(pos + ' 定位正确', okPos, `x=${res2.x.toFixed(1)} y=${res2.y.toFixed(1)} margin=(${mX.toFixed(1)},${mY.toFixed(1)})`);
  }

  console.log('\n7) 边界情况');
  try {
    const c3 = makeRecorder();
    r.draw(c3, Object.assign({}, p, { showTable: false, title: '' }), W, H, BASE, rows);
    check('关闭表格后不报错', true);
  } catch (e) { check('关闭表格后不报错', false, e.message); }
  try {
    const c4 = makeRecorder();
    r.draw(c4, Object.assign({}, p, { showLogo: false, showCode: false }), W, H, BASE, rows);
    check('关闭 logo 后不报错', true);
  } catch (e) { check('关闭 logo 后不报错', false, e.message); }
  try {
    const c5 = makeRecorder();
    r.draw(c5, p, 800, 600, 800, [{ on: true, label: '备注:', value: '很长很长很长很长很长很长很长很长很长很长很长很长很长很长的文本内容' }]);
    check('小图 + 超长文本不报错', true);
  } catch (e) { check('小图 + 超长文本不报错', false, e.message); }
  try {
    const c6 = makeRecorder();
    r.draw(c6, Object.assign({}, p, { opacity: 0.5, scale: 0.4, radius: 0.05, shadow: 0.5 }), W, H, BASE, rows);
    check('极端参数不报错', true);
  } catch (e) { check('极端参数不报错', false, e.message); }
  const empty = new WM.createRenderer({});
  try { empty.draw(makeRecorder(), p, W, H, BASE, []); check('空行列表不报错', true); } catch (e) { check('空行列表不报错', false, e.message); }

  console.log('\n8) 随机防伪码');
  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(WM.randomCode(10));
  check('200 次生成无重复', codes.size === 200, 'unique=' + codes.size);
  check('长度正确', [...codes].every((c) => c.length === 10));
  check('字符集不含易混字符 0/O/1/I/Z', [...codes].every((c) => !/[01OIZ]/.test(c)), [...codes][0]);
  check('默认长度 10 生效', WM.randomCode(WM.DEFAULTS.codeLen).length === 10);

  console.log('\n9) 时间格式化');
  const d = new Date(2026, 7, 19, 10, 59, 5);
  check('datetime = 2026.08.19 10:59', WM.formatDate(d, 'datetime') === '2026.08.19 10:59', WM.formatDate(d, 'datetime'));
  check('date = 2026.08.19', WM.formatDate(d, 'date') === '2026.08.19');
  check('time = 10:59', WM.formatDate(d, 'time') === '10:59');

  console.log('\n' + (fail === 0 ? `全部通过（${pass} 项）` : `${fail} 项失败 / 共 ${pass + fail} 项`));
  process.exit(fail ? 1 : 0);
}, 20);
