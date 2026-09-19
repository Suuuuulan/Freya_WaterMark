/* check.js — 静态一致性检查：
 *   1. app.js 里用到的元素 ID 是否都存在于 index.html
 *   2. app.js 读写的参数名是否与 render.js DEFAULTS 一致
 *   3. index.html 是否只引用存在的脚本/样式
 * 用法: node _tools/check.js
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('src/index.html');
const app = read('src/app.js');
const render = read('src/render.js');
const css = read('src/styles.css');

let errors = 0;
const fail = (m) => { console.log('  ✗ ' + m); errors++; };
const ok = (m) => console.log('  ✓ ' + m);

/* ---------- 1. DOM ID ---------- */
console.log('1) DOM 元素 ID');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const missing = [...usedIds].filter((id) => !htmlIds.has(id));
if (missing.length) fail('app.js 引用了不存在的 ID: ' + missing.join(', '));
else ok(`app.js 引用的 ${usedIds.size} 个 ID 全部存在`);

const unused = [...htmlIds].filter((id) => !usedIds.has(id));
if (unused.length) console.log('  · 未被 JS 引用的 ID（正常，可能是纯样式用）: ' + unused.join(', '));

/* ---------- 1b. 标签平衡（面板 HTML 是手工维护的，多一个 div 会静默弄乱排版） ---------- */
console.log('\n1b) HTML 标签平衡');
{
  const count = (re) => (html.match(re) || []).length;
  const pairs = [['div', /<div\b/g, /<\/div>/g], ['section', /<section\b/g, /<\/section>/g],
    ['select', /<select\b/g, /<\/select>/g], ['textarea', /<textarea\b/g, /<\/textarea>/g]];
  let unbal = 0;
  for (const [name, o, c] of pairs) {
    const a = count(o), b = count(c);
    if (a !== b) { fail(`<${name}> 开合不匹配: 开 ${a} / 闭 ${b}`); unbal++; }
  }
  if (!unbal) ok('div / section / select / textarea 开合数量一致');
}

/* ---------- 2. 参数名 ---------- */
console.log('\n2) 参数名一致性');
const defBlock = render.slice(render.indexOf('const DEFAULTS = {'), render.indexOf('/* 比例常量'));
const defKeys = new Set([...defBlock.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]));
const appParams = new Set([...app.matchAll(/\bp\.([a-zA-Z][a-zA-Z0-9]*)\s*=/g)].map((m) => m[1]));
const missingParams = [...appParams].filter((k) => !defKeys.has(k) && k !== 'rows');
if (missingParams.length) fail('app.js 写入了 DEFAULTS 中不存在的参数: ' + missingParams.join(', '));
else ok(`app.js 写入的 ${appParams.size} 个参数都在 DEFAULTS 中`);

const renderR = new Set([...render.matchAll(/\bp\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));
const notDefault = [...renderR].filter((k) => !defKeys.has(k) && !['rows', 'code'].includes(k));
if (notDefault.length) console.log('  · render 中读取但不在 DEFAULTS（运行时注入）: ' + notDefault.join(', '));

/* ---------- 3. 引用 ---------- */
console.log('\n3) 资源引用');
const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
for (const s of [...srcs, ...links]) {
  if (fs.existsSync(path.join(root, 'src', s))) ok('存在: ' + s + (s === 'logo-data.js' ? '（由 build.js 生成）' : ''));
  else fail('缺失: ' + s);
}

/* ---------- 4. 控件绑定方式（回归：就地编辑曾绑错滑块） ---------- */
console.log('\n4) 控件绑定方式');
/* .ctl.grid2 里一个 .ctl 装两个滑块，所以「output → closest(.ctl) → 第一个 range」
 * 会让右半边的数值去改左边那个滑块。必须从滑块出发找自己的 output。 */
if (/closest\('\.ctl'\)[\s\S]{0,120}querySelector\('input\[type="range"\]'\)/.test(app)) {
  fail('就地编辑不能通过 closest(\'.ctl\') 找滑块（grid2 里会拿到左边那个）');
} else {
  ok('就地编辑按「滑块 → 自身 cell 里的 output」绑定');
}
if (/querySelectorAll\('input\[type="range"\]'\)/.test(app)) ok('就地编辑从滑块侧遍历');
else fail('就地编辑没有按滑块遍历');

/* grid2 结构：滑块与它的 output 必须在同一个 cell 里（否则「滑块 → parentElement → output」取不到） */
console.log('\n4b) grid2 结构（滑块与数值成对）');
{
  const chunks = html.split('<div class="ctl').slice(1).map((s) => s.split('<div class="ctl')[0]);
  let n = 0;
  const bad = [];
  chunks.forEach((s) => {
    if (!/^ grid2"/.test(s)) return;
    n++;
    const outs = [...s.matchAll(/<output id="([^"]+)"/g)].map((m) => m[1]);
    const ranges2 = [...s.matchAll(/<input type="range" id="([^"]+)"/g)].map((m) => m[1]);
    if (outs.length !== ranges2.length) bad.push('[output ' + outs.length + ' / range ' + ranges2.length + '] ' + outs.join(',')); 
  });
  if (bad.length) fail('grid2 块里 output 与 range 数量不一致: ' + bad.join(' | '));
  else ok(n + ' 个 .ctl.grid2 块里 output 与 range 一一对应');
}

/* ---------- 5. CSS 类 ---------- */
console.log('\n5) CSS 类');
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
const htmlClasses = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && htmlClasses.add(c));
const noStyle = [...htmlClasses].filter((c) => !cssClasses.has(c));
if (noStyle.length) console.log('  · HTML 中无对应 CSS 的类: ' + noStyle.join(', '));
else ok('HTML 使用的类都有样式定义');

const jsClasses = new Set([...app.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap((m) => m[1].split(/\s+/)));
const noStyleJs = [...jsClasses].filter((c) => c && !cssClasses.has(c));
if (noStyleJs.length) fail('JS 动态使用的类无样式: ' + noStyleJs.join(', '));
else ok('JS 动态类都有样式定义');

/* ---------- 6. 编码 ---------- */
console.log('\n6) 编码');
for (const f of ['src/index.html', 'src/app.js', 'src/render.js', 'src/zip.js', 'src/styles.css', 'build.js']) {
  const b = fs.readFileSync(path.join(root, f));
  const bad = (b.toString('utf8').match(/\uFFFD/g) || []).length;
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  if (bad) fail(f + ' 含 ' + bad + ' 个替换字符（编码损坏）');
  else ok(f + ' UTF-8 正常' + (bom ? '（含 BOM，浏览器可接受）' : ''));
}

console.log('\n' + (errors ? `发现 ${errors} 个问题` : '全部检查通过'));
process.exit(errors ? 1 : 0);
