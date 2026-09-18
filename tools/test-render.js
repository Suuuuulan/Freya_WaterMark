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
    fillRect(x, y, w, h) { ops.push(['fillRect', x, y, w, h, String(ctx.fillStyle), ctx.globalAlpha]); },
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
/** 从 canvas font 串取字号（兼容 "bold 18px …" 这类带字重前缀的写法） */
const fontPx = (f) => { const m = /(\d+(?:\.\d+)?)px/.exec(String(f)); return m ? parseFloat(m[1]) : NaN; };

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
  check('表格 x = 39（左边距 2.2%×1773）', near(res.x, 39), 'got ' + res.x.toFixed(1));
  // 表格宽度 = 参考图比例（不随字高变化加宽）；值列会占满表格剩余宽度
  check('表格宽度 = 参考图比例（931 @1773）', near(res.w, BASE * WM.M.tableW, 2),
    'got ' + res.w.toFixed(1) + ' 期望 ' + (BASE * WM.M.tableW).toFixed(1));
  check('值列占满表格剩余宽度（比参考 562px 更宽）', res.metrics.valueW > 562,
    'valueW=' + res.metrics.valueW.toFixed(0));
  // 表格高度受「与右下防伪块共存」的等比缩放约束，按算出的 scale 校验
  const t1 = res.metrics;
  const derivedH = t1.headerH + t1.padBodyTop + t1.padBottom +
    t1.rows.reduce((s, r) => s + r.h + t1.rowGap, 0) - (t1.rows.length ? t1.rowGap : 0);
  check('表格高度与各部分之和一致', near(res.h, derivedH, 1.5),
    'got ' + res.h.toFixed(1) + ' 期望 ' + derivedH.toFixed(1));
  const y = res.y;
  check('表格底边距 ≈ 40（参考 40）', near(H - (y + res.h), 40, 5), 'got ' + (H - y - res.h).toFixed(1));
  check('顶栏高度随标题字号等比放大', near(res.metrics.headerH, 96 * WM.DEFAULTS.titleFontScale, 2),
    'got ' + res.metrics.headerH.toFixed(1) + ' 期望 ' + (96 * WM.DEFAULTS.titleFontScale).toFixed(1));
  check('标题竖直方向留有余量（不裁切）', res.metrics.headerH >= res.metrics.titleLineH,
    '顶栏=' + res.metrics.headerH.toFixed(1) + ' 标题行高=' + res.metrics.titleLineH.toFixed(1));
  check('正文字高 = 参考字高 ×1.2（120%）', near(res.metrics.fB, BASE * WM.M.bodyFont * 1.2, 0.5),
    'got ' + res.metrics.fB.toFixed(1) + ' 期望 ' + (BASE * WM.M.bodyFont * 1.2).toFixed(1));
  check('默认字体族为黑体（SimHei）', /SimHei/.test(WM.DEFAULTS.fontFamily), WM.DEFAULTS.fontFamily.slice(0, 24));
  check('正文字距已收紧（默认 0.06em）', WM.DEFAULTS.bodyLS <= 0.08, 'bodyLS=' + WM.DEFAULTS.bodyLS);

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
  // 默认字体为黑体加粗 → 字号判断要兼容 "bold 48px …" 前缀
  const isTitleFont = (f) => fontPx(f) >= fH - 2 && fontPx(f) < fH + 2;
  const isBodyFont = (f) => fontPx(f) >= fB - 2 && fontPx(f) < fB + 2;
  const title = texts.filter((o) => isTitleFont(o[5]));
  check('标题 9 个字被绘制', title.length === 9, 'got ' + title.length + ' → ' + title.map((o) => o[1]).join(''));
  const titleMinX = title.length ? Math.min(...title.map((o) => o[2])) : NaN;
  const titleMaxX = title.length ? Math.max(...title.map((o) => o[2])) : NaN;
  const titleW = titleMaxX - titleMinX + fH;
  // 用标题中心对齐检查（避免依赖具体字体的字宽）；期望值由引擎的 titleCenterX 给出
  const expectTitleCx = res.x + res.metrics.titleCenterX;
  check('标题中心 = 引擎 titleCenterX', near((titleMinX + titleMaxX + fH) / 2, expectTitleCx, 12),
    'got ' + ((titleMinX + titleMaxX + fH) / 2).toFixed(1) + ' 期望 ' + expectTitleCx.toFixed(1));
  check('标题宽度随字号放大（含字距）', near(titleW, 646, 80),
    'got ' + titleW.toFixed(1) + ' 期望 ≈646');
  // 字距：绝对值 8px（不随字号放大而变宽），且标题总宽必须装得进表格
  check('标题字距为绝对值 px（不随字号等比放大）', near(res.metrics.titleLSpx, WM.DEFAULTS.titleLS, 0.5),
    'titleLSpx=' + res.metrics.titleLSpx.toFixed(2) + ' 期望 ' + WM.DEFAULTS.titleLS);
  check('标题总宽装得进顶栏（除圆点区）',
    titleW <= res.w - res.metrics.padX * 2 - res.metrics.dotBlock + 1,
    '标题=' + titleW.toFixed(1) + ' 可用≈' + (res.w - res.metrics.padX * 2 - res.metrics.dotBlock).toFixed(1));
  check('标题字号 = 跟随后再 ×1.2', near(res.metrics.fH, BASE * WM.M.headerFont * WM.DEFAULTS.bodyFontScale * WM.DEFAULTS.titleFontScale, 0.6),
    'fH=' + res.metrics.fH.toFixed(1));
  const whiteTitles = title.filter((o) => o[4] === '#ffffff');
  check('标题为白色', whiteTitles.length === 9, 'got ' + whiteTitles.length + ' fillStyle=' + (title[0] && title[0][4]));
  check('标题与正文均为加粗', title.length > 0 && title.every((o) => /^bold\s/.test(o[5])),
    'got ' + JSON.stringify([...new Set(title.map((o) => o[5]))].slice(0, 2)));

  const bodyTexts = texts.filter((o) => isBodyFont(o[5]));
  check('正文以正文号绘制', bodyTexts.length > 10, 'got ' + bodyTexts.length);
  check('正文为加粗', bodyTexts.length > 0 && bodyTexts.every((o) => /^bold\s/.test(o[5])),
    'got ' + JSON.stringify([...new Set(bodyTexts.map((o) => o[5]))].slice(0, 2)));
  const bodyMinX = bodyTexts.length ? Math.min(...bodyTexts.map((o) => o[2])) : NaN;
  const expectLabelX = res.x + res.metrics.bodyPadX;
  check('正文左边界 = 表格左 + 内边距', near(bodyMinX, expectLabelX, 2),
    'got ' + bodyMinX.toFixed(1) + ' 期望 ' + expectLabelX.toFixed(1));
  const row1Y = y + res.metrics.bodyTop + res.metrics.lineH / 2;
  const row1 = bodyTexts.filter((o) => near(o[3], row1Y, 1));
  // 用 valueX 作为「标签列 / 值列」分界，避免把标签里的 ":" 误当成时间值
  const valueStartX = res.x + res.metrics.valueX;
  const row1Value = row1.filter((o) => '2026.08.19 10:59'.indexOf(o[1]) >= 0 && o[2] >= valueStartX - 1);
  check('时间值被绘制', row1Value.length > 5, 'got ' + row1Value.length);
  if (row1Value.length) {
    check('时间值起始 x = 表格左 + valueX', near(Math.min(...row1Value.map((o) => o[2])), valueStartX, 1),
      'got ' + Math.min(...row1Value.map((o) => o[2])).toFixed(1) + ' 期望 ' + valueStartX.toFixed(1));
  }
  const row1Label = row1.filter((o) => o[2] < valueStartX - 1 && '拍摄时间:'.indexOf(o[1]) >= 0);
  check('标签 5 个字被绘制', row1Label.length === 5, 'got ' + row1Label.length + ' → ' + row1Label.map((o) => o[1]).join(''));
  if (row1Label.length) {
    const labelLeft = Math.min(...row1Label.map((o) => o[2]));
    const labelRight = Math.max(...row1Label.map((o) => o[2])) + res.metrics.fB;
    check('标签左边界 = 60（参考 60）', near(labelLeft, 60, 1));
    // 标签文字应在标签列内，且列宽容得下最长标签
    const colRight = res.x + res.metrics.labelEndX;
    check('标签文字在标签列内且不超过列宽', labelRight > labelLeft && labelRight <= colRight + 1,
      'ink=' + labelLeft.toFixed(1) + '..' + labelRight.toFixed(1) + ' 列右边界=' + colRight.toFixed(1));
    check('标签列宽度容得下最长标签', res.metrics.labelW >= res.metrics.rows[0].labelWpx - res.metrics.bodyLSpx,
      'labelW=' + res.metrics.labelW.toFixed(1) + ' 需要 ' + res.metrics.rows[0].labelWpx.toFixed(1));
  }

  console.log('\n3.4) 新增默认值与联动');
  check('圆角默认 16/1000', WM.DEFAULTS.radius === 0.016, 'radius=' + WM.DEFAULTS.radius);
  check('正文字距默认 0.00em', WM.DEFAULTS.bodyLS === 0, 'bodyLS=' + WM.DEFAULTS.bodyLS);
  check('表格不透明度默认 100%', WM.DEFAULTS.tableOpacity === 1, 'tableOpacity=' + WM.DEFAULTS.tableOpacity);
  check('防伪码字号默认 128%', WM.DEFAULTS.codeSize === 1.28, 'codeSize=' + WM.DEFAULTS.codeSize);
  check('标题字号跟随正文字高倍率（再 ×titleFontScale）',
    near(res.metrics.fH, BASE * WM.M.headerFont * WM.DEFAULTS.bodyFontScale * WM.DEFAULTS.titleFontScale, 0.6),
    'fH=' + res.metrics.fH.toFixed(1) + ' 期望 ' + (BASE * WM.M.headerFont * WM.DEFAULTS.bodyFontScale * WM.DEFAULTS.titleFontScale).toFixed(1));
  // 表格单独透明度：tableOpacity=0.5 时表格操作的 alpha 应约为 0.5
  const cT = makeRecorder();
  r.draw(cT, Object.assign({}, p, { tableOpacity: 0.5, showLogo: false }), W, H, BASE, rows);
  const tableFill = cT.ops.find((o) => o[0] === 'fillRect' && o[5] === p.bgColor);
  check('表格不透明度生效（tableOpacity=0.5）', !!tableFill && near(tableFill[6], 0.5, 0.02),
    'alpha=' + (tableFill ? tableFill[6] : 'n/a'));

  console.log('\n3.5) 行间灰色分隔线（固定 1px）');
  const seps = ctx.ops.filter((o) => o[0] === 'fillRect' && Math.abs(o[4] - WM.M.rowSepH) < 0.01);
  check('两行之间绘制了分隔线', seps.length === 1, 'got ' + seps.length + ' 条');
  if (seps.length) {
    check('分隔线高度 = 1px', Math.abs(seps[0][4] - 1) < 0.01, 'got ' + seps[0][4]);
    check('分隔线为灰色', /rgba\(0,0,0/.test(seps[0][5]), 'got ' + seps[0][5]);
    const sepExpectedY = y + res.metrics.bodyTop + res.metrics.rows[0].h + res.metrics.rowGap;
    check('分隔线位于第一行与第二行之间', near(seps[0][2], sepExpectedY, 1.5),
      'got ' + seps[0][2].toFixed(1) + ' 期望 ' + sepExpectedY.toFixed(1));
    check('分隔线位于表格内部', seps[0][1] >= res.x && seps[0][1] + seps[0][3] <= res.x + res.w + 0.5,
      'x=' + seps[0][1].toFixed(1) + ' w=' + seps[0][3].toFixed(1) + ' 表格=' + res.x.toFixed(1) + '..' + (res.x + res.w).toFixed(1));
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

  console.log('\n5) 右下防伪 logo 与防伪码');
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
    check('logo 右边距 = 39（参考 39）', near(W - (ix + iw), 39, 2), 'got ' + (W - ix - iw).toFixed(1));
    // 防伪标识锚定「图片」右下角：右边距 = marginX，底边距（含防伪码行）= marginY
    const logoBlockH = resBR.logo.h + resBR.metrics.codeLineH;
    check('防伪标识（含防伪码行）右下角贴图片边距',
      near(W - (ix + iw), BASE * p.marginX / 100, 2) && near(H - resBR.logo.y - logoBlockH, BASE * p.marginY / 100, 2),
      'rightGap=' + (W - ix - iw).toFixed(1) + ' bottomGap=' + (H - resBR.logo.y - logoBlockH).toFixed(1));
    check('返回的 bottom = 整块下沿（含防伪码行）', near(resBR.bottom, resBR.logo.y + logoBlockH, 1.5),
      'bottom=' + resBR.bottom.toFixed(1) + ' 期望 ' + (resBR.logo.y + logoBlockH).toFixed(1));
    check('防伪标识整体在图片右下象限', ix + iw > W / 2 && resBR.bottom > H / 2,
      'x=' + ix.toFixed(1) + ' bottom=' + resBR.bottom.toFixed(1));
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
  // 防伪码字：字符集固定（无 0/O/1/I/Z）且位于右下防伪块那一行
  // （表格里的数字/字母也在同一字符集，靠 y 落在 logo 之下排除）
  const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXY';
  const isCodeGlyph = (o) => o[0] === 'fillText' && o[1] && o[1].length === 1 &&
    CODE_CHARS.includes(o[1]) && o[3] > resBR.logo.y;
  const codeOps = cbr.ops.filter(isCodeGlyph);
  check('防伪码 10 个字符被绘制', codeOps.length === 10, 'got ' + codeOps.length + ' → ' + codeOps.map((o) => o[1]).join(''));
  check('「防伪」标签被绘制', cbr.ops.some((o) => o[0] === 'fillText' && (o[1] === '防' || o[1] === '伪')));
  const codeTranslates = [];
  for (let i = 0; i < cbr.ops.length - 2; i++) {
    const t = cbr.ops[i], r2 = cbr.ops[i + 1], n = cbr.ops[i + 2];
    if (t[0] === 'translate' && r2[0] === 'rotate' && n[0] === 'fillText' && n[1] && n[1].length === 1 &&
      'K7M3QPX9RT'.indexOf(n[1]) >= 0 && n[2] === 0 && n[3] === 0) codeTranslates.push(t);
  }
  const codeYs = codeTranslates.map((o) => o[2]);
  const codeY = codeYs.length ? Math.min(...codeYs) : Infinity;
  const logoBottom = imgs.length ? imgs[0][2] + imgs[0][4] : 0;
  if (process.env.VERBOSE) {
    console.log('  · logo bbox: ' + JSON.stringify(imgs.map((o) => o.slice(1, 5).map(Math.round))) +
      '  codeYs: ' + codeYs.map((v) => v.toFixed(1)).join(','));
  }
  // 新样式：纯白 + 加粗 + 无底纹 + 无钢印抖动/旋转
  check('防伪码为纯白 #ffffff', codeOps.length > 0 && codeOps.every((o) => o[4] === '#ffffff'),
    'got ' + JSON.stringify([...new Set(codeOps.map((o) => o[4]))]));
  check('防伪码为加粗字体', codeOps.length > 0 && codeOps.every((o) => /^bold\s/.test(o[5])),
    'got ' + JSON.stringify([...new Set(codeOps.map((o) => o[5]))]));
  check('防伪码无底板（未产生底板矩形填充）',
    !cbr.ops.some((o) => o[0] === 'fillRect' && o[1] > 1000 && o[2] > 1000),
    'plate fillRect 仍存在');
  check('「防伪」标签同样为纯白加粗',
    cbr.ops.filter((o) => o[0] === 'fillText' && o[1] === '防')
      .every((o) => o[4] === '#ffffff' && /^bold\s/.test(o[5])),
    JSON.stringify(cbr.ops.filter((o) => o[0] === 'fillText' && o[1] === '防').map((o) => [o[4], o[5]])));
  check('防伪码为水平排布（无旋转钢印效果）', codeTranslates.length === 0,
    'rotate ops: ' + codeTranslates.length);
  const codeX0 = Math.min(...codeOps.map((o) => o[2]));
  const codeX1 = Math.max(...codeOps.map((o) => o[2]));
  check('防伪码右对齐于 logo 右边界（不越界）', near(codeX1, resBR.logo.x + resBR.logo.w, 26) && codeX0 > resBR.logo.x,
    'codeX=' + codeX0.toFixed(1) + '..' + codeX1.toFixed(1) + ' logoX=' + resBR.logo.x.toFixed(1) +
    '..' + (resBR.logo.x + resBR.logo.w).toFixed(1));
  check('防伪码在 logo 下方同一行', codeOps.every((o) => o[3] > logoBottom && o[3] - logoBottom < 90),
    'codeY=' + codeOps.map((o) => o[3].toFixed(1)).join(',') + ' logoBottom=' + logoBottom.toFixed(1));

  console.log('\n6) 表格四个角 + 防伪始终固定在图片右下');
  const refLogo = (() => {
    const c = makeRecorder();
    return r.draw(c, Object.assign({}, p, { position: 'bottom-left' }), W, H, BASE, rows).logo;
  })();
  for (const pos of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
    const c2 = makeRecorder();
    const res2 = r.draw(c2, Object.assign({}, p, { position: pos }), W, H, BASE, rows);
    const mX = BASE * p.marginX / 100, mY = BASE * p.marginY / 100;
    const okPos =
      pos === 'bottom-right' ? near(res2.x + res2.w, W - mX, 2)
        : pos === 'bottom-left' ? near(res2.x, mX, 2) && near(res2.y + res2.h, H - mY, 2)
          : pos === 'top-left' ? near(res2.x, mX, 2) && near(res2.y, mY, 2)
            : near(res2.x + res2.w, W - mX, 2) && near(res2.y, mY, 2);
    check(pos + ' 表格定位正确', okPos,
      `x=${res2.x.toFixed(1)} y=${res2.y.toFixed(1)} margin=(${mX.toFixed(1)},${mY.toFixed(1)})`);

    const lg = res2.logo;
    const im = c2.ops.filter((o) => o[0] === 'drawImage');
    const blockH = lg.h + res2.metrics.codeLineH;
    const okLogo = im.length === 1 &&
      near(W - (lg.x + lg.w), mX, 2) && near(H - lg.y - blockH, mY, 2) &&
      near(lg.x, refLogo.x, 2) && near(lg.y, refLogo.y, 2);
    check(pos + ' 防伪仍在图片右下（不随表格位置变化）', okLogo,
      'logoRightGap=' + (W - lg.x - lg.w).toFixed(1) + ' logoBottomGap=' + (H - lg.y - blockH).toFixed(1) +
      ' x=' + lg.x.toFixed(1) + ' y=' + lg.y.toFixed(1));

    if (pos === 'bottom-right' && im.length === 1) {
      const tableBottom = res2.y + res2.h;
      const okGap = tableBottom <= lg.y + 0.01;
      check('bottom-right 时表格自动上移、不遮挡防伪', okGap,
        'tableBottom=' + tableBottom.toFixed(1) + ' 防伪块上沿=' + lg.y.toFixed(1));
    }
  }

  console.log('\n6.5) 防伪码位数变化（参考示例为 14 位）');
  for (const len of [6, 14, 24]) {
    const cc = makeRecorder();
    const code = ('K7M3QPX9RTABCDEFGHJKMNP').repeat(2).slice(0, len);
    const resC = r.draw(cc, Object.assign({}, p, { code, codeLen: len }), W, H, BASE, rows);
    // 码字 = 防伪块区域内、字号小于表格正文（≈48px）的字符集内字形
    // （「防伪」标签与码字同字号，靠 x 落在码字区间来区分）
    const ops = cc.ops.filter((o) => o[0] === 'fillText' && o[1] && o[1].length === 1 &&
      CODE_CHARS.includes(o[1]) && o[3] > resC.logo.y && fontPx(o[5]) < 30 && o[2] > resC.logo.x);
    const xs = ops.map((o) => o[2]);
    // 码字右对齐到 logo 右边界、向左排布；不越出右边界，也不越过图片左边距
    const leftLimit = BASE * p.marginX / 100;
    const ok = ops.length === len &&
      Math.max(...xs) <= resC.logo.x + resC.logo.w + 1 &&
      Math.min(...xs) - 10 >= leftLimit;
    check(len + ' 位码全部绘制且不越出边界', ok,
      'glyphs=' + ops.length + ' x=' + (xs.length ? Math.min(...xs).toFixed(1) + '..' + Math.max(...xs).toFixed(1) : '-') +
      ' logo=' + resC.logo.x.toFixed(1) + '..' + (resC.logo.x + resC.logo.w).toFixed(1) +
      ' 左边距=' + leftLimit.toFixed(1) + ' fs=' + (ops[0] ? fontPx(ops[0][5]).toFixed(1) : '-'));
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
  check('默认长度 14 生效', WM.randomCode(WM.DEFAULTS.codeLen).length === 14, 'codeLen=' + WM.DEFAULTS.codeLen);

  console.log('\n9) 时间格式化');
  const d = new Date(2026, 7, 19, 10, 59, 5);
  check('datetime = 2026.08.19 10:59', WM.formatDate(d, 'datetime') === '2026.08.19 10:59', WM.formatDate(d, 'datetime'));
  check('date = 2026.08.19', WM.formatDate(d, 'date') === '2026.08.19');
  check('time = 10:59', WM.formatDate(d, 'time') === '10:59');

  console.log('\n' + (fail === 0 ? `全部通过（${pass} 项）` : `${fail} 项失败 / 共 ${pass + fail} 项`));
  process.exit(fail ? 1 : 0);
}, 20);
