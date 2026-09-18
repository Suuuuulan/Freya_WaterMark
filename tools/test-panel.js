/* test-panel.js — 面板交互回归（纯 DOM 桩，不启动浏览器）
 * 覆盖：点击 output 就地编辑数值、夹取/还原/取消、与 params 同步、写入 localStorage、
 *       以及导出设置的持久化。
 * 用法: node tools/test-panel.js
 */
const fs = require('fs');
const root = 'D:/Work/Freya_WaterMark/';
const html = fs.readFileSync(root + 'index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const outs = [...html.matchAll(/<output id="([^"]+)"[^>]*>([^<]*)<\/output>/g)].map((m) => ({ id: m[1], text: m[2] }));
const ranges = [...html.matchAll(/<input type="range" id="([^"]+)"([^>]*)>/g)].map((m) => {
  const g = (k) => { const r = new RegExp(k + '="([^"]*)"').exec(m[2]); return r ? r[1] : ''; };
  return { id: m[1], min: g('min'), max: g('max'), step: g('step'), value: g('value') };
});
const store = {};
/** 记录画到 canvas 上的所有 fillText 文字（校验水印最终内容） */
const drawn = [];
const drawnText = () => drawn.join('').replace(/\s+/g, '');

function mkEl(tag, id) {
  const L = {};
  const el = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', value: '', textContent: '', checked: false,
    children: [], parentNode: null, style: {}, dataset: {}, onclick: null, title: '', min: '', max: '', step: '',
    _cls: new Set(),
    classList: {
      add(c) { el._cls.add(c); },
      remove(c) { el._cls.delete(c); },
      toggle(c, on) { on ? el._cls.add(c) : el._cls.delete(c); },
      contains(c) { return el._cls.has(c); }
    },
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); },
    dispatch(t, ev) {
      const e = Object.assign({ target: el, preventDefault() {}, key: '' }, ev || {});
      (L[t] || []).forEach((f) => f(e));
      if (t === 'click' && el.onclick) el.onclick(e);
    },
    /** 真实 DOM API：dispatchEvent(new Event('input')) */
    dispatchEvent(ev) {
      const type = ev && ev.type;
      if (type) el.dispatch(type, ev);
    },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    /** innerHTML = '' 时必须清空 children（真实 DOM 行为），否则重复渲染后会读到旧行 */
    get innerHTML() { return el._html || ''; },
    set innerHTML(v) { el._html = String(v); el.children.length = 0; },
    /** canvas 兜底：toBlob 同步回调（导出流程测试用） */
    toBlob(cb) { cb({ size: 1024, type: 'image/jpeg', __fake: true }); },
    toDataURL() { return 'data:image/jpeg;base64,AAAA'; },
    replaceWith(node) {
      const p = el.parentNode;
      if (!p) return;
      const i = p.children.indexOf(el);
      if (i >= 0) { p.children[i] = node; node.parentNode = p; el.parentNode = null; }
    },
    remove() { const p = el.parentNode; if (!p) return; const i = p.children.indexOf(el); if (i >= 0) p.children.splice(i, 1); },
    click() { el.dispatch('click'); },
    focus() {}, select() {},
    closest(sel) { // 支持 .ctl / .field（读不到时返回一个带 classList 的替身）
      const cls = sel.replace(/^\./, '');
      let n = el;
      while (n) { if (n.classList && n.classList.contains(cls)) return n; n = n.parentNode; }
      const stub = mkEl('div');
      stub.classList.add(cls);
      return stub;
    },
    querySelector(sel) {
      const match = (n) => {
        if (sel === 'label') return n.tagName === 'LABEL';
        if (sel === 'output') return n.tagName === 'OUTPUT';
        if (sel === 'input[type="range"]') return n.tagName === 'INPUT' && n.type === 'range';
        if (sel === 'input.ctl-edit') return n.tagName === 'INPUT' && n.classList.contains('ctl-edit');
        return false;
      };
      const walk = (node) => {
        for (const c of node.children) {
          if (match(c)) return c;
          const r = walk(c);
          if (r) return r;
        }
        return null;
      };
      return walk(el);
    },
    querySelectorAll() { return []; },
    getContext() {
      const grad = { addColorStop() {} };
      const noop = () => {};
      return new Proxy({}, {
        get: (t, k) => {
          if (k === 'measureText') return () => ({ width: 0 });
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
          if (k === 'fillText') return (s) => { drawn.push(String(s)); };   // 记录真正画上去的文字
          return noop;
        }
      });
    }
  };
  Object.defineProperty(el, 'value', {
    get() { return el._val !== undefined ? el._val : ''; },
    set(v) {
      if (el.type === 'range' && el.min !== '' && el.max !== '') {
        let n = parseFloat(v);
        if (isFinite(n)) {
          const lo = parseFloat(el.min), hi = parseFloat(el.max);
          n = Math.min(hi, Math.max(lo, n));
          const st = parseFloat(el.step || '1');
          if (isFinite(st) && st > 0) n = lo + Math.round((n - lo) / st) * st;
          const dec = (String(st).split('.')[1] || '').length;
          el._val = dec ? n.toFixed(dec) : String(Math.round(n));
          return;
        }
      }
      el._val = String(v);
    },
    enumerable: true, configurable: true
  });
  return defineClassSync(el);
}

