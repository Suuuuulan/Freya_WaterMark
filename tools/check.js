/* check.js — 静态一致性检查：
 *   1. DOM ID：app.js 直接引用的 + 声明表里的，是否都存在于 index.html；ID 是否重复
 *   2. 声明表 ↔ DEFAULTS ↔ HTML 控件初值 三方一致（默认值只允许有一处）
 *   3. index.html 是否只引用存在的脚本/样式
 *   4. 控件绑定方式 / grid2 结构 / CSS 类 / 编码
 * 用法: node tools/check.js
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

/* 在 Node 里以「浏览器脚本」的方式加载 render.js + params.js，
 * 直接拿到 DEFAULTS 与声明表（不复制一份，避免检查本身走偏）。 */
const g = globalThis;
new Function('module', 'global', 'window', 'document', 'Image', 'crypto', render)({ exports: {} }, g, g, {}, function () {}, {});
new Function('module', 'global', 'window', 'document', 'Image', 'crypto', read('src/params.js'))({ exports: {} }, g, g, {}, function () {}, {});
const DEFAULTS = g.FreyaWM && g.FreyaWM.DEFAULTS;
const PR = g.FreyaParams;
if (!DEFAULTS || !PR) {
  console.log('  ✗ 无法加载 render.js / params.js 的导出');
  process.exit(1);
}

/* ---------- 1. DOM ID ---------- */
console.log('1) DOM 元素 ID');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
PR.ALL.forEach((e) => { usedIds.add(e.id); if (e.out) usedIds.add(e.out); });
const missing = [...usedIds].filter((id) => !htmlIds.has(id));
if (missing.length) fail('app.js / 声明表引用了不存在的 ID: ' + missing.join(', '));
else ok(`${usedIds.size} 个 ID（含声明表里的控件与数值）全部存在`);

/* 重复 ID：getElementById 只返回第一个，第二个控件会「点了没反应」且不报错。
 * 曾有一次复制粘贴让「标签列宽」在两张卡里各出现一份，滑块彻底失效、测试全绿。 */
const idList = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const dupIds = [...new Set(idList.filter((v, i) => idList.indexOf(v) !== i))];
if (dupIds.length) fail('重复的 DOM id（后出现的那个控件会失效）: ' + dupIds.join(', '));
else ok(`${idList.length} 个 DOM id 无重复`);

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

/* ---------- 2. 声明表 / DEFAULTS / HTML 三方一致 ---------- */
console.log('\n2) 声明表 ↔ DEFAULTS ↔ HTML 初值');

// 2a 声明里的参数名必须真实存在（防止拼错 key 静默失效）
const defKeys = new Set(Object.keys(DEFAULTS));
const ghostKeys = PR.ALL.filter((e) => !defKeys.has(e.key)).map((e) => e.id + '→' + e.key);
if (ghostKeys.length) fail('声明表里的参数在 DEFAULTS 中不存在: ' + ghostKeys.join(', '));
else ok(`${PR.ALL.length} 条声明的参数名都在 DEFAULTS 中`);

// 2b 反方向：DEFAULTS 里每个参数都该有控件（以下几项由专门的 UI 处理）
// position/rows/cardsClosed 由专门的 UI 处理；headerFontScale/bold 只有引擎默认值，面板不暴露
const NO_CONTROL = new Set(['position', 'rows', 'cardsClosed', 'code', 'headerFontScale', 'bold']);
const uncovered = [...defKeys].filter((k) => !NO_CONTROL.has(k) && !PR.ALL.some((e) => e.key === k));
if (uncovered.length) fail('DEFAULTS 里有参数没有对应控件（新增参数忘了加声明）: ' + uncovered.join(', '));
else ok('DEFAULTS 里的参数都有对应控件（position / rows / cardsClosed / code 另行处理）');

// 2c HTML 里的参数控件都必须登记在表里（防止「加了控件但没接上」）
const ctrls = new Map();
for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
  const idm = /\bid="([^"]+)"/.exec(m[2]);
  if (idm) ctrls.set(idm[1], { tag: m[1], attrs: m[2] });
}
const NON_PARAM = new Set(['fileInput']);      // 隐藏的文件选择器，不是参数
const declared = new Set(PR.ALL.map((e) => e.id));
const undeclared = [...ctrls.keys()].filter((id) => !declared.has(id) && !NON_PARAM.has(id));
if (undeclared.length) fail('HTML 里的控件没有登记到声明表（改了没生效）: ' + undeclared.join(', '));
else ok(`${ctrls.size - NON_PARAM.size} 个参数控件全部登记在表里`);

// 2d HTML 初值必须等于「DEFAULTS 经同一套换算后的值」——默认值只允许存在一处
{
  const bad = [];
  PR.ALL.forEach((e) => {
    const c = ctrls.get(e.id);
    if (!c) return;
    if (c.tag === 'textarea') return;              // 文本内容由 writeUI 填
    const want = PR.toControl(e, DEFAULTS);
    if (e.kind === 'bool') {
      const has = /\bchecked\b/.test(c.attrs);
      if (has !== !!want) bad.push(`${e.id}: checked=${has}，DEFAULTS 为 ${!!want}`);
      return;
    }
    let got = null;
    if (c.tag === 'select') {
      const block = new RegExp(`<select[^>]*\\bid="${e.id}"[\\s\\S]*?</select>`).exec(html);
      if (block) {
        const sel = /<option[^>]*\bselected\b[^>]*\bvalue="([^"]*)"/.exec(block[0]);
        const first = /<option[^>]*\bvalue="([^"]*)"/.exec(block[0]);
        got = sel ? sel[1] : (first ? first[1] : null);
      }
    } else {
      const vm = /\bvalue="([^"]*)"/.exec(c.attrs);
      got = vm ? vm[1] : null;
    }
    if (got !== String(want)) bad.push(`${e.id}: HTML=${JSON.stringify(got)}，应为 ${JSON.stringify(String(want))}`);
  });
  if (bad.length) fail('HTML 控件初值与 DEFAULTS 不一致（改了一处忘了另一处）:\n      ' + bad.join('\n      '));
  else ok('每个控件的 HTML 初值都等于 DEFAULTS 换算值');
}

// 2e render 只读取 DEFAULTS 里有的参数
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
