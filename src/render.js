/* =========================================================================
 * render.js — 水印渲染引擎（纯 Canvas 2D）
 *
 * 所有尺寸都相对「基准宽度 base」计算，base = 图片短边（见 app.js baseOf），
 * 因此 4:3 / 16:9 / 竖图 得到的水印视觉大小一致。
 *
 * 以下比例均为参考图实测（原图 1773×2364，base = 1773）：
 *   表格宽 931 = 52.5% base，左边距 39、底边距 40
 *   顶栏高 110，标题字号 41.5（字距 0.34em），圆点直径 29、中心距左边 49
 *   正文字号 34（字距 0.10em），行距 40.5，行间距 40
 *   内边距 左右 26、顶栏上 9、正文前 12、底 16；标签列 225、标签与值间距 13
 *   右下 logo 宽 266、高 122，防伪码行 36 高，块底边距 17
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------- 默认参数 ---------------- */
  const DEFAULTS = {
    position: 'bottom-left',
    scale: 1.0,
    marginX: 2.2,
    marginY: 2.26,
    opacity: 1.0,

    showTable: true,
    title: '南京云之宝智算中心',
    titleLS: 8,             // 标题字距（**绝对像素**，不再按 em——否则字号一放大空隙同步变大）
    titleFontScale: 1.2,    // 标题字号 = 跟随后的字号 ×1.2
    bodyLS: 0.0,
    labelW: 1.0,
    bodyFontScale: 1.2,     // 正文字高 = 参考字高 ×1.2（用户要求「字高 120%」）
    headerFontScale: null,  // null = 标题字号跟随正文倍率（标题属性跟随行文字）
    lineHeightRatio: 1.35,  // 行高 = 字号 ×1.35（按字距收紧后的紧凑值，可调）
    rowGapRatio: 0.18,      // 行间距 = 字号 ×0.18（可调，配合行间分隔线）

    rows: [
      { on: true, label: '拍摄时间:', type: 'datetime', text: '2026.08.19 10:59' },
      { on: true, label: '地　　点:', type: 'text', text: '南京市江宁区·南京绿地国际花都2期' },
      { on: false, label: '备注:', type: 'text', text: '' }
    ],

    accent: '#15a7fa',
    dotColor: '#f4c647',
    bgColor: '#f5f5f5',
    textColor: '#111111',
    fontFamily: 'SimHei, Heiti SC, Microsoft YaHei, PingFang SC, sans-serif',
    bold: true,
    radius: 0.016,
    shadow: 0.18,
    tableOpacity: 1.0,      // 表格单独的不透明度（0~1）

    showLogo: true,
    logoScale: 1.0,
    showCode: true,
    codeLen: 14,
    codeLabel: '防伪',
    codeSize: 1.28
  };

  /* 比例常量（×base，base = 图片短边；全部取自参考图实测）
   * 参考图：1773×2364，base = 1773；表格 x 39..969、y 1989..2323（931 × 335）
   *   顶栏：纯色 #15a7fa（实测整条颜色一致，没有渐变），白色标题 44px 居中，
   *        字距 0.34em；黄色圆点直径 29、中心距表格左边 49
   *   正文：白底 #f5f5f5 + 黑字，字号 40px、字距 0.10em、行距 60px（1.5 倍行高）
   *        左内边距 21；标签列到 x 324，值列 x 359..921（约 15 个汉字宽，超出自动折行）
   *   圆角 21px、投影较淡
   */
  const M = {
    tableW: 0.5253,        // 931   参考图表格宽度（仅作旧版参照，默认已改为铺满可用宽度）
    tableWMax: 0.92,       // 表格最大宽度 = 短边 92%（左右各留 marginX）
    tableWMin: 0.30,
    padX: 0.0132,          // 23.4  顶栏左右内边距
    bodyPadX: 0.0118,      // 21    正文左内边距
    padTop: 0.0051,        // 9     顶栏上留白
    padBodyTop: 0.0147,    // 26    顶栏下、正文前留白
    padBottom: 0.0226,     // 40    底部留白
    headerFont: 0.0248,    // 44    标题字号
    headerH: 0.0542,       // 96    蓝色顶栏高度
    bodyFont: 0.0226,      // 40    正文字号
    lineH: 0.0338,         // 60    行距（1.5 倍行高）
    rowGap: 0.0,           // 0     行与行之间（行距已含留白）
    rowSepH: 1,            // 1     行间分隔线高度（固定 1px，不随缩放变化）
    rowSepColor: 'rgba(0,0,0,.18)', // 行间分隔线：浅灰
    labelColW: 0.1494,     // 265   标签列宽
    labelGap: 0.0197,      // 35    标签列结束到值列开始
    valueColW: 0.3169,     // 562   值列宽
    dotD: 0.0163,          // 29    圆点直径
    dotX: 0.0276,          // 49    圆点中心距表格左边
    logoW: 0.1501,         // 266   右下 logo 宽度
    codeGap: 0.0023,       // 4     防伪码行与 logo 间距（×base×scale）
    codeBlockRatio: 0.617, // 164   防伪码行可用宽度 ÷ logo 宽（「防伪」+ 码字右对齐区间）
    codeBlockRatioMax: 0.85, // 码字可用宽度 ÷ logo 宽（右端留出右内边距，避免贴边/微溢）
    codeSize: 0.0113,      // 20    防伪码字号（实际绘制字号 = base×codeSize×scale×logoScale）
    codeLabelGap: 0.12,    // 「防伪」与码字间距 = 字号 ×0.12（收紧）
    shadowBlur: 0.030
  };

  const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXY';

  /** 标题水平微调（×base）：参考图标题中心比「圆点右侧区间」中心偏右约 1px */
  const TITLE_NUDGE = 0.0006;

  /* ---------------- 小工具 ---------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  function formatDate(d, type) {
    const Y = d.getFullYear(), Mo = pad2(d.getMonth() + 1), D = pad2(d.getDate());
    const H = pad2(d.getHours()), Mi = pad2(d.getMinutes());
    if (type === 'date') return `${Y}.${Mo}.${D}`;
    if (type === 'time') return `${H}:${Mi}`;
    return `${Y}.${Mo}.${D} ${H}:${Mi}`;
  }

  function randomCode(len) {
    len = Math.max(1, Math.min(64, len | 0));
    const buf = new Uint32Array(len);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(buf);
    else for (let i = 0; i < len; i++) buf[i] = (Math.random() * 4294967296) >>> 0;
    let s = '';
    for (let i = 0; i < len; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    return s;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (r <= 0.5) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function parseHex(h) {
    if (!h) return null;
    h = String(h).trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function shade(hex, amt) {
    const c = parseHex(hex);
    if (!c) return hex;
    let [r, g, b] = c;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  /* ---------------- 带字距的文本 ---------------- */
  const lsFont = (size, family) => size + 'px ' + family;
  const lsFontBold = (size, family) => 'bold ' + size + 'px ' + family;
  /** 按参数选字体：p.bold 为真时全表加粗（默认） */
  const fontOf = (size, p) => (p.bold === false ? lsFont(size, p.fontFamily) : lsFontBold(size, p.fontFamily));

  function measureLS(ctx, text, ls) {
    if (!text) return 0;
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + ls;
    return Math.max(0, w - ls);
  }

  function fillLS(ctx, text, x, y, ls) {
    let cx = x;
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + ls;
    }
    return cx - ls;
  }

  /** 折行：\n 强制换行；CJK 按字断行，英文/数字尽量按词断行 */
  function wrapLS(ctx, text, maxW, ls) {
    const out = [];
    const wordChar = (c) => /[A-Za-z0-9._\-:/]/.test(c);
    for (const para of String(text == null ? '' : text).split('\n')) {
      if (para === '') { out.push(''); continue; }
      const chars = Array.from(para);
      let line = '', lineW = 0;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        const cw = ctx.measureText(ch).width + ls;
        if (line && lineW + cw - ls > maxW) {
          if (wordChar(ch) && wordChar(line[line.length - 1])) {
            let cut = line.length;
            while (cut > 0 && wordChar(line[cut - 1])) cut--;
            if (cut > 0) {
              out.push(line.slice(0, cut));
              line = line.slice(cut);
              lineW = measureLS(ctx, line, ls);
            }
          }
          if (line && lineW + cw - ls > maxW) { out.push(line); line = ''; lineW = 0; }
        }
        line += ch; lineW += cw;
      }
      out.push(line);
    }
    return out.length ? out : [''];
  }

  /* =======================================================================
   * 渲染器
   * ===================================================================== */
  function createRenderer(options) {
    options = options || {};
    const measureCtx = document.createElement('canvas').getContext('2d');
    const logo = { img: null, ready: false, error: false, url: options.logoUrl || '' };
    const notify = options.onLogoReady || function () {};

    if (options.logoUrl) {
      loadImage(options.logoUrl).then((im) => {
        logo.img = im; logo.ready = true; notify();
      }).catch(() => { logo.error = true; notify(); });
    } else {
      logo.error = true;
    }

    /* ---------------- 版式计算 ---------------- */
    function layout(p, base, rows) {
      const ctx = measureCtx;
      const s = p.scale;
      const t = { base: base };

      t.padX = base * M.padX * s;
      t.bodyPadX = base * M.bodyPadX * s;
      t.padTop = base * M.padTop * s;
      t.padBodyTop = base * M.padBodyTop * s;
      t.padBottom = base * M.padBottom * s;
      t.radius = base * p.radius * s;
      t.shadowBlur = base * M.shadowBlur * s;
      t.fH = base * M.headerFont * s
        * (p.headerFontScale == null ? (p.bodyFontScale == null ? 1 : p.bodyFontScale) : p.headerFontScale)
        * (p.titleFontScale == null ? 1 : p.titleFontScale);
      t.fB = base * M.bodyFont * s * (p.bodyFontScale == null ? 1 : p.bodyFontScale);
      t.lineHR = p.lineHeightRatio == null ? 1.35 : p.lineHeightRatio;
      t.gapR = p.rowGapRatio == null ? 0.18 : p.rowGapRatio;
      t.lineH = t.fB * t.lineHR;
      t.rowGap = t.fB * t.gapR;
      t.dotD = base * M.dotD * s;
      t.dotX = base * M.dotX * s;
      // 标题字距取「绝对值(px)」：按 em 算的话字号一放大空隙就同步变大（正是之前 18px 大缝的成因）
      t.titleLSpx = (p.titleLS == null ? 8 : p.titleLS) * s;
      t.bodyLSpx = t.fB * p.bodyLS;

      // 1) 表格宽度：保持参考图宽度比例（不因字高变化而加宽），
      //    仅当标题太长放不下时才按需放宽（上限 92% base）
      const defW = base * M.tableW * s;
      const maxW = base * M.tableWMax;
      const minW = base * M.tableWMin;
      ctx.font = lsFont(t.fH, p.fontFamily);
      const titleNeed = measureLS(ctx, p.title || '', t.titleLSpx) + t.padX * 2 + t.dotX;
      t.w = clamp(Math.max(defW, minW, titleNeed), 0, Math.max(maxW, defW));

      // 2) 正文折行宽度：标签列固定，值列占满表格剩余宽度（字高变大后少折行）
      const labelW = base * M.labelColW * s * (p.labelW == null ? 1 : p.labelW);
      t.labelW = labelW;
      t.gap = base * M.labelGap * s;
      const bodyAvail = Math.max(t.fB * 4, t.w - t.bodyPadX * 2);
      const valueMax = Math.max(t.fB * 4, bodyAvail - labelW - t.gap);

      ctx.font = lsFont(t.fB, p.fontFamily);
      const laid = [];
      let bodyNeed = 0;
      for (const r of rows) {
        const labelText = String(r.label || '');
        const valueText = String(r.value == null ? '' : r.value);
        const lines = valueText ? wrapLS(ctx, valueText, valueMax, t.bodyLSpx) : [''];
        let maxW = 0;
        for (const l of lines) maxW = Math.max(maxW, measureLS(ctx, l, t.bodyLSpx));
        laid.push({ labelText, valueText, lines, maxW, labelWpx: measureLS(ctx, labelText, t.bodyLSpx) });
        bodyNeed = Math.max(bodyNeed, labelW + t.gap + Math.min(maxW, valueMax));
      }
      // 内容确实超宽时，把表格撑到刚好放得下
      const wantW = Math.min(maxW, bodyNeed + t.bodyPadX * 2);
      if (wantW > t.w) t.w = wantW;
      t.bodyW = t.w - t.bodyPadX * 2;
      t.valueW = Math.max(t.fB * 4, Math.min(valueMax, t.bodyW - labelW - t.gap));
      // 列位置以「相对表格左边」保存，供绘制与测试直接引用（避免各处各自推导导致漂移）
      t.labelEndX = t.bodyPadX + labelW;
      t.valueX = t.labelEndX + t.gap;

      // 3) 标题折行（顶栏内居中，左侧为圆点预留空间）
      ctx.font = lsFont(t.fH, p.fontFamily);
      const inner = t.w - t.padX * 2;
      const dotBlock = t.dotX + t.dotD / 2;
      const titleAvail = Math.max(t.fH * 4, inner - dotBlock * 2);
      t.titleLines = wrapLS(ctx, p.title || '', titleAvail, t.titleLSpx);
      t.titleLineH = t.fH * 1.35;
      t.dotBlock = dotBlock;
      // 标题在「圆点之后到顶栏右侧」的区间内居中，再整体右移一点（参考图实测）
      t.titleCenterX = dotBlock + (inner - dotBlock) / 2 + base * TITLE_NUDGE * s;

      // 4) 顶栏高度：随标题字号等比放大（保持圆点/标题的视觉平衡），标题折行时再自动加高
      const headScale = (p.titleFontScale == null ? 1 : p.titleFontScale);
      const headTextH = t.titleLines.length * t.titleLineH;
      t.headerH = Math.max(base * M.headerH * s * headScale, headTextH);

      // 5) 行块高：内部行距 lineH，行与行之间再留 rowGap
      t.rows = laid.map((r) => Object.assign({}, r, {
        h: Math.max(1, r.lines.length) * t.lineH
      }));

      // 6) 总高
      t.bodyTop = t.headerH + t.padBodyTop;
      let bodyH = 0;
      t.rows.forEach((r, i) => { bodyH += r.h + (i < t.rows.length - 1 ? t.rowGap : 0); });
      t.h = t.bodyTop + bodyH + t.padBottom;

      // 防伪码行高度：drawCodeLine 与 resolveLogo 共用，避免两处各推导致 logo 块锚点漂移
      t.codeLineH = p.showCode !== false ? codeLineH(p, base, p.code) : 0;

      return t;
    }

    /* 防伪码行的字号与行高（drawCodeLine 与 resolveLogo 必须用同一套算法，
     * 否则 logo 块的垂直锚点会与实际绘制高度对不上） */
    function codeLabelSize(p, base) {
      // p.codeSize 即「防伪码字号」滑块（40%~220%）；它是这一行字号的唯一倍率来源
      const k = p.codeSize == null ? 1 : p.codeSize;
      return Math.max(6, base * M.codeSize * k * p.scale * p.logoScale);
    }
    function codeSpreadW(p, base) {
      // 防伪码字可用宽度：整条 logo 宽度（码字右对齐到 logo 右边界，
      // 「防伪」标签贴在其左侧留白处）。给足宽度，滑块调大字号才有实际效果。
      return base * M.logoW * p.scale * p.logoScale * M.codeBlockRatioMax;
    }
    /** 码字字号：完全由「防伪码字号」滑块决定（= 基准字号 ×codeSize）。
     *  只有当字身按当前密度会互相重叠/越出右边界时才缩小，
     *  而且缩小是在「滑块给定字号」基础上按可用宽度等比收敛（不是换成另一个固定值）。 */
    function codeFontSize(p, base, code) {
      const n = Math.max(1, String(code || '').length);
      const avail = codeSpreadW(p, base);
      const fs = codeLabelSize(p, base);        // 含 codeSize 倍率
      // 从宽松到紧凑挑最小够用的字身密度（em/位）
      for (const k of [0.85, 0.74, 0.64, 0.56]) {
        if (n * fs * k <= avail) return fs;
        const fitted = avail / (n * k);
        if (fitted >= fs * 0.92) return fitted;  // 只需微调就直接用
      }
      return Math.max(4, avail / (n * 0.56));
    }
    function codeLineH(p, base, code) {
      return Math.max(codeLabelSize(p, base) * 1.3, codeFontSize(p, base, code) * 1.3);
    }

    /* ---------------- 防伪 logo 的落点 ----------------
     * 防伪标识锚定在「图片」右下角，与表格位置无关：
     * 表格可以放四个角（p.position），防伪始终在图片右下。
     * 若表格被放到右下，两者水平区间重叠（含 1% base 安全间隙），
     * 此时把表格上移到防伪标识之上，避免互相遮挡。
     */
    function resolveLogo(t, p, W, H, base, mx, my) {
      const lw = base * M.logoW * p.scale * p.logoScale;
      const lh = lw * (logo.ready ? logo.img.naturalHeight / logo.img.naturalWidth : 0.46);
      // 含防伪码行的整块高度（防伪码行贴在 logo 图片下沿）
      const blockH = lh + (t.codeLineH || 0);
      // 整块右下角对齐图片右下边距 → 防伪码行留在边距内
      const lx = W - mx - lw;
      const ly = H - my - blockH;

      if (p.position === 'bottom-right' && p.showLogo !== false) {
        const gap = base * 0.01;
        const plateTop = ly;                                  // 整块上沿（= logo 图片上沿）
        const collidesX = (t.x + t.w + gap > lx) && (t.x - gap < lx + lw);
        if (collidesX && t.y < plateTop + gap) t.y = Math.max(base * 0.005, plateTop - gap - t.h);
      }

      return { lw, lh, blockH, x: lx, y: ly };
    }

    /* 表格过大时等比缩小（默认铺满宽 + 字高 120% 后，方形图可能超出图片高度）。
     * 只缩放纵向版式，不重算折行 → 保持「先缩放、后定位」的调用顺序即可。 */
    function scaleTable(t, k) {
      if (k >= 0.999) return;
      t.fB *= k; t.lineH *= k; t.rowGap *= k;
      t.bodyLSpx *= k;
      t.padBodyTop *= k; t.padBottom *= k;
      t.padTop *= k; t.radius *= k;
      t.fH *= k; t.titleLSpx *= k; t.titleLineH *= k;
      t.headerH *= k; t.dotD *= k; t.dotX *= k;
      t.rows.forEach((r) => { r.h *= k; });
      t.h *= k;
      t.bodyTop *= k;
    }

    /* 在「表格高度 + 防伪块高度 + 上下边距」超过图片高度时，求最大的等比缩放系数 */
    function fitScale(t, p, H, base, my, L) {
      if (p.showTable === false) return 1;
      const logoH = p.showLogo !== false ? (H - my - L.y) : 0;
      const avail = H - my * 2 - logoH - base * 0.01;
      if (avail <= 0 || t.h <= avail) return 1;
      return Math.max(0.2, avail / t.h);
    }

    /* ---------------- 绘制 ---------------- */
    function draw(ctx, p, W, H, base, rowsMeta) {
      const rows = (rowsMeta || []).filter((r) => r.on !== false);
      const t = layout(p, base, rows);
      const mx = base * (p.marginX / 100);
      const my = base * (p.marginY / 100);

      // 1) 先按图片右下角的防伪块位置，算出表格可用的最大高度并等比缩放
      const probe = resolveLogo(Object.assign({ x: 0, y: 0 }, t), p, W, H, base, mx, my);
      scaleTable(t, fitScale(t, p, H, base, my, probe));

      // 2) 再定位（此时 t.h 已是最终高度，边距才能对准）
      t.x = /right$/.test(p.position) ? W - mx - t.w : mx;
      t.y = /^bottom/.test(p.position) ? H - my - t.h : my;
      const x = t.x, y = t.y;

      // 3) 与防伪块打架时把表格上移（bottom-right 右对齐才有此情况）
      const L = resolveLogo(t, p, W, H, base, mx, my);
      const tx = t.x, ty = t.y;   // 表格最终位置（可能已被上移）

      ctx.save();
      ctx.globalAlpha = clamp(p.opacity, 0, 1);

      // 表格可单独调不透明度：在其自身透明度上再乘 tableOpacity
      if (p.showTable !== false && (rows.length || p.title)) {
        const tOpacity = p.tableOpacity == null ? 1 : clamp(p.tableOpacity, 0, 1);
        if (tOpacity < 1) {
          ctx.save();
          ctx.globalAlpha = clamp(p.opacity, 0, 1) * tOpacity;
          drawTable(ctx, p, t, tx, ty);
          ctx.restore();
        } else {
          drawTable(ctx, p, t, tx, ty);
        }
      }

      if (p.showLogo !== false) {
        if (logo.ready) drawLogo(ctx, p, t, base, L);
        else drawLogoFallback(ctx, p, t, base, L);
      }

      ctx.restore();
      // logo.top = logo 图片下沿；blockBottom = 含防伪码行的整块下沿
      const logoBottom = L.y + L.lh;
      const blockBottom = p.showLogo !== false ? L.y + L.blockH : ty + t.h;
      return {
        x: tx, y: ty, w: t.w, h: t.h,
        logo: { x: L.x, y: L.y, w: L.lw, h: L.lh, top: logoBottom, blockBottom },
        bottom: blockBottom,
        metrics: t
      };
    }

    /* ---- 表格 ---- */
    function drawTable(ctx, p, t, x, y) {
      const r = t.radius;

      if (t.shadowBlur > 0.5 && p.shadow > 0.01) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,' + clamp(p.shadow, 0, 0.9) + ')';
        ctx.shadowBlur = t.shadowBlur;
        ctx.shadowOffsetY = t.shadowBlur * 0.32;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, x, y, t.w, t.h, r);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      roundRect(ctx, x, y, t.w, t.h, r);
      ctx.clip();

      ctx.fillStyle = p.bgColor;
      ctx.fillRect(x, y, t.w, t.h);

      // 顶栏：参考图为纯色 #15a7fa（实测整条颜色一致，无渐变）
      ctx.fillStyle = p.accent;
      ctx.fillRect(x, y, t.w, t.headerH);
      ctx.restore();

      // 圆点
      const dcx = x + t.dotX, dcy = y + t.headerH / 2, dR = t.dotD / 2;
      const dg = ctx.createRadialGradient(dcx - dR * 0.35, dcy - dR * 0.35, dR * 0.1, dcx, dcy, dR);
      dg.addColorStop(0, shade(p.dotColor, 0.45));
      dg.addColorStop(0.75, p.dotColor);
      dg.addColorStop(1, shade(p.dotColor, -0.12));
      ctx.save();
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(dcx, dcy, dR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 标题（居中，默认加粗）
      ctx.save();
      ctx.font = fontOf(t.fH, p);
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur = t.fH * 0.14;
      ctx.shadowOffsetY = t.fH * 0.03;
      let ty = y + t.headerH / 2 - ((t.titleLines.length - 1) * t.titleLineH) / 2;
      for (const l of t.titleLines) {
        const lw = measureLS(ctx, l, t.titleLSpx);
        fillLS(ctx, l, x + t.titleCenterX - lw / 2, ty, t.titleLSpx);
        ty += t.titleLineH;
      }
      ctx.restore();

      // 正文（标签列 + 值列，值列自动折行）
      ctx.save();
      ctx.font = fontOf(t.fB, p);
      ctx.fillStyle = p.textColor;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const labelX = x + t.bodyPadX;
      const valueX = labelX + t.labelW + t.gap;
      const sepX = x + t.bodyPadX * 0.6;
      const sepW = t.w - t.bodyPadX * 1.2;
      let ry = y + t.bodyTop;
      t.rows.forEach((row, i) => {
        // 行间分隔线（固定 1px 高，不随缩放变化）
        if (i > 0 && M.rowSepH > 0) {
          ctx.fillStyle = M.rowSepColor;
          ctx.fillRect(sepX, Math.round(ry), sepW, M.rowSepH);
          ctx.fillStyle = p.textColor;
        }
        const firstMid = ry + t.lineH / 2;
        if (row.labelText) fillLS(ctx, row.labelText, labelX, firstMid, t.bodyLSpx);
        let ly = firstMid;
        for (const l of row.lines) {
          if (l) fillLS(ctx, l, valueX, ly, t.bodyLSpx);
          ly += t.lineH;
        }
        ry += row.h + t.rowGap;
      });
      ctx.restore();
    }

    /* ---- 右下防伪 logo + 随机防伪码（L 由 resolveLogo 算好） ---- */
    function drawLogo(ctx, p, t, base, L) {
      const lx = L.x, ly = L.y, lw = L.lw, lh = L.lh;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = Math.max(2, lw * 0.035);
      ctx.shadowOffsetY = Math.max(1, lw * 0.012);
      ctx.drawImage(logo.img, lx, ly, lw, lh);
      ctx.restore();

      if (p.showCode !== false) drawCodeLine(ctx, p, base, lx, lw, ly + lh);
    }

    /* 防伪码行：「防伪」+ 随机码，全部纯白加粗、无底纹（只有单色投影保证可读） */
    function drawCodeLine(ctx, p, base, lx, lw, top) {
      const fs = codeLabelSize(p, base);
      const blockW = codeSpreadW(p, base);
      const cy = top + base * (M.codeGap * p.scale * p.logoScale) + fs * 0.6;

      const label = String(p.codeLabel || '');
      const code = String(p.code || randomCode(p.codeLen));
      const codeFs = codeFontSize(p, base, code);
      const cx0 = lx + lw - blockW;           // 码字区间左端（右端 = logo 右边界）

      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,.55)';
      ctx.shadowBlur = fs * 0.34;
      ctx.shadowOffsetY = fs * 0.05;

      // 标签「防伪」：纯白加粗，贴在码字左侧留白处
      ctx.font = lsFontBold(fs, p.fontFamily);
      const labelW = measureLS(ctx, label, 0);
      const labelX = cx0 - labelW - fs * M.codeLabelGap;
      ctx.fillStyle = '#ffffff';
      fillLS(ctx, label, labelX, cy, 0);

      // 码字：纯白加粗，无底板、无旋转，等宽排布（右对齐到 logo 右边界）
      const step = blockW / Math.max(1, code.length);
      ctx.font = lsFontBold(codeFs, p.fontFamily);
      ctx.textAlign = 'center';
      for (let i = 0; i < code.length; i++) {
        ctx.fillText(code[i], cx0 + step * (i + 0.5), cy);
      }
      ctx.restore();

      return cy + codeLineH(p, base, code) / 2;
    }

    /* logo 资源缺失时的兜底（同样固定在图片右下） */
    function drawLogoFallback(ctx, p, t, base, L) {
      const w = L.lw;
      const h = L.lh;
      const x = L.x, y = L.y;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = h * 0.12;
      ctx.font = lsFont(h * 0.44, p.fontFamily);
      ctx.fillText('今日水印', x + w / 2, y + h * 0.33);
      ctx.font = lsFont(h * 0.30, p.fontFamily);
      ctx.fillText('相机 真实可验', x + w / 2, y + h * 0.76);
      ctx.restore();
    }

    return {
      draw,
      layout: (p, base, rows) => layout(p, base, (rows || []).filter((r) => r.on !== false)),
      logo
    };
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    createRenderer, DEFAULTS, M,
    roundRect, shade, parseHex, randomCode, formatDate,
    wrapLS, measureLS, fillLS, lsFont, clamp
  };
  global.FreyaWM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