/* className 与 classList 必须互相同步（真实 DOM 就是这样） */
function defineClassSync(el) {
  Object.defineProperty(el, 'className', {
    get() { return [...el._cls].join(' '); },
    set(v) { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
    enumerable: true, configurable: true
  });
  return el;
}

/* 组装：.ctl > label + output + input[type=range]（与真实 HTML 结构一致）
 * 封装成 bootOnce()，便于测「刷新后恢复」时重新装配一次。
 * 每次 boot 都用**自己的一套元素**（doc.getElementById 闭包本地的 myEls），
 * 否则第二次 boot 会把第一次那个 app 实例的 DOM 查询偷偷换掉（踩过一次）。 */
let els = {};          // 最近一次 boot 的元素，供 ①～⑦ 的断言工具用
let ctls = [];
let win = null;

const OUT2SLIDER = {
  outScale: 'scale', outMarginX: 'marginX', outMarginY: 'marginY', outOpacity: 'opacity',
  outTableOpacity: 'tableOpacity', outTitleScale: 'titleFontScale', outTitleHeight: 'titleHeightScale',
  outTitleLineH: 'titleLineHeightRatio', outHeaderPad: 'headerPadRatio', outLabelW: 'labelW',
  outTitleLS: 'titleLS', outBodyLS: 'bodyLS', outLabelLS: 'labelLS', outValueGap: 'valueGapRatio',
  outRadius: 'radius', outShadow: 'shadow', outLogoScale: 'logoScale', outCodeSize: 'codeSize',
  outQuality: 'quality'
};

function bootOnce() {
  const myEls = {}; const myCtls = [];
  ids.forEach((id) => { myEls[id] = mkEl('div', id); });
  // 导出/视图控件的初值（与 src/index.html 一致）
  const e = myEls;
  e.format.value = 'image/jpeg'; e.quality.value = '92'; e.nameTpl.value = '{name}_watermark';
  e.maxEdge.value = '0'; e.fitView.checked = true;
  e.title.value = '南京云之宝智算中心'; e.codeLen.value = '14'; e.codeLabel.value = '防伪';
  e.fontFamily.value = 'SimHei, Heiti SC, Microsoft YaHei, PingFang SC, sans-serif';
  e.accent.value = '#15a7fa'; e.dotColor.value = '#f4c647'; e.bgColor.value = '#f5f5f5';
  e.textColor.value = '#111111'; e.showTable.checked = true; e.showLogo.checked = true;
  e.showCode.checked = true;
  ['r1', 'r2', 'r3'].forEach((r, i) => {
    e[r + 'on'].checked = i < 2; e[r + 'label'].value = 'L' + i;
    e[r + 'type'].value = 'text'; e[r + 'text'].value = 'T' + i;
    e[r + 'text'].placeholder = i === 1 ? '地点内容，可留空' : '自定义文本内容';
  });
  for (const o of outs) {
    const sid = OUT2SLIDER[o.id];
    const r = ranges.find((x) => x.id === sid);
    if (!r) continue;
    const ctl = mkEl('div'); ctl.classList.add('ctl');
    const label = mkEl('label');
    // 必须复用 myEls 里的同一对象：app.js 通过 getElementById 拿到的就是它
    const out = myEls[o.id];
    out.tagName = 'OUTPUT';
    out.textContent = o.text;
    const slider = myEls[sid];
    slider.tagName = 'INPUT'; slider.type = 'range';
    slider.min = r.min; slider.max = r.max; slider.step = r.step; slider.value = r.value;
    label.appendChild(out);
    ctl.appendChild(label);
    ctl.appendChild(slider);
    myCtls.push({ ctl, out, slider, id: o.id });
  }
  const nowBtns = [{ dataset: { now: 'r1text' }, onclick: null }];
  const fileBtns = [{ dataset: { filetime: 'r1text' }, onclick: null }];
  const doc = {
    body: mkEl('body'),
    getElementById: (id) => myEls[id] || (myEls[id] = mkEl('div', id)),
    createElement: (t) => mkEl(t),
    querySelectorAll: (sel) => (sel === 'output' ? myCtls.map((c) => c.out)
      : sel === '[data-now]' ? nowBtns
        : sel === '[data-filetime]' ? fileBtns : []),
    addEventListener() {}
  };
  const myWin = { addEventListener() {}, FREYA_LOGO_DATA_URL: '' };
  const urlStub = { createObjectURL: (f) => 'blob:fake/' + (f && f.name ? f.name : 'x'), revokeObjectURL() {} };
  new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'Image', 'Event', 'setTimeout', 'URL', scripts.join('\n'))(
    myWin, doc,
    { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    (cb) => setTimeout(cb, 0),
    function () {   // 假 Image：src 赋值后异步触发 onload（与 test-render.js 一致）
      const self = this;
      this.naturalWidth = 295; this.naturalHeight = 135;
      Object.defineProperty(this, 'src', {
        set() { setTimeout(() => { if (self.onload) self.onload(); }, 0); },
        get() { return ''; }
      });
    },
    function (t) { this.type = t; }, setTimeout, urlStub);
  win = myWin;
  els = myEls; ctls = myCtls;      // 供 ①～⑦ 的断言工具用
  return { win: myWin, els: myEls, ctls: myCtls, doc, btns: { now: nowBtns, filetime: fileBtns } };
}
bootOnce();

/* ---------- 断言 ---------- */
let ok = 0, bad = 0;
const t = (name, cond, detail) => {
  if (cond) { ok++; console.log('  OK   ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { bad++; console.log('  FAIL ' + name + '  → ' + detail); }
};
const pick = (outId) => ctls.find((c) => c.id === outId);
const edit = (outId, typed, key) => {
  const c = pick(outId);
  c.out.dispatch('click');                                  // 进入编辑
  const inp = c.ctl.querySelector('input.ctl-edit');
  if (!inp) return { inp: null, c };
  inp.value = typed;
  inp.dispatch('keydown', { key: key || 'Enter' });          // 提交 / 取消
  return { inp, c, after: c.ctl.querySelector('input.ctl-edit') };
};

console.log('① 点击 output 是否进入就地编辑');
{
  const c = pick('outTitleScale');
  c.out.dispatch('click');
  const inp = c.ctl.querySelector('input.ctl-edit');
  t('点击后出现同位置 input', !!inp, inp ? 'type=' + inp.type + ' value=' + inp.value : '未出现');
  t('input 带 ctl-edit 类（用于样式）', !!inp && inp.classList.contains('ctl-edit'));
  t('原 output 被替换掉', c.ctl.querySelector('input.ctl-edit') !== null);
  // 清理：取消
  inp && inp.dispatch('keydown', { key: 'Escape' });
}

console.log('\n② 键入数值 → 滑块与参数同步（标题字号 100% → 150）');
{
  const r = edit('outTitleScale', '150');
  const c = pick('outTitleScale');
  t('滑块值已更新', c.slider.value === '150', 'slider=' + c.slider.value);
  t('params.titleFontScale = 1.5', win.__freya.params.titleFontScale === 1.5, 'got=' + win.__freya.params.titleFontScale);
  t('编辑框已还原为 output', !c.ctl.querySelector('input.ctl-edit'));
  t('output 文本被 readUI 回填', c.out.textContent === '150%', 'text=' + c.out.textContent);
}

console.log('\n③ 越界值自动夹取（标题字号 max=200，键入 9999）');
{
  edit('outTitleScale', '9999');
  const c = pick('outTitleScale');
  t('滑块被夹到 200', c.slider.value === '200', 'slider=' + c.slider.value);
  t('params = 2.0', win.__freya.params.titleFontScale === 2, 'got=' + win.__freya.params.titleFontScale);
}

console.log('\n④ 非法输入还原（标题字号键入 abc）');
{
  const before = win.__freya.params.titleFontScale;
  edit('outTitleScale', 'abc');
  const c = pick('outTitleScale');
  t('参数未变', win.__freya.params.titleFontScale === before, 'got=' + win.__freya.params.titleFontScale);
  t('编辑框已还原', !c.ctl.querySelector('input.ctl-edit'));
  t('文本还原为当前值', c.out.textContent === '200%', 'text=' + c.out.textContent);
}

console.log('\n⑤ Escape 取消编辑（不提交）');
{
  edit('outRadius', '77', 'Escape');
  const c = pick('outRadius');
  t('参数未变', win.__freya.params.radius === 0.016, 'got=' + win.__freya.params.radius);
  t('编辑框已还原', !c.ctl.querySelector('input.ctl-edit'));
}

console.log('\n⑥ 小数与百分比两种格式都能解析');
{
  edit('outMarginX', '1.35');
  const c = pick('outMarginX');
  t('outMarginX 1.35 → 按 step=0.1 吸附为 1.4', Math.abs(win.__freya.params.marginX - 1.4) < 1e-9, 'got=' + win.__freya.params.marginX);
  t('回填保留 1 位小数', c.out.textContent === '1.3%' || c.out.textContent === '1.4%', 'text=' + c.out.textContent);
  edit('outTitleLineH', '1.8');
  const c2 = pick('outTitleLineH');
  t('outTitleLineH 1.8 → params=1.8', win.__freya.params.titleLineHeightRatio === 1.8, 'got=' + win.__freya.params.titleLineHeightRatio);
  t('回填两位小数', c2.out.textContent === '1.80', 'text=' + c2.out.textContent);
}

console.log('\n⑦ 修改后是否持久化');
{
  const saved = JSON.parse(store['freya-watermark.params.v1'] || '{}');
  t('titleFontScale 已入库', saved.titleFontScale === 2, 'saved=' + saved.titleFontScale);
  t('titleLineHeightRatio 已入库', saved.titleLineHeightRatio === 1.8, 'saved=' + saved.titleLineHeightRatio);
}

console.log('\n⑧ 导出设置的持久化');
{
  const set = (id, v) => { els[id].value = v; els[id].dispatch('change'); };
  set('quality', '75'); set('format', 'image/png'); set('nameTpl', '{date}_{i}'); set('maxEdge', '2000');
  const saved = JSON.parse(store['freya-watermark.params.v1'] || '{}');
  t('quality 已入库', saved.quality === 75, 'saved=' + saved.quality);
  t('format 已入库', saved.format === 'image/png', 'saved=' + saved.format);
  t('nameTpl 已入库', saved.nameTpl === '{date}_{i}', 'saved=' + saved.nameTpl);
  t('maxEdge 已入库', saved.maxEdge === 2000, 'saved=' + saved.maxEdge);

  const p2 = bootOnce();
  const P2 = p2.win.__freya.params;
  t('重启后 quality 恢复', P2.quality === 75, 'got=' + P2.quality);
  t('重启后 format 恢复', P2.format === 'image/png', 'got=' + P2.format);
  t('重启后 format 面板选中项正确', p2.els.format.value === 'image/png', 'got=' + p2.els.format.value);
  t('重启后 nameTpl 恢复', P2.nameTpl === '{date}_{i}', 'got=' + P2.nameTpl);
  t('重启后 maxEdge 恢复', P2.maxEdge === 2000, 'got=' + P2.maxEdge);
  t('重启后 titleFontScale 恢复（前面用 output 编辑改过）', P2.titleFontScale === 2, 'got=' + P2.titleFontScale);
  t('重启后 titleLineHeightRatio 恢复', P2.titleLineHeightRatio === 1.8, 'got=' + P2.titleLineHeightRatio);
}

/* ---------- ⑨～⑯ 时间段批量分配（导入 → 分配 → 应用 → 持久化） ---------- */
const mkFile = (name, ms) => ({
  name, size: 900 * 1024, type: 'image/jpeg', lastModified: ms,
  slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) })
});
const flush = (ms) => new Promise((r) => setTimeout(r, ms == null ? 200 : ms));
const rangeOf = (it) => (it.range ? it.range.start + '-' + it.range.end : '无');
const rangesOf = (items) => items.map(rangeOf).join(',');
const shotsOf = (items) => items.map((it) => it.shot || '无').join(',');
const inWindow = (shot, range) => {
  if (!shot || !range) return false;
  const to = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const v = to(shot), lo = to(range.start), hi = to(range.end);
  return v >= lo && v <= hi;
};
const setText = (el, v) => { el.value = v; el.dispatch('input'); };
const rowText = (box, i) => box.children[i].children.map((c) => c.textContent).join('|');
/* 让随机变成确定值：0 → 区间起点，0.999… → 区间末端 */
const withRandom = (v, fn) => { const o = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = o; } };

