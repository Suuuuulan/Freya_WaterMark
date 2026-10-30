/* build.js — 把 src/ 下的 HTML/CSS/JS 与 logo 图片打包成单个 index.html
 * 用法: node build.js
 * 产物: index.html（可直接丢到 GitHub Pages / 任意静态托管，双击也能用）
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'src');
/* 一律读成 LF：产物不再混着 CRLF/LF（否则 git 会把 index.html 标成 w/mixed，
 * 也让不同平台的构建结果字节不一致，CI 的「产物与源码同步」检查会误报）。 */
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

/* ---------- logo → data URL ---------- */
let logoDataUrl = '';
const logoCandidates = ['右下角logo.png', '右下角-fnishi.png'];
for (const f of logoCandidates) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) {
    logoDataUrl = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    console.log(`logo: ${f} (${(fs.statSync(p).size / 1024).toFixed(1)} KB → ${(logoDataUrl.length / 1024).toFixed(1)} KB base64)`);
    break;
  }
}
if (!logoDataUrl) console.warn('警告: 未找到 logo 图片，将使用文字兜底方案');

/* ---------- 用 js 字面量安全嵌入，避免 </script> 提前闭合 ---------- */
const logoLiteral = JSON.stringify(logoDataUrl).replace(/<\//g, '<\\/');

let html = read(path.join(src, 'index.html'));
const css = read(path.join(src, 'styles.css'));

/* =========================================================================
 * 把 DEFAULTS 同步回 src/index.html —— 默认值只允许存在一处
 *
 * 以前改默认值要改两个地方（render.js 的 DEFAULTS + src/index.html 的 value=""），
 * 漏一处不会报错、只是「面板第一帧显示旧值/静态检查变红」。现在：
 *   改 DEFAULTS → node build.js → HTML 里的 value / checked / <output> 初值自动对齐。
 * 换算规则完全复用 src/params.js（和运行时回显同一套），不另写一份。
 * ========================================================================= */
function syncHtmlDefaults(markup) {
  const PR = globalThis.FreyaParams;
  const DEF = globalThis.FreyaWM.DEFAULTS;
  const ctrlById = new Map(PR.ALL.map((e) => [e.id, e]));
  const ctrlByOut = new Map(PR.ALL.filter((e) => e.out).map((e) => [e.out, e]));
  const touched = [];
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1) <input> 的 value / checkbox 的 checked
  markup = markup.replace(/<input\b([^>]*)>/g, (m, attrs) => {
    const idm = /\bid="([^"]+)"/.exec(attrs);
    const e = idm && ctrlById.get(idm[1]);
    if (!e) return m;
    const want = PR.toControl(e, DEF);
    let next = attrs;
    if (e.kind === 'bool') {
      next = next.replace(/(\schecked)(?:\s+checked)+/g, '$1');        // 顺带收敛重复的 checked
      const has = /\schecked(?=[\s/>]|$)/.test(next);
      if (want && !has) next = next.replace(/\s*$/, '') + ' checked';
      if (!want && has) next = next.replace(/\s+checked(?=[\s/>]|$)/, '');
    } else {
      const v = String(want);
      next = /\bvalue="[^"]*"/.test(next)
        ? next.replace(/\bvalue="[^"]*"/, 'value="' + v + '"')
        : next + ' value="' + v + '"';
    }
    if (next !== attrs) { touched.push(e.id); return '<input' + next + '>'; }
    return m;
  });

  // 2) <select> 的选中项（值在 <option> 上，不能在 select 标签上加 value）
  markup = markup.replace(/<select\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)<\/select>/g, (m, attrs, id, inner) => {
    const e = ctrlById.get(id);
    if (!e) return m;
    const want = String(PR.toControl(e, DEF));
    const opt = new RegExp('(<option\\b[^>]*\\bvalue="' + escRe(want) + '")');
    if (!opt.test(inner)) return m;                                   // 值不在选项里就保持原样
    const hasSelected = /\sselected(?=[\s/>]|$)/.test(inner);
    const firstVal = /\<option\b[^>]*\bvalue="([^"]*)"/.exec(inner);
    // 没有显式 selected、且默认项本来就是第一个选项 → 不用改（浏览器的默认选择就是它）
    if (!hasSelected && firstVal && firstVal[1] === want) return m;
    const body = inner.replace(/\s+selected(?=[\s/>]|$)/g, '').replace(opt, '$1 selected');
    if (body !== inner) touched.push(e.id);
    return '<select' + attrs + '>' + body + '</select>';
  });

  // 3) <output> 的初始文本（面板上那些彩色数字）
  markup = markup.replace(/(<output\b[^>]*\bid="([^"]+)"[^>]*>)([^<]*)(<\/output>)/g, (m, open, id, text, close) => {
    const e = ctrlByOut.get(id);
    if (!e) return m;
    const want = PR.formatOut(e, DEF);
    if (text === want) return m;
    touched.push(id);
    return open + want + close;
  });

  return { markup, touched };
}

