/* =========================================================================
 * naming.js — 导出文件名（模板变量展开 + 非法字符处理）
 * 纯函数，不碰 DOM / 状态，方便单独测。
 * ========================================================================= */
(function (global) {
  'use strict';

  function extFor(type) {
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'jpg';
  }

  /** 去掉扩展名 + 过滤文件系统非法字符 + 限长 */
  function safeName(s) {
    return String(s).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'image';
  }

  /**
   * 按模板生成文件名（不含扩展名）。
   * @param {string} tpl   模板，如 '{date}_{name}'
   * @param {object} item  队列条目（name / date / range / shot）
   * @param {string} code  这张图的防伪码
   * @param {number} i     序号（0 起）
   * @param {number} w     输出宽
   * @param {number} h     输出高
   */
  function buildName(tpl, item, code, i, w, h) {
    const d = item.date || new Date();
    const p2 = (n) => (n < 10 ? '0' + n : '' + n);
    const range = item.range
      ? item.range.start.replace(':', '') + '-' + item.range.end.replace(':', '')
      : p2(d.getHours()) + p2(d.getMinutes());
    const shot = item.shot
      ? item.shot.replace(':', '')
      : p2(d.getHours()) + p2(d.getMinutes());
    const out = String(tpl || '{name}_watermark')
      .replace(/\{name\}/g, safeName(item.name))
      .replace(/\{date\}/g, `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`)
      .replace(/\{time\}/g, `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`)
      .replace(/\{range\}/g, range)
      .replace(/\{shot\}/g, shot)
      .replace(/\{code\}/g, code)
      .replace(/\{i\}/g, String(i + 1))
      .replace(/\{w\}/g, String(w))
      .replace(/\{h\}/g, String(h));
    return (out.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'image');
  }

  const api = { extFor, safeName, buildName };
  global.FreyaNaming = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