const USER_RANGES = '07:08-07:23\n11:33-11:48\n13:10-13:25\n18:33-18:48';
const NAMES = ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg', 'IMG_0004.jpg'];

(async () => {
  delete store['freya-watermark.params.v1'];      // 干净起点：默认参数
  const b = bootOnce();
  const E = b.els;
  const S = b.win.__freya;
  const WM = b.win.FreyaWM;

  const importFiles = async (names, baseMs) => {
    E.fileInput.files = names.map((n, i) => mkFile(n, (baseMs || new Date(2026, 7, 19, 7, 15).getTime()) + i * 1000));
    E.fileInput.onchange({ target: E.fileInput });
    await flush(200);
  };

  console.log('\n⑨ 默认预填 + 一次导入 4 张 → 各自在区间内随机取一个拍摄时间');
  {
    t('时间段框默认预填用户给的 4 个区间',
      E.rangesText.value === USER_RANGES, JSON.stringify(E.rangesText.value));
    await importFiles(NAMES);
    t('导入 4 张', S.items.length === 4, 'items=' + S.items.length);
    t('4 张分别拿到 07:08-07:23 / 11:33-11:48 / 13:10-13:25 / 18:33-18:48',
      rangesOf(S.items) === '07:08-07:23,11:33-11:48,13:10-13:25,18:33-18:48', rangesOf(S.items));
    t('每张的随机时间点都落在自己的区间内', S.items.every((it) => inWindow(it.shot, it.range)), shotsOf(S.items));
    t('4 张的时间点互不相同（区间不重叠）', new Set(S.items.map((it) => it.shot)).size === 4, shotsOf(S.items));
    t('表格「拍摄时间」行 = 日期 + 随机到的时刻（不再是区间）',
      WM.formatShot(S.items[0].date, 'datetime', S.items[0].shot) === '2026.08.19 ' + S.items[0].shot,
      WM.formatShot(S.items[0].date, 'datetime', S.items[0].shot));
    t('第 4 张 = 2026.08.19 + 区间 18:33-18:48 内的时刻',
      WM.formatShot(S.items[3].date, 'datetime', S.items[3].shot) === '2026.08.19 ' + S.items[3].shot &&
      inWindow(S.items[3].shot, S.items[3].range),
      WM.formatShot(S.items[3].date, 'datetime', S.items[3].shot));
    t('日期取自图片本身（EXIF 缺失时回落文件时间）',
      S.items[0].date.getFullYear() === 2026 && S.items[0].date.getMonth() === 7 && S.items[0].date.getDate() === 19,
      String(S.items[0].date));
    t('预览信息 = …· 拍摄时间 hh:mm（区间 07:08-07:23）',
      new RegExp('拍摄时间 \\d{2}:\\d{2}（区间 07:08-07:23）$').test(E.imgMeta.textContent), E.imgMeta.textContent);

    // 稳定性：改别的参数触发重绘，随机时间点不能跟着变（否则每次重绘都在跳）
    const kept = shotsOf(S.items);
    setText(E.titleLS, '8');
    await flush(150);
    t('重绘后时间点不变（随机只在分配时取一次）', shotsOf(S.items) === kept, kept + ' → ' + shotsOf(S.items));
    setText(E.titleLS, '5');
  }

  console.log('\n⑩ 映射清单 / 状态 / 预览信息 / 导出文件名 {range} {shot}');
  {
    t('映射清单 4 行', E.rangeMap.children.length === 4, 'rows=' + E.rangeMap.children.length);
    t('第 1 行 = 1|IMG_0001.jpg|07:08-07:23 → <时刻>',
      rowText(E.rangeMap, 0) === '1|IMG_0001.jpg|07:08-07:23 → ' + S.items[0].shot, rowText(E.rangeMap, 0));
    t('第 4 行 = 4|IMG_0004.jpg|18:33-18:48 → <时刻>',
      rowText(E.rangeMap, 3) === '4|IMG_0004.jpg|18:33-18:48 → ' + S.items[3].shot, rowText(E.rangeMap, 3));
    t('状态 = 4 个时间段 · 已与队列一致', E.rangeStatus.textContent === '4 个时间段 · 已与队列一致', E.rangeStatus.textContent);

    // 导出：捕获 <a download> 文件名
    const anchors = [];
    b.doc.createElement = (tag) => { const el = mkEl(tag); if (String(tag).toLowerCase() === 'a') anchors.push(el); return el; };
    setText(E.nameTpl, '{range}_{name}');
    E.btnExportOne.dispatch('click');
    await flush(120);
    t('导出文件名里的 {range} = 0708-0723', anchors.length === 1 && anchors[0].download === '0708-0723_IMG_0001.jpg',
      anchors.map((a) => a.download).join(',') || '未导出');

    anchors.length = 0;
    setText(E.nameTpl, '{shot}_{name}');
    E.btnExportOne.dispatch('click');
    await flush(120);
    t('导出文件名里的 {shot} = 图里画的那个时刻',
      anchors.length === 1 && anchors[0].download === S.items[0].shot.replace(':', '') + '_IMG_0001.jpg',
      anchors.map((a) => a.download).join(',') || '未导出');
  }

  console.log('\n⑪ 改列表不隐式重排；「应用到队列」才生效（且幂等）');
  {
    setText(E.rangesText, '08:00-08:15\n12:00-12:15\n14:00-14:15\n19:00-19:15');
    t('改列表后已分配的时间段不变（粘性快照）',
      rangesOf(S.items) === '07:08-07:23,11:33-11:48,13:10-13:25,18:33-18:48', rangesOf(S.items));
    t('状态变为「待更新 4 项」', E.rangeStatus.textContent === '4 个时间段 · 待更新 4 项', E.rangeStatus.textContent);
    t('清单行标为待更新（pend）', E.rangeMap.children[0].classList.contains('pend'));

    withRandom(0, () => E.btnApplyRanges.dispatch('click'));
    t('应用后 4 张全部更新为新时间段',
      rangesOf(S.items) === '08:00-08:15,12:00-12:15,14:00-14:15,19:00-19:15', rangesOf(S.items));
    t('区间变了 → 时间点重新随机（取到区间起点 08:00…）',
      shotsOf(S.items) === '08:00,12:00,14:00,19:00', shotsOf(S.items));
    withRandom(0.999999, () => E.btnApplyRanges.dispatch('click'));
    t('区间没变 → 再次应用不重新随机（幂等）', shotsOf(S.items) === '08:00,12:00,14:00,19:00', shotsOf(S.items));
    t('状态回到「已与队列一致」', E.rangeStatus.textContent === '4 个时间段 · 已与队列一致', E.rangeStatus.textContent);
  }

  console.log('\n⑫ 某行留空 = 该张不分配（位置仍然对应）');
  {
    setText(E.rangesText, '07:08-07:23\n\n13:10-13:25\n18:33-18:48');
    E.btnApplyRanges.dispatch('click');
    t('第 2 张无时间段，其余 3 张不受影响',
      rangesOf(S.items) === '07:08-07:23,无,13:10-13:25,18:33-18:48', rangesOf(S.items));
    t('第 2 张同时也没有随机时间点', S.items[1].range === null && S.items[1].shot === null, shotsOf(S.items));
    t('无时间段的那行标为 none', E.rangeMap.children[1].classList.contains('none'));
    t('无时间段时回退为图片自身时间（1 个时间）',
      WM.formatShot(S.items[1].date, 'datetime', S.items[1].shot) === '2026.08.19 07:15',
      WM.formatShot(S.items[1].date, 'datetime', S.items[1].shot));
    t('状态按有效条数计 = 3 个时间段', E.rangeStatus.textContent === '3 个时间段 · 已与队列一致', E.rangeStatus.textContent);
  }

  console.log('\n⑬ 非法行只影响该行并提示行号');
  {
    setText(E.rangesText, '07:08-07:23\n25:00-26:00\n13:10');
    t('状态提示第 2、3 行无法识别', /第 2、3 行无法识别/.test(E.rangeStatus.textContent), E.rangeStatus.textContent);
    t('非法输入不改变已分配结果', rangesOf(S.items) === '07:08-07:23,无,13:10-13:25,18:33-18:48', rangesOf(S.items));
    E.btnApplyRanges.dispatch('click');
    t('应用后只有第 1 张有时间段',
      rangesOf(S.items) === '07:08-07:23,无,无,无', rangesOf(S.items));
  }

  console.log('\n⑭ 关闭「导入时自动分配」后导入不再自动贴时间段');
  {
    E.btnClear.dispatch('click');
    E.rangeAuto.checked = false; E.rangeAuto.dispatch('change');
    setText(E.rangesText, USER_RANGES);
    await importFiles(NAMES);
    t('4 张都没有时间段和时间点', rangesOf(S.items) === '无,无,无,无' && shotsOf(S.items) === '无,无,无,无', shotsOf(S.items));
    t('状态显示待更新 4 项', E.rangeStatus.textContent === '4 个时间段 · 待更新 4 项', E.rangeStatus.textContent);
    E.btnApplyRanges.dispatch('click');
    t('手动「应用到队列」仍可分配',
      rangesOf(S.items) === '07:08-07:23,11:33-11:48,13:10-13:25,18:33-18:48', rangesOf(S.items));
    t('手动分配也各自随机到了区间内', S.items.every((it) => inWindow(it.shot, it.range)), shotsOf(S.items));
  }

  console.log('\n⑮ 清空按钮 = 停用时间段（清列表 + 取消全部分配）');
  {
    E.btnClearRanges.dispatch('click');
    t('列表已清空', E.rangesText.value === '', JSON.stringify(E.rangesText.value));
    t('全部分配已取消', rangesOf(S.items) === '无,无,无,无' && shotsOf(S.items) === '无,无,无,无', shotsOf(S.items));
    t('状态回到未启用', E.rangeStatus.textContent === '未启用', E.rangeStatus.textContent);
  }

  console.log('\n⑯ 重新随机：全部重随机 / 点单行重随机');
  {
    setText(E.rangesText, '08:00-08:15\n12:00-12:15\n14:00-14:15\n19:00-19:15');
    withRandom(0, () => E.btnApplyRanges.dispatch('click'));
    t('先全部落在区间起点', shotsOf(S.items) === '08:00,12:00,14:00,19:00', shotsOf(S.items));
    withRandom(0.999999, () => E.btnRerollShots.dispatch('click'));
    t('「重新随机」把 4 张都换成区间末端（区间不变）',
      shotsOf(S.items) === '08:15,12:15,14:15,19:15', shotsOf(S.items));
    t('区间没有被改动', rangesOf(S.items) === '08:00-08:15,12:00-12:15,14:00-14:15,19:00-19:15', rangesOf(S.items));
    withRandom(0, () => E.rangeMap.children[0].children[2].dispatch('click'));
    t('点清单里的时刻只重随机那一张', shotsOf(S.items) === '08:00,12:15,14:15,19:15', shotsOf(S.items));
    t('清单里显示的时刻同步更新', rowText(E.rangeMap, 0) === '1|IMG_0001.jpg|08:00-08:15 → 08:00', rowText(E.rangeMap, 0));
  }

  console.log('\n⑰ 时间段列表与开关的持久化');
  {
    setText(E.rangesText, '07:08-07:23\n11:33-11:48');
    t('rangesText 已入库', JSON.parse(store['freya-watermark.params.v1']).rangesText === '07:08-07:23\n11:33-11:48');
    t('rangeAuto=false 已入库', JSON.parse(store['freya-watermark.params.v1']).rangeAuto === false);
    const b2 = bootOnce();
    t('重启后 rangesText 恢复', b2.win.__freya.params.rangesText === '07:08-07:23\n11:33-11:48', JSON.stringify(b2.win.__freya.params.rangesText));
    t('重启后时间段框文本恢复', b2.els.rangesText.value === '07:08-07:23\n11:33-11:48');
    t('重启后「导入时自动分配」保持未勾选', b2.els.rangeAuto.checked === false);
    t('重启后队列为空（队列本来就不持久化，重新导入会重新随机）', b2.win.__freya.items.length === 0);
  }

  console.log('\n⑱ 「自定义日期+随机时间」行类型（日期来自行文本框，时间来自区间随机）');
  {
    E.btnClear.dispatch('click');
    E.rangeAuto.checked = true; E.rangeAuto.dispatch('change');
    setText(E.rangesText, USER_RANGES);
    await importFiles(NAMES);

    E.r1type.value = 'customdate'; E.r1type.dispatch('change');
    t('切到该类型后占位文字变成日期提示', E.r1text.placeholder === '2026.08.19（日期）', E.r1text.placeholder);
    t('状态/映射清单不受影响', E.rangeStatus.textContent === '4 个时间段 · 已与队列一致', E.rangeStatus.textContent);

    drawn.length = 0;
    setText(E.r1text, '2026-8-9');          // 顺带验证宽松格式与自动补零
    await flush(150);
    const want = '2026.08.09' + S.items[0].shot;
    t('画到图上的拍摄时间 = 自定义日期 + 区间随机时刻', drawnText().includes(want), 'want=' + want + ' got=' + drawnText().slice(0, 120));

    drawn.length = 0;
    setText(E.r1text, '不是日期');           // 日期写错 → 退回图片自身日期
    await flush(150);
    t('日期填错时退回图片自身日期（不再是 2026.08.09）',
      !drawnText().includes('2026.08.09') && drawnText().includes('2026.08.19' + S.items[0].shot),
      drawnText().slice(0, 120));

    // 还没有分配时间段时：自定义日期 + 图片自身时间（至少日期是自定义的）
    E.btnClearRanges.dispatch('click');
    drawn.length = 0;
    setText(E.r1text, '2025.01.02');        // 触发重绘
    await flush(150);
    t('没有时间段时 = 自定义日期 + 图片自身时间',
      drawnText().includes('2025.01.02' + WM.formatDate(S.items[0].date, 'time')),
      drawnText().slice(0, 120));

    // 快捷按钮：自定义日期行上只写日期、不把类型改掉
    b.btns.filetime[0].onclick();
    t('「用图片时间」只写入日期', E.r1text.value === '2026.08.19', E.r1text.value);
    t('「用图片时间」保持「自定义日期+随机时间」类型', E.r1type.value === 'customdate', E.r1type.value);
    b.btns.now[0].onclick();
    t('「用当前时间」也只写入日期', /^\d{4}\.\d{2}\.\d{2}$/.test(E.r1text.value), E.r1text.value);
    t('「用当前时间」同样保持类型', E.r1type.value === 'customdate', E.r1type.value);

    // 切回普通类型：占位文字恢复
    E.r1type.value = 'datetime'; E.r1type.dispatch('change');
    t('切回「拍摄时间」后占位文字恢复', E.r1text.placeholder === '自定义文本内容', E.r1text.placeholder);
    drawn.length = 0;
    setText(E.r1text, '2026.08.19 10:59');
    await flush(150);
    t('切回后日期重新来自图片文件（自定义日期不再生效）',
      !drawnText().includes('2026.08.09') && !drawnText().includes('2025.01.02'),
      drawnText().slice(0, 120));
  }

  console.log('\n' + (bad ? '✗ ' + bad + ' 项失败 / 共 ' + (ok + bad) : '✓ 全部通过（' + ok + ' 项）'));
  process.exit(bad ? 1 : 0);
})();

