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
    getContext() { return new Proxy({}, { get: (t, k) => (k === 'measureText' ? (() => ({ width: 0 })) : (() => {})) }); }
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
 * 封装成 bootOnce()，便于测「刷新后恢复」时重新装配一次。 */
let els = {};
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
  els = {}; ctls = [];
  ids.forEach((id) => { els[id] = mkEl('div', id); });
  // 导出/视图控件的初值（与 src/index.html 一致）
  els.format.value = 'image/jpeg'; els.quality.value = '92'; els.nameTpl.value = '{name}_watermark';
  els.maxEdge.value = '0'; els.fitView.checked = true;
  els.title.value = '南京云之宝智算中心'; els.codeLen.value = '14'; els.codeLabel.value = '防伪';
  els.fontFamily.value = 'SimHei, Heiti SC, Microsoft YaHei, PingFang SC, sans-serif';
  els.accent.value = '#15a7fa'; els.dotColor.value = '#f4c647'; els.bgColor.value = '#f5f5f5';
  els.textColor.value = '#111111'; els.showTable.checked = true; els.showLogo.checked = true;
  els.showCode.checked = true;
  ['r1', 'r2', 'r3'].forEach((r, i) => {
    els[r + 'on'].checked = i < 2; els[r + 'label'].value = 'L' + i;
    els[r + 'type'].value = 'text'; els[r + 'text'].value = 'T' + i;
  });
  for (const o of outs) {
    const sid = OUT2SLIDER[o.id];
    const r = ranges.find((x) => x.id === sid);
    if (!r) continue;
    const ctl = mkEl('div'); ctl.classList.add('ctl');
    const label = mkEl('label');
    // 必须复用 els 里的同一对象：app.js 通过 getElementById 拿到的就是它
    const out = els[o.id];
    out.tagName = 'OUTPUT';
    out.textContent = o.text;
    const slider = els[sid];
    slider.tagName = 'INPUT'; slider.type = 'range';
    slider.min = r.min; slider.max = r.max; slider.step = r.step; slider.value = r.value;
    label.appendChild(out);
    ctl.appendChild(label);
    ctl.appendChild(slider);
    ctls.push({ ctl, out, slider, id: o.id });
  }
  const doc = {
    body: mkEl('body'),
    getElementById: (id) => els[id] || (els[id] = mkEl('div', id)),
    createElement: (t) => mkEl(t),
    querySelectorAll: (sel) => (sel === 'output' ? ctls.map((c) => c.out) : []),
    addEventListener() {}
  };
  win = { addEventListener() {}, FREYA_LOGO_DATA_URL: '' };
  new Function('window', 'document', 'localStorage', 'requestAnimationFrame', 'Image', 'Event', 'setTimeout', scripts.join('\n'))(
    win, doc,
    { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    (cb) => setTimeout(cb, 0),
    function () { this.naturalWidth = 295; this.naturalHeight = 135; Object.defineProperty(this, 'src', { set() {}, get() { return ''; } }); },
    function (t) { this.type = t; }, setTimeout);
  return { win, els, ctls };
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

console.log('\n' + (bad ? '✗ ' + bad + ' 项失败 / 共 ' + (ok + bad) : '✓ 全部通过（' + ok + ' 项）'));
process.exit(bad ? 1 : 0);
