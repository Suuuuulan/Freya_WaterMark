/* ref-params.js — 参考基线参数（**不是出厂默认值**）
 *
 * 这套值是从参考图（1773×2364）逐像素量出来的，用来回答一个问题：
 *   「渲染引擎按参考参数画，还能不能还原参考图？」
 *
 * 而 src/render.js 里的 DEFAULTS 是**出厂默认值**，可以随产品需要随时调整
 * （字号、留白、行距…都不必再等于参考图）。
 *
 * 两者混在一起的结果是：只要调一次默认值，test-render / verify 就全红，
 * 但那是「预期变化」不是「引擎回归」。所以这里显式分开。
 *
 * 注意：不要把这里的值同步成 DEFAULTS —— 它只跟随「重新量参考图」。
 */
module.exports = {
  // 位置与尺寸
  scale: 1,
  marginX: 2.2,
  marginY: 2.26,          // 参考图实测 40/1773；面板滑块 step 0.1 会夹到 2.3
  opacity: 1,
  tableOpacity: 1,

  // 标题
  titleLS: 5,
  titleFontScale: 1,
  titleHeightScale: 1,
  titleLineHeightRatio: 1.5,
  titleLineGapRatio: 0,
  headerPadRatio: 1.8,
  headerFontScale: 1.2,

  // 正文
  bodyLS: 0,
  labelLS: 0.185,
  valueGapRatio: 0.2,
  labelW: 1,
  bodyFontScale: 1.2,
  bodyHeightScale: 1,
  lineHeightRatio: 1.35,
  rowGapRatio: 0.18,
  rowSepH: 1,
  rowSepAlpha: 0.18,
  bodyPadTopRatio: 1,
  bodyPadBottomRatio: 1
};
