/* =========================================================================
 * params.js — 面板控件 ↔ 参数 的唯一声明表
 *
 * 以前 readUI / writeUI / 就地编辑 / 数值回显 各写一遍「id → 参数 → 换算」，
 * 默认值同时在 DEFAULTS、HTML 的 value=""、render.js 的 `== null ? 默认` 里各存一份。
 * 加一个参数要改四处，漏一处就是静默 bug（「标签列宽」曾在两张卡里各留一份，
 * 卡片 4 的滑块因此彻底失效，300+ 条测试全绿也没发现）。
 *
 * 现在：加参数 = 在 CONTROLS 里加一行 + 在 HTML 里放一个同名 id 的控件。
 * 默认值只有一处（FreyaWM.DEFAULTS），check.js 会断言：
 *   ① 每个控件的 id 都在表里（或白名单里）
 *   ② 表里每条声明的 id 都在 HTML 里
 *   ③ HTML 控件的初值 == DEFAULTS 经同一套换算后的值
 *
 * kind:
 *   pct      0~100 的控件值 ↔ 0~1 的参数（×100 / ÷100）
 *   permille 0~1000 的控件值 ↔ 0~1 的参数（如 radius）
 *   num      原样的浮点数
 *   int      整数（可给 min / max 夹取）
 *   str      文本 / select / color
 *   bool     checkbox
 * ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------- 声明表 ---------------- */
  const CONTROLS = [
    /* 2 · 位置与尺寸 */
    { id: 'scale', key: 'scale', kind: 'pct', out: 'outScale' },
    { id: 'marginX', key: 'marginX', kind: 'num', dec: 1, suffix: '%', out: 'outMarginX' },
    { id: 'marginY', key: 'marginY', kind: 'num', dec: 1, suffix: '%', out: 'outMarginY' },
    { id: 'opacity', key: 'opacity', kind: 'pct', out: 'outOpacity' },
    { id: 'tableOpacity', key: 'tableOpacity', kind: 'pct', out: 'outTableOpacity' },

    /* 3 · 表格内容（标题文字属性） */
    { id: 'title', key: 'title', kind: 'str' },
    { id: 'titleFontScale', key: 'titleFontScale', kind: 'pct', out: 'outTitleScale' },
    { id: 'titleHeightScale', key: 'titleHeightScale', kind: 'pct', out: 'outTitleHeight' },
    { id: 'titleLineHeightRatio', key: 'titleLineHeightRatio', kind: 'num', dec: 2, out: 'outTitleLineH' },
    { id: 'titleLineGapRatio', key: 'titleLineGapRatio', kind: 'num', dec: 2, out: 'outTitleLineGap' },
    { id: 'titleLS', key: 'titleLS', kind: 'num', dec: 2, out: 'outTitleLS' },
    { id: 'headerPadRatio', key: 'headerPadRatio', kind: 'pct', out: 'outHeaderPad' },
    { id: 'labelW', key: 'labelW', kind: 'pct', out: 'outLabelW' },

    /* 4 · 正文与白色区域 */
    { id: 'bodyFontScale', key: 'bodyFontScale', kind: 'pct', out: 'outBodyFont' },
    { id: 'bodyHeightScale', key: 'bodyHeightScale', kind: 'pct', out: 'outBodyHeight' },
    { id: 'lineHeightRatio', key: 'lineHeightRatio', kind: 'num', dec: 2, out: 'outLineH' },
    { id: 'rowGapRatio', key: 'rowGapRatio', kind: 'num', dec: 2, out: 'outRowGap' },
    { id: 'bodyLS', key: 'bodyLS', kind: 'num', dec: 2, out: 'outBodyLS' },
    { id: 'labelLS', key: 'labelLS', kind: 'num', dec: 2, out: 'outLabelLS' },
    { id: 'valueGapRatio', key: 'valueGapRatio', kind: 'num', dec: 2, out: 'outValueGap' },
    { id: 'rowSepH', key: 'rowSepH', kind: 'num', dec: 1, trimZero: true, out: 'outSepH' },
    { id: 'rowSepAlpha', key: 'rowSepAlpha', kind: 'num', dec: 2, out: 'outSepAlpha' },
    { id: 'bodyPadTopRatio', key: 'bodyPadTopRatio', kind: 'pct', out: 'outBodyPadTop' },
    { id: 'bodyPadBottomRatio', key: 'bodyPadBottomRatio', kind: 'pct', out: 'outBodyPadBottom' },

    /* 5 · 外观样式 */
    { id: 'accent', key: 'accent', kind: 'str' },
    { id: 'dotColor', key: 'dotColor', kind: 'str' },
    { id: 'bgColor', key: 'bgColor', kind: 'str' },
    { id: 'textColor', key: 'textColor', kind: 'str' },
    { id: 'fontFamily', key: 'fontFamily', kind: 'str' },
    { id: 'radius', key: 'radius', kind: 'permille', out: 'outRadius' },
    { id: 'shadow', key: 'shadow', kind: 'pct', out: 'outShadow' },
    { id: 'showTable', key: 'showTable', kind: 'bool' },

    /* 6 · 右下角防伪 */
    { id: 'showLogo', key: 'showLogo', kind: 'bool' },
    { id: 'logoScale', key: 'logoScale', kind: 'pct', out: 'outLogoScale' },
    { id: 'showCode', key: 'showCode', kind: 'bool' },
    { id: 'codeLen', key: 'codeLen', kind: 'int', min: 1, max: 64 },
    { id: 'codeLabel', key: 'codeLabel', kind: 'str' },
    { id: 'codeSize', key: 'codeSize', kind: 'pct', out: 'outCodeSize' },

    /* 1 · 导入时间段（界面参数，渲染引擎不读） */
    { id: 'rangesText', key: 'rangesText', kind: 'str' },
    { id: 'rangeAuto', key: 'rangeAuto', kind: 'bool' }
  ];

  /* 7 · 输出（同样持久化，但改动只需入库、不必重绘） */
  const EXPORTS = [
    { id: 'format', key: 'format', kind: 'str' },
    { id: 'quality', key: 'quality', kind: 'num', out: 'outQuality', suffix: '%' },
    { id: 'nameTpl', key: 'nameTpl', kind: 'str' },
    { id: 'maxEdge', key: 'maxEdge', kind: 'int', min: 0, max: 12000 },
    { id: 'fitView', key: 'fitView', kind: 'bool' }
  ];

  const ALL = CONTROLS.concat(EXPORTS);

  /** 参数默认值只有一处：渲染引擎的 DEFAULTS（本文件在其之后加载） */
  const defOf = (e) => {
    const D = (global.FreyaWM && global.FreyaWM.DEFAULTS) || {};
    const v = D[e.key];
    return v === undefined ? (e.kind === 'bool' ? true : '') : v;
  };

  const num = (v, d) => (isFinite(v) ? +v : d);
  const round = (v) => Math.round(v);

  /* ---------------- 控件 → 参数 ---------------- */
  function readOne(el, e) {
    const d = defOf(e);
    switch (e.kind) {
      case 'bool':
        return !!el.checked;
      case 'pct':
        return num(+el.value / 100, d);
      case 'permille':
        return num(+el.value / 1000, d);
      case 'int': {
        const v = parseInt(el.value, 10);
        const lo = e.min == null ? -Infinity : e.min;
        const hi = e.max == null ? Infinity : e.max;
        return Math.min(hi, Math.max(lo, isFinite(v) ? v : d));
      }
      case 'num':
        return num(+el.value, d);
      default:
        return el.value;
    }
  }

  /** 把一组控件读进 params（只写表里声明过的键） */
  function readAll(p, byId, list) {
    (list || ALL).forEach((e) => {
      const el = byId(e.id);
      if (el) p[e.key] = readOne(el, e);
    });
    return p;
  }

  /* ---------------- 参数 → 控件 ---------------- */
  /** 参数值 → 控件该显示的值（writeUI 与 check.js 的初值断言共用同一套换算） */
  function toControl(e, p) {
    const v = p[e.key] === undefined || p[e.key] === null ? defOf(e) : p[e.key];
    switch (e.kind) {
      case 'bool': return !!v;
      case 'pct': return round(v * 100);
      case 'permille': return round(v * 1000);
      case 'int': return v;
      default: return v;
    }
  }

  function writeAll(p, byId, list) {
    (list || ALL).forEach((e) => {
      const el = byId(e.id);
      if (!el) return;
      const v = toControl(e, p);
      if (e.kind === 'bool') el.checked = v;
      else el.value = v;
    });
  }

  /* ---------------- 数值回显（面板上彩色数字） ---------------- */
  function formatOut(e, p) {
    if (!e.out) return '';
    const v = p[e.key] === undefined || p[e.key] === null ? defOf(e) : p[e.key];
    const suffix = e.suffix == null ? '' : e.suffix;
    switch (e.kind) {
      case 'pct': return round(v * 100) + (suffix || '%');
      case 'permille': return String(round(v * 1000)) + suffix;
      case 'int': return String(v) + suffix;
      case 'num': {
        if (e.dec == null) return String(v) + suffix;
        let s = (+v).toFixed(e.dec);
        if (e.trimZero) s = s.replace(/\.0+$/, '');
        return s + suffix;
      }
      default: return String(v) + suffix;
    }
  }

  function syncOutputs(p, byId, list) {
    (list || ALL).forEach((e) => {
      if (!e.out) return;
      const el = byId(e.out);
      if (el) el.textContent = formatOut(e, p);
    });
  }

  const api = {
    CONTROLS, EXPORTS, ALL,
    readOne, readAll, toControl, writeAll, formatOut, syncOutputs, defOf
  };
  global.FreyaParams = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
