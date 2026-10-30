/* =========================================================================
 * imaging.js — 图片解码与缩略图（队列内存的关键）
 *
 * 两个约束：
 *   ① 队列里只放「96px 缩略图」给缩略图栏用。以前直接复用原图的 objectURL，
 *      浏览器会按**原始尺寸**解码（12MP × 50 张 = 几十亿字节），CSS 缩到 44px 也白搭。
 *   ② 全分辨率位图按需解码，且只保留最近 IMG_CACHE_MAX 张（LRU）。
 *      队列再长，内存也只由这几张决定。
 * ========================================================================= */
(function (global) {
  'use strict';

  const THUMB_EDGE = 96;
  const CACHE_MAX = 3;
  const order = [];                  // 最近使用的 item（末尾最新）

  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = src;
    });
  }

  /** 从已解码的图（Image 或 canvas）生成 dataURL 缩略图 */
  function makeThumb(src, edge) {
    try {
      const sw = src.naturalWidth || src.width || 0;
      const sh = src.naturalHeight || src.height || 0;
      const long = Math.max(sw, sh);
      if (!long) return '';
      const k = Math.min(1, (edge || THUMB_EDGE) / long);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * k));
      c.height = Math.max(1, Math.round(sh * k));
      const cx = c.getContext('2d');
      if (!cx) return '';
      cx.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) {
      return '';
    }
  }

  function touch(item) {
    const i = order.indexOf(item);
    if (i >= 0) order.splice(i, 1);
    order.push(item);
    while (order.length > CACHE_MAX) {
      const old = order.shift();
      if (old && old !== item) old.img = null;
    }
  }

  /** 取这张图的解码位图（已缓存就直接用，否则从 item.url 解码） */
  async function ensureImage(item) {
    if (item.img) { touch(item); return item.img; }
    const img = await loadImageEl(item.url);
    item.img = img;
    touch(item);
    return img;
  }

  /** 主动释放某张图的位图（删队列项时用） */
  function release(item) {
    const i = order.indexOf(item);
    if (i >= 0) order.splice(i, 1);
    if (item) item.img = null;
  }

  function clear() {
    order.forEach((it) => { if (it) it.img = null; });
    order.length = 0;
  }

  /** 调试/测试用：当前缓存了几张 */
  const cachedCount = () => order.length;

  const api = { THUMB_EDGE, CACHE_MAX, loadImageEl, makeThumb, ensureImage, release, clear, cachedCount };
  global.FreyaImaging = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
