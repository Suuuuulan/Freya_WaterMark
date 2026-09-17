/* build.js — 把 src/ 下的 HTML/CSS/JS 与 logo 图片打包成单个 index.html
 * 用法: node build.js
 * 产物: index.html（可直接丢到 GitHub Pages / 任意静态托管，双击也能用）
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

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
const zipJs = read(path.join(src, 'zip.js'));
const renderJs = read(path.join(src, 'render.js'));
const appJs = read(path.join(src, 'app.js'));

const banner = (name) => `\n<!-- ===================== ${name} ===================== -->\n`;

// 1. 内联 CSS
html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  '<style>\n' + css.trim() + '\n</style>'
);

// 2. 内联脚本（logo-data.js 由构建生成）
const scripts = [
  banner('zip.js · ZIP 打包') + '<script>\n' + zipJs.trim() + '\n</script>',
  banner('logo-data.js · 内嵌防伪 logo') + '<script>\nwindow.FREYA_LOGO_DATA_URL = ' + logoLiteral + ';\n</script>',
  banner('render.js · 渲染引擎') + '<script>\n' + renderJs.trim() + '\n</script>',
  banner('app.js · 界面逻辑') + '<script>\n' + appJs.trim() + '\n</script>'
].join('\n');

html = html.replace(
  /<script src="zip\.js"><\/script>[\s\S]*?<script src="app\.js"><\/script>/,
  scripts.trim()
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
