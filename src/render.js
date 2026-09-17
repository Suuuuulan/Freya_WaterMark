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
    titleLS: 0.34,
    bodyLS: 0.10,
    labelW: 1.0,

    rows: [
      { on: true, label: '拍摄时间:', type: 'datetime', text: '2026.08.19 10:59' },
      { on: true, label: '地　　点:', type: 'text', text: '南京市江宁区·南京绿地国际花都2期' },
      { on: false, label: '备注:', type: 'text', text: '' }
    ],

    accent: '#15a7fa',
    dotColor: '#f4c647',
    bgColor: '#f5f5f5',
    textColor: '#111111',
    fontFamily: 'Microsoft YaHei, PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif',
    radius: 0.026,
    shadow: 0.18,

    showLogo: true,
    logoScale: 1.0,
    showCode: true,
    codeLen: 10,
    codeLabel: '防伪',
    codeSize: 1.0
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
    tableW: 0.5253,        // 931   表格宽度
    tableWMax: 0.92,
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
    labelColW: 0.1494,     // 265   标签列宽
    labelGap: 0.0197,      // 35    标签列结束到值列开始
    valueColW: 0.3169,     // 562   值列宽
    dotD: 0.0163,          // 29    圆点直径
    dotX: 0.0276,          // 49    圆点中心距表格左边
    logoW: 0.1501,         // 266   右下 logo 宽度
    codeGap: 0.0023,       // 4     防伪码行与 logo 间距
    codePlateRatio: 0.617, // 164   防伪码底板宽 ÷ logo 宽
    codeSize: 0.0113,      // 20    防伪码字号
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
      t.fH = base * M.headerFont * s;
      t.fB = base * M.bodyFont * s;
      t.lineH = base * M.lineH * s;
      t.rowGap = base * M.rowGap * s;
      t.dotD = base * M.dotD * s;
      t.dotX = base * M.dotX * s;
      t.titleLSpx = t.fH * p.titleLS;
      t.bodyLSpx = t.fB * p.bodyLS;

      // 1) 表格宽度：默认取参考图宽度，仅当内容放不下时才变宽（上限 92% base）
      const defW = base * M.tableW * s;
      const maxW = base * M.tableWMax;
      const minW = base * M.tableWMin;
      ctx.font = lsFont(t.fH, p.fontFamily);
      const titleNeed = measureLS(ctx, p.title || '', t.titleLSpx) + t.padX * 2 + t.dotX;
      t.w = clamp(Math.max(defW, minW, titleNeed), 0, Math.max(maxW, defW));

      // 2) 正文折行宽度：标签列固定，值列固定宽度（与参考图一致）
      //    值列宽 = 18 个汉字（34px × 18 = 612），保证长文本自动折行
      const labelW = base * M.labelColW * s * (p.labelW == null ? 1 : p.labelW);
      t.labelW = labelW;
      t.gap = base * M.labelGap * s;
      const bodyAvail = Math.max(t.fB * 4, t.w - t.bodyPadX * 2);
      const valueMax = Math.max(t.fB * 4, Math.min(base * M.valueColW * s, bodyAvail - labelW - t.gap));

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

      // 4) 顶栏高度：单行标题时正好是参考图的 66px，标题折行时自动加高
      const headTextH = t.titleLines.length * t.titleLineH;
      t.headerH = Math.max(base * M.headerH * s, headTextH);

      // 5) 行块高：内部行距 lineH，行与行之间再留 rowGap
      t.rows = laid.map((r) => Object.assign({}, r, {
        h: Math.max(1, r.lines.length) * t.lineH
      }));

      // 6) 总高
      t.bodyTop = t.headerH + t.padBodyTop;
      let bodyH = 0;
      t.rows.forEach((r, i) => { bodyH += r.h + (i < t.rows.length - 1 ? t.rowGap : 0); });
      t.h = t.bodyTop + bodyH + t.padBottom;

      return t;
    }

    /* ---------------- 绘制 ---------------- */
    function draw(ctx, p, W, H, base, rowsMeta) {
      const rows = (rowsMeta || []).filter((r) => r.on !== false);
      const t = layout(p, base, rows);
      const mx = base * (p.marginX / 100);
      const my = base * (p.marginY / 100);
      const x = /right$/.test(p.position) ? W - mx - t.w : mx;
      const y = /^bottom/.test(p.position) ? H - my - t.h : my;

      ctx.save();
      ctx.globalAlpha = clamp(p.opacity, 0, 1);

      if (p.showTable !== false && (rows.length || p.title)) drawTable(ctx, p, t, x, y);

      let logoBottom = y + t.h;
      if (p.showLogo !== false) {
        logoBottom = logo.ready
          ? drawLogo(ctx, p, t, W, H, base, mx, my, x, y + t.h)
          : drawLogoFallback(ctx, p, t, W, H, base, mx, my, x, y + t.h);
      }

      ctx.restore();
      return { x, y, w: t.w, h: t.h, bottom: logoBottom, metrics: t };
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

      // 标题（居中）
      ctx.save();
      ctx.font = lsFont(t.fH, p.fontFamily);
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
      ctx.font = lsFont(t.fB, p.fontFamily);
      ctx.fillStyle = p.textColor;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const labelX = x + t.bodyPadX;
      const valueX = labelX + t.labelW + t.gap;
      let ry = y + t.bodyTop;
      for (const row of t.rows) {
        const firstMid = ry + t.lineH / 2;
        if (row.labelText) fillLS(ctx, row.labelText, labelX, firstMid, t.bodyLSpx);
        let ly = firstMid;
        for (const l of row.lines) {
          if (l) fillLS(ctx, l, valueX, ly, t.bodyLSpx);
          ly += t.lineH;
        }
        ry += row.h + t.rowGap;
      }
      ctx.restore();
    }

    /* ---- 右下防伪 logo + 随机防伪码 ---- */
    function drawLogo(ctx, p, t, W, H, base, mx, my, tableX, tableBottom) {
      const lw = base * M.logoW * p.scale * p.logoScale;
      const lh = lw * (logo.img.naturalHeight / logo.img.naturalWidth);
      const lx = /right$/.test(p.position) ? W - mx - lw : tableX;
      const ly = /^bottom/.test(p.position) ? H - my - lh : tableBottom + base * 0.014;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = Math.max(2, lw * 0.035);
      ctx.shadowOffsetY = Math.max(1, lw * 0.012);
      ctx.drawImage(logo.img, lx, ly, lw, lh);
      ctx.restore();

      return p.showCode !== false ? drawCodeLine(ctx, p, base, lx, lw, ly + lh) : ly + lh;
    }

    /* 防伪码行：「防伪」白色文字 + 浅灰钢印底板上的随机码 */
    function drawCodeLine(ctx, p, base, lx, lw, top) {
      const fs = Math.max(6, base * M.codeSize * p.scale * p.logoScale);
      const plateW = lw * M.codePlateRatio;
      const cy = top + base * M.codeGap * p.scale + fs * 0.6;

      const label = String(p.codeLabel || '');
      const code = String(p.code || randomCode(p.codeLen));
      const codeFs = fs * 0.90;
      const x0 = lx + lw - plateW;

      ctx.save();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = fs * 0.4;

      ctx.font = lsFont(fs, p.fontFamily);
      const labelW = measureLS(ctx, label, 0);
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      fillLS(ctx, label, x0, cy, 0);

      const plateX = x0 + labelW + fs * 0.34;
      const plateW2 = Math.max(fs * 2, lx + lw - plateX);
      const plateH = fs * 1.30;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = fs * 0.25;
      roundRect(ctx, plateX, cy - plateH / 2, plateW2, plateH, Math.min(plateH * 0.22, plateW2 * 0.2));
      const pg = ctx.createLinearGradient(0, cy - plateH / 2, 0, cy + plateH / 2);
      pg.addColorStop(0, 'rgba(222,232,237,.94)');
      pg.addColorStop(0.5, 'rgba(196,211,219,.94)');
      pg.addColorStop(1, 'rgba(160,178,188,.94)');
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.restore();

      // 码字逐个微抖动 + 轻微旋转，模拟钢印
      const step = plateW2 / Math.max(1, code.length);
      ctx.font = lsFont(codeFs, p.fontFamily);
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
      for (let i = 0; i < code.length; i++) {
        const jx = (jitter(i, 1) - 0.5) * codeFs * 0.10;
        const jy = (jitter(i, 2) - 0.5) * codeFs * 0.20;
        const rot = (jitter(i, 3) - 0.5) * 0.16;
        ctx.save();
        ctx.translate(plateX + step * (i + 0.5) + jx, cy + jy);
        ctx.rotate(rot);
        ctx.fillStyle = 'rgba(34,42,48,.96)';
        ctx.fillText(code[i], 0, 0);
        ctx.restore();
      }
      ctx.restore();
      return cy + plateH / 2;
    }

    function jitter(i, salt) {
      let h = (2166136261 ^ Math.imul(i + 1, 16777619) ^ Math.imul(salt + 7, 2246822519)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    /* logo 资源缺失时的兜底 */
    function drawLogoFallback(ctx, p, t, W, H, base, mx, my, tableX, tableBottom) {
      const w = base * M.logoW * p.scale;
      const h = w * 0.46;
      const x = /right$/.test(p.position) ? W - mx - w : tableX;
      const y = /^bottom/.test(p.position) ? H - my - h : tableBottom + base * 0.014;
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
      return y + h;
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