/* 在 Node 里以「浏览器脚本」的方式加载 render.js + params.js，拿到 DEFAULTS 与声明表 */
function loadParams() {
  const sandbox = globalThis;
  const run = (file) => new Function('module', 'global', 'window', 'document', 'Image', 'crypto',
    read(path.join(src, file)))({ exports: {} }, sandbox, sandbox, {}, function () {}, sandbox.crypto || {});
  run('render.js');
  run('params.js');
  if (!sandbox.FreyaWM || !sandbox.FreyaParams) throw new Error('render.js / params.js 未正确导出');
  return sandbox.FreyaParams;
}

{
  loadParams();
  const synced = syncHtmlDefaults(html);
  if (synced.markup !== html) {
    html = synced.markup;
    const srcHtml = path.join(src, 'index.html');
    fs.writeFileSync(srcHtml, html, 'utf8');
    console.log(`已按 DEFAULTS 同步 src/index.html 的控件初值：${synced.touched.join(', ')}`);
  }
}


/* 脚本内联顺序 = 依赖顺序：底层工具 → 渲染引擎 → 参数/图片/命名 → 界面编排。
 * 加新文件时只改这一张表（和 src/index.html 里的 <script src>）。 */
const SCRIPTS = [
  ['zip.js', 'zip.js · ZIP 打包'],
  ['render.js', 'render.js · 渲染引擎'],
  ['params.js', 'params.js · 控件声明表'],
  ['imaging.js', 'imaging.js · 解码与缩略图'],
  ['naming.js', 'naming.js · 文件名模板'],
  ['app.js', 'app.js · 界面逻辑']
];

const banner = (name) => `\n<!-- ===================== ${name} ===================== -->\n`;

// 1. 内联 CSS
//    注意：替换值必须用「函数」形式 —— 否则 CSS/JS 源码里的 $&、$'、$1 等
//    会被 String.replace 当成特殊替换模式，静默改坏产物（踩过一次）。
html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  () => '<style>\n' + css.trim() + '\n</style>'
);

// 2. 内联脚本（logo-data.js 由构建生成）
const scripts = [
  banner(SCRIPTS[0][1]) + '<script>\n' + read(path.join(src, SCRIPTS[0][0])).trim() + '\n</script>',
  banner('logo-data.js · 内嵌防伪 logo') + '<script>\nwindow.FREYA_LOGO_DATA_URL = ' + logoLiteral + ';\n</script>'
].concat(SCRIPTS.slice(1).map(([file, label]) =>
  banner(label) + '<script>\n' + read(path.join(src, file)).trim() + '\n</script>'
)).join('\n');

html = html.replace(
  /<script src="zip\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>/,
  () => scripts.trim()
);

if (/<script src=/.test(html) || /href="styles\.css"/.test(html)) {
  console.error('构建失败：仍有未内联的外部引用');
  process.exit(1);
}

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`已生成 ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);

/* 同时为 src/ 生成一个开发用的 logo-data.js */
fs.writeFileSync(path.join(src, 'logo-data.js'),
  '/* 由 build.js 生成：内嵌防伪 logo（data URL） */\nwindow.FREYA_LOGO_DATA_URL = ' + logoLiteral + ';\n', 'utf8');
console.log('已更新 src/logo-data.js');
