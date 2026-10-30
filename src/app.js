/* =========================================================================
 * app.js — 界面逻辑：导入 / 参数 / 预览 / 批量导出
 * ========================================================================= */
(function () {
  'use strict';

  const WM = window.FreyaWM;
  const Zip = window.FreyaZip;
  const P = window.FreyaParams;
  const IMG = window.FreyaImaging;
  const N = window.FreyaNaming;
  if (!WM || !Zip || !P || !IMG || !N) { console.error('依赖脚本未加载'); return; }
  /* 常用别名：调用处保持原样，实现分别落在 params / imaging / naming 三个模块里 */
  const loadImageEl = IMG.loadImageEl, makeThumb = IMG.makeThumb, ensureImage = IMG.ensureImage;
  const THUMB_EDGE = IMG.THUMB_EDGE;
  const extFor = N.extFor, safeName = N.safeName, buildName = N.buildName;

  const $ = (id) => document.getElementById(id);

  /* ---------------- 参数持久化（localStorage） ----------------
   * 只持久化「参数」，不持久化图片队列；code 是每张导出时随机生成的，不入库。
   * 隐私模式/禁用存储时 localStorage 会抛异常，全部包 try/catch 静默降级。 */
  const STORE_KEY = 'freya-watermark.params.v1';
  let saveTimer = 0;                     // saveParamsSoon 的节流句柄

  function loadSavedParams() {
    const base = JSON.parse(JSON.stringify(WM.DEFAULTS));
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return base;
      const merged = Object.assign(base, saved);
      delete merged.code;                 // 运行期字段，不恢复
      if (!Array.isArray(merged.rows) || !merged.rows.length) merged.rows = base.rows;
      return merged;
    } catch (e) {
      return base;                        // 存档损坏 → 回退默认
    }
  }

  /* 立即落盘（离散控件、change 事件、关闭页面时用这个）。
   * 先清掉可能挂着的节流定时器，保证「最后一次写入」不会被旧值覆盖。 */
  function saveParams() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    try {
      const out = JSON.parse(JSON.stringify(state.params));
      delete out.code;
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* 存储不可用则忽略 */ }
  }

  /* 拖动滑块时的节流落盘：localStorage 是同步写，一次拖动会触发几十次序列化，
   * 低端机上能感到卡顿；松手（change）时由 saveParams 立即补齐。 */
  function saveParamsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveParams, 300);
  }

  function clearSavedParams() {
    clearTimeout(saveTimer);              // 否则待写入的旧值会在「恢复默认」后又把存档写回去
    saveTimer = 0;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 状态 ---------------- */
  const state = {
    items: [],          // { id, file, url, thumb, img, name, base, date, code, w, h, range, shot }
    active: -1,
    params: loadSavedParams(),
    busy: false
  };

  const renderer = WM.createRenderer({
    logoUrl: (window.FREYA_LOGO_DATA_URL || ''),
    onLogoReady: () => scheduleRender()
  });

  /* ---------------- 基准宽度 ---------------- */
  // 参考图为 1773×2364（短边 1773），水印按短边等比缩放；
  // 长图/宽图则按「短边×1.15」做一点补偿，避免看起来过小。
  function baseOf(w, h) {
    const shortSide = Math.min(w, h);
    const longSide = Math.max(w, h);
    const ratio = longSide / shortSide;
    const compensation = ratio > 1.6 ? 1.15 : 1;
    return shortSide * compensation;
  }

  /* ---------------- EXIF 拍摄时间 ---------------- */
  function exifDate(buffer) {
    try {
      const view = new DataView(buffer);
      if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
      let offset = 2;
      while (offset + 4 < view.byteLength) {
        if (view.getUint8(offset) !== 0xff) { offset++; continue; }
        const marker = view.getUint8(offset + 1);
        const size = view.getUint16(offset + 2);
        if (marker === 0xe1) {
          const start = offset + 4;
          if (view.getUint32(start) !== 0x45786966) { offset += 2 + size; continue; }
          const tiff = start + 6;
          const little = view.getUint16(tiff) === 0x4949;
          const get16 = (o) => view.getUint16(o, little);
          const get32 = (o) => view.getUint32(o, little);
          const dirStart = tiff + get32(tiff + 4);
          const count = get16(dirStart);
          for (let i = 0; i < count; i++) {
            const entry = dirStart + 2 + i * 12;
            if (get16(entry) === 0x8769) { // ExifIFDPointer
              const sub = tiff + get32(entry + 8);
              const subCount = get16(sub);
              for (let j = 0; j < subCount; j++) {
                const e2 = sub + 2 + j * 12;
                const tag = get16(e2);
                if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) { // DateTimeOriginal / CreateDate / DateTime
                  const ptr = tiff + get32(e2 + 8);
                  let s = '';
                  for (let k = 0; k < 19; k++) s += String.fromCharCode(view.getUint8(ptr + k));
                  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
                  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
                }
              }
            }
          }
        }
        offset += 2 + size;
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /* ---------------- 图片导入 ---------------- */
  const MAX_DECODE_EDGE = 8192;

  function loadFile(file) {
    return new Promise((resolve) => {
      if (!/^image\//.test(file.type)) { resolve(null); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // 超大图（如 20000px 全景）在部分浏览器无法绘制，先降采样
        if (Math.max(img.naturalWidth, img.naturalHeight) <= MAX_DECODE_EDGE) {
          resolve({ img, url, thumb: makeThumb(img, THUMB_EDGE) });
          return;
        }
        const k = MAX_DECODE_EDGE / Math.max(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const thumb = makeThumb(c, THUMB_EDGE);
        const img2 = new Image();
        img2.onload = () => { URL.revokeObjectURL(url); resolve({ img: img2, url: img2.src, thumb }); };
        img2.onerror = () => resolve({ img, url, thumb });
        img2.src = c.toDataURL('image/jpeg', 0.95);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function addFiles(files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) { toast('没有可用的图片文件'); return; }

    setBusy(true, '正在读取图片…', 0);
    let added = 0;
    const fresh = [];                      // 本批新增的条目（时间段只贴到它们身上）
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const loaded = await loadFile(file);
      if (!loaded) continue;
      let date = null;
      try {
        const head = await file.slice(0, 256 * 1024).arrayBuffer();
        date = exifDate(head);
      } catch (e) { /* ignore */ }
      if (!date) date = new Date(file.lastModified || Date.now());

      const w = loaded.img.naturalWidth, h = loaded.img.naturalHeight;
      const item = {
        id: 'it' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        file, url: loaded.url, thumb: loaded.thumb || '', img: null, name: file.name,
        w, h, base: baseOf(w, h), date, range: null, shot: null,
        code: WM.randomCode(state.params.codeLen)
      };
      // 导入只做「量尺寸 + 出缩略图」，全分辨率位图不留在这里（见 ensureImage）
      loaded.img = null;
      state.items.push(item);
      fresh.push(item);
      added++;
      setBusy(true, `正在读取图片… ${i + 1}/${list.length}`, (i + 1) / list.length);
    }
    setBusy(false);

    if (added) {
      // 时间段：只按顺序贴给本批新增的图（不动队列里已有的），第 1 行 → 本批第 1 张，
      // 每张在自己的区间内随机取一个拍摄时间
      let ranged = 0;
      if (state.params.rangeAuto !== false) {
        const { slots } = parseRanges();
        if (slots.length) {
          assignRanges(fresh, slots.slice(0, fresh.length));
          ranged = fresh.filter((it) => it.range).length;
        }
      }
      if (state.active < 0) state.active = 0;
      syncQueue();
      scheduleRender();
      toast(`已导入 ${added} 张图片` + (ranged ? ` · 已分配 ${ranged} 个时间段（各自随机取一个时间点）` : ''));
    } else {
      toast('导入失败：不支持的文件格式');
    }
  }

  /* ---------------- 参数 ↔ 界面 ----------------
   * 「哪个控件对应哪个参数、怎么换算、默认值多少」全部登记在 src/params.js，
   * 这里只负责编排（读一次 → 刷新行块/映射清单 → 回显数字）。 */
  const CONTROL_IDS = P.CONTROLS.map((e) => e.id);
  const EXPORT_IDS = P.EXPORTS.map((e) => e.id);

  /* 让 <output> 数值「点一下就地编辑」——不新增任何元素，排版不会变。
   * 编辑时把 output 临时换成同尺寸的 input，提交后还原成 output（格式由 readUI 负责回填）。
   * 绑定方式：**从滑块出发找它自己的 output**（slider → parentElement → output）。
   * 不能用 out.closest('.ctl')：.ctl.grid2 里一个 .ctl 装两个滑块，
   * 那样右半边的数值会去改左边那个滑块（曾是个真 bug）。 */
  function bindOutputEditing() {
    document.querySelectorAll('input[type="range"]').forEach((slider) => {
      if (!slider.id || slider.dataset.editBound) return;
      const holder = slider.parentElement;          // 普通 .ctl，或 grid2 里的那个 cell
      if (!holder) return;
      const out = holder.querySelector('output');
      if (!out || out.dataset.editable) return;     // 只有带数值显示的滑块才可编辑
      slider.dataset.editBound = '1';
      out.dataset.editable = '1';
      out.title = '点击可直接输入数值';
      out.classList.add('editable');

      const commit = (raw, prevText) => {
        const v = parseFloat(String(raw).replace('%', '').trim());
        // 顺序很重要：先把这个 input 换回 <output>，再触发 input/change。
        // readUI 的回显走的是 getElementById，而编辑期间 output 是被 replaceWith 换下来的
        // 脱离文档节点 —— 那时查不到、回显被静默跳过，表现就是「滑块动了、数字还是旧的」。
        holder.querySelector('input.ctl-edit')?.replaceWith(out);
        if (isFinite(v)) {
          slider.value = String(v);            // 交给浏览器按 min/max/step 夹取
          // 触发既有链路：readUI 会把 output 文本重写成新值（含 % / 小数位格式）
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          out.textContent = prevText;          // 非法输入 → 还原成原文本
        }
        out.dataset.editing = '';
      };

      out.addEventListener('mousedown', (e) => e.preventDefault());  // 避免抢焦点
      out.addEventListener('click', () => {
        if (out.dataset.editing) return;
        out.dataset.editing = '1';
        const prevText = out.textContent;

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'ctl-edit';
        inp.value = String(prevText).replace('%', '');
        inp.style.width = Math.max(30, String(prevText).length * 8 + 14) + 'px';
        out.replaceWith(inp);                  // 原地同尺寸替换：label 长度不变、排版不动
        inp.focus();
        inp.select();

        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          commit(ok ? inp.value : null, prevText);
        };
        inp.addEventListener('blur', () => finish(true));
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
        });
      });
    });
  }

  /* ---------------- 行内容编辑器（可增删） ----------------
   * 行数是动态的：面板里的行块全部由这里创建，并直接持有各控件引用
   * （不再用固定的 r1/r2/r3 id，也不是写死三行）。 */
  const ROW_TYPE_OPTIONS = [
    ['datetime', '拍摄时间'],
    ['customdate', '自定义日期+随机时间'],
    ['date', '仅日期'],
    ['time', '仅时间'],
    ['text', '自定义文本']
  ];
  const ROW_TYPES_TIME = ['datetime', 'customdate', 'date', 'time'];
  const MAX_ROWS = 8;
  let rowEditors = [];

  function makeRowEditor(row) {
    const node = document.createElement('div');
    node.className = 'ctl field';
    const head = document.createElement('div');
    head.className = 'field-head';
    const title = document.createElement('label');
    const tools = document.createElement('span');
    tools.className = 'row-tools';
    const chkWrap = document.createElement('label');
    chkWrap.className = 'chk';
    const on = document.createElement('input');
    on.type = 'checkbox';
    const chkText = document.createElement('span');
    chkText.textContent = '显示';
    chkWrap.appendChild(on);
    chkWrap.appendChild(chkText);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-mini';
    del.textContent = '删除';
    tools.appendChild(chkWrap);
    tools.appendChild(del);
    head.appendChild(title);
    head.appendChild(tools);

    const grid = document.createElement('div');
    grid.className = 'grid2';
    const label = document.createElement('input');
    label.type = 'text';
    label.placeholder = '标签（如 拍摄时间:）';
    const type = document.createElement('select');
    ROW_TYPE_OPTIONS.forEach((pair) => {
      const opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = pair[1];
      type.appendChild(opt);
    });
    grid.appendChild(label);
    grid.appendChild(type);
    const text = document.createElement('textarea');
    text.rows = 1;
    text.spellcheck = false;
    text.placeholder = '内容';

    const quick = document.createElement('div');
    quick.className = 'row small';
    const nowBtn = document.createElement('button');
    nowBtn.type = 'button'; nowBtn.className = 'btn btn-mini'; nowBtn.textContent = '用当前时间';
    const fileBtn = document.createElement('button');
    fileBtn.type = 'button'; fileBtn.className = 'btn btn-mini'; fileBtn.textContent = '用图片时间';
    quick.appendChild(nowBtn);
    quick.appendChild(fileBtn);

    node.appendChild(head);
    node.appendChild(grid);
    node.appendChild(text);
    node.appendChild(quick);

    const el = { node, title, on, label, type, text, quick, nowBtn, fileBtn };
    el.on.checked = row.on !== false;
    el.label.value = row.label || '';
    el.type.value = row.type || 'text';
    el.text.value = row.text || '';
    [el.on, el.label, el.type, el.text].forEach((c) => {
      c.addEventListener('input', onRowEdit);
      c.addEventListener('change', onRowEdit);
    });
    del.onclick = () => removeRow(el);
    nowBtn.onclick = () => fillRow(el, new Date());
    fileBtn.onclick = () => {
      const item = state.items[state.active];
      fillRow(el, (item && item.date) || new Date());
    };
    return el;
  }

  function buildRowEditors() {
    if (!Array.isArray(state.params.rows) || !state.params.rows.length) {
      state.params.rows = [{ on: true, label: '拍摄时间:', type: 'datetime', text: '' }];
    }
    const box = $('rowsBox');
    box.innerHTML = '';
    rowEditors = state.params.rows.map((row) => {
      const el = makeRowEditor(row);
      box.appendChild(el.node);
      return el;
    });
    syncRowEditors();
  }

  /** 行块上的类型相关显示（第 n 行标题 / 显示开关变灰 / 占位文字 / 快捷按钮） */
  function syncRowEditors() {
    rowEditors.forEach((el, i) => {
      el.idx = i;
      el.title.textContent = '第 ' + (i + 1) + ' 行';
      el.node.classList.toggle('off', !el.on.checked);
      el.text.placeholder = el.type.value === 'customdate' ? '2026.08.19（日期）'
        : el.type.value === 'text' ? '内容，可留空' : '自动取图片时间（可留空）';
      el.quick.hidden = ROW_TYPES_TIME.indexOf(el.type.value) < 0;
    });
    $('rowHint').textContent = `共 ${rowEditors.length} 行（最多 ${MAX_ROWS} 行）`;
  }

  function onRowEdit() {
    readUI();
    scheduleRender();
    saveParams();
  }

  /** 快捷填时间：普通行写入完整时间并切成「自定义文本」；
   *  若当前是「自定义日期+随机时间」行，则只写日期、类型保持不变。 */
  function fillRow(el, d) {
    if (el.type.value === 'customdate') el.text.value = WM.formatDate(d, 'date');
    else { el.text.value = WM.formatDate(d, 'datetime'); el.type.value = 'text'; }
    el.text.dataset.manual = '1';
    onRowEdit();
  }

  function addRow() {
    if (rowEditors.length >= MAX_ROWS) { toast(`最多 ${MAX_ROWS} 行`); return; }
    state.params.rows.push({ on: true, label: '', type: 'text', text: '' });
    buildRowEditors();
    readUI();
    scheduleRender();
    saveParams();
    const last = rowEditors[rowEditors.length - 1];
    if (last && last.label.focus) last.label.focus();
    toast('已添加一行');
  }

  function removeRow(el) {
    const i = rowEditors.indexOf(el);
    if (i < 0) return;
    if (rowEditors.length <= 1) { toast('至少保留一行'); return; }
    state.params.rows.splice(i, 1);
    buildRowEditors();
    readUI();
    scheduleRender();
    saveParams();
    toast('已删除第 ' + (i + 1) + ' 行');
  }

  /* ---------------- 折叠卡 ---------------- */
  const cardHeads = Array.from(document.querySelectorAll('.card-h[data-card]'));

  function applyCards() {
    const closed = state.params.cardsClosed || [];
    cardHeads.forEach((h) => {
      const card = h.closest('.card');
      if (card) card.classList.toggle('closed', closed.indexOf(h.dataset.card) >= 0);
    });
  }

  function bindCards() {
    cardHeads.forEach((h) => {
      h.onclick = () => {
        const card = h.closest('.card');
        if (!card) return;
        const closed = !card.classList.contains('closed');
        card.classList.toggle('closed', closed);
        const list = state.params.cardsClosed || (state.params.cardsClosed = []);
        const i = list.indexOf(h.dataset.card);
        if (closed && i < 0) list.push(h.dataset.card);
        if (!closed && i >= 0) list.splice(i, 1);
        saveParams();
      };
    });
  }

  /* 读：声明表 → params（再加上动态行块）；回显数字、同步行块与映射清单 */
  function readUI() {
    const p = state.params;
    P.readAll(p, $);
    p.rows = rowEditors.map((el) => ({
      on: el.on.checked,
      label: el.label.value,
      type: el.type.value,
      text: el.text.value
    }));
    P.syncOutputs(p, $);
    syncRowEditors();        // 行块状态（显示开关 / 占位文字 / 快捷按钮）随类型变化
    syncRangeMap();          // 列表/勾选框变化后刷新映射清单与状态
  }

  /* 写：params → 控件（缺省值来自 DEFAULTS，经 params.js 同一套换算） */
  function writeUI() {
    const p = state.params;
    P.writeAll(p, $);
    buildRowEditors();               // 行数动态：按参数重建行块
    readUI();
    applyCards();
    document.querySelectorAll('#segPos button').forEach((b) => b.classList.toggle('active', b.dataset.pos === p.position));
  }


  /* ---------------- 行内容求值 ---------------- */
  /* 「自定义日期+随机时间」行：日期来自该行文本框（如 2026.08.19），
   * 时间来自区间内随机到的 item.shot；没写日期时退回区间自带日期 / 图片自身日期。 */
  function customRowDate(r, item) {
    return WM.normalizeDate(r.text) ||
      (item && item.range && item.range.date) ||
      null;
  }

  function rowsFor(item) {
    const p = state.params;
    return p.rows.map((r) => {
      let value = r.text;
      if (r.type === 'customdate') {
        value = WM.formatShot((item && item.date) || new Date(), 'datetime', item && item.shot, customRowDate(r, item));
      } else if (r.type === 'datetime' || r.type === 'date' || r.type === 'time') {
        // 分配了时间段时，datetime/time 行显示「日期 + 区间内随机到的时刻」；否则仍是单个时间
        value = WM.formatShot((item && item.date) || new Date(), r.type, item && item.shot,
          item && item.range && item.range.date);
      }
      return { on: r.on, label: r.label, value };
    });
  }

  /* ---------------- 时间段批量分配 ----------------
   * 「第 n 行 → 队列第 n 张」，一次拖入多张时各自在自己的区间里随机取一个拍摄时间。
   * 分配是**粘性快照**：只有「导入（自动分配开启时）」和「应用到队列」会写 item.range / item.shot，
   * 删图 / 改列表都不会隐式重排，也不会重新随机（随机点在 item.shot 上固定，预览与导出一致）。 */
  function parseRanges() {
    return WM.parseTimeRanges($('rangesText').value);
  }

  const sameRange = (r, s) => (!r && !s) ||
    !!(r && s && r.start === s.start && r.end === s.end && (r.date || null) === (s.date || null));

  /** 把 slots 按顺序贴到 list 上（缺位 = 该张不分配时间段）
   *  区间没变就保留原来的随机时间点，只有区间变了（或还没有）才重新随机 → 「应用」是幂等的。 */
  function assignRanges(list, slots, reroll) {
    list.forEach((it, i) => {
      const s = slots[i] || null;
      const keep = !reroll && sameRange(it.range, s);
      it.range = s ? { start: s.start, end: s.end, date: s.date } : null;
      if (!s) it.shot = null;
      else if (!keep || !it.shot) it.shot = WM.pickShotTime(s);
    });
  }

  /** 保持区间、只重新随机一次时间点 */
  function rerollShots() {
    let n = 0;
    state.items.forEach((it) => {
      if (it.range) { it.shot = WM.pickShotTime(it.range); n++; }
    });
    if (!n) { toast('还没有分配时间段（先在列表里写区间并「应用到队列」）'); return; }
    readUI();
    scheduleRender();
    toast(`已在各自区间内重新随机 ${n} 个拍摄时间`);
  }

  function applyRangesToQueue() {
    const { slots } = parseRanges();
    assignRanges(state.items, slots);
    readUI();                 // 顺带刷新状态文本与映射清单
    scheduleRender();
    const valid = slots.filter(Boolean).length;
    toast(valid ? `已按顺序分配 ${valid} 个时间段（各自随机取一个时间点）` : '已取消全部时间段（改用图片自身拍摄时间）');
  }

  /** 刷新映射清单：每张图一行，显示「区间 → 随机到的时间点」，并标出与列表不一致的行 */
  function syncRangeMap() {
    const box = $('rangeMap');
    const { slots, invalid } = parseRanges();
    box.innerHTML = '';
    state.items.forEach((it, i) => {
      const s = slots[i] || null;
      const row = document.createElement('div');
      row.className = 'ritem' + (!s ? ' none' : (sameRange(it.range, s) ? '' : ' pend'));
      const idx = document.createElement('i');
      idx.textContent = String(i + 1);
      const name = document.createElement('span');
      name.textContent = it.name;
      const val = document.createElement('b');
      if (it.range) {
        val.textContent = it.range.start + '-' + it.range.end + ' → ' + (it.shot || '—');
        val.title = '点击重新随机这张的时间';
        val.onclick = () => {
          it.shot = WM.pickShotTime(it.range);
          syncRangeMap();
          scheduleRender();
        };
      } else {
        val.textContent = '用图片时间';
      }
      row.appendChild(idx);
      row.appendChild(name);
      row.appendChild(val);
      box.appendChild(row);
    });

    const bits = [];
    const valid = slots.filter(Boolean).length;
    if (!valid && !invalid.length) {
      bits.push('未启用');
    } else {
      if (valid) bits.push(`${valid} 个时间段`);
      if (!state.items.length) bits.push('队列为空');
      else {
        const diff = state.items.filter((it, i) => !sameRange(it.range, slots[i] || null)).length;
        bits.push(diff ? `待更新 ${diff} 项` : '已与队列一致');
        if (slots.length > state.items.length) bits.push(`后 ${slots.length - state.items.length} 行未使用`);
      }
      if (invalid.length) bits.push(`第 ${invalid.map((x) => x.line).join('、')} 行无法识别`);
    }
    $('rangeStatus').textContent = bits.join(' · ');
  }

  /* ---------------- 预览 ---------------- */
  let renderTimer = 0;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 60);
  }

  const preview = $('preview');
  const pctx = preview.getContext('2d');

  /* 预览背板（canvas 像素）长边上限。
   * 以前直接把 canvas 建成原图尺寸：8192×8192 时约 268 MB，低配机/移动端直接分配失败，
   * 每次拖滑块还要重绘上千万像素。水印版式全部按「短边等比」推导，
   * 所以只要按显示尺寸建画板、再用 ctx.setTransform(k,…) 把坐标换回图片空间，
   * 视觉结果与导出完全一致，绘制成本却掉一个数量级。 */
  const PREVIEW_MAX_EDGE = 3200;

  /** 算 CSS 显示尺寸 + 背板缩放系数 k（背板像素 ÷ 图片像素） */
  function previewGeometry(item) {
    const wrap = $('canvasWrap');
    const availW = Math.max(80, (wrap.clientWidth || 0) - 36);
    const availH = Math.max(80, (wrap.clientHeight || 0) - 36);
    const fit = $('fitView').checked;
    let cssW, cssH;
    if (fit) {
      const f = Math.min(availW / item.w, availH / item.h, 1);
      cssW = item.w * f;
      cssH = item.h * f;
    } else {
      cssW = item.w;                       // 关掉「适应窗口」= 1:1 像素，超出容器就滚动
      cssH = item.h;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const backLong = Math.min(Math.round(Math.max(cssW, cssH) * dpr), PREVIEW_MAX_EDGE);
    return { cssW, cssH, k: Math.max(1e-4, backLong / Math.max(item.w, item.h)) };
  }

  /* 预览是异步的（可能要先解码原图），用一个自增序号丢弃过期结果：
   * 连续切图/拖滑块时，只有最后一次调用的结果会被画上去。 */
  let renderSeq = 0;

  async function renderPreview() {
    const seq = ++renderSeq;
    const item = state.items[state.active];
    if (!item) {
      preview.classList.remove('show');
      $('empty').hidden = false;
      $('imgMeta').textContent = '未导入图片';
      return;
    }
    $('empty').hidden = true;

    let img;
    try {
      img = await ensureImage(item);
    } catch (e) {
      if (seq !== renderSeq) return;
      preview.classList.remove('show');
      $('imgMeta').textContent = `无法解码这张图片：${item.name}`;
      return;
    }
    if (seq !== renderSeq) return;        // 期间又切图/改参数了，这次结果作废

    const p = state.params;

    const geo = previewGeometry(item);
    const bw = Math.max(1, Math.round(item.w * geo.k));
    const bh = Math.max(1, Math.round(item.h * geo.k));
    if (preview.width !== bw || preview.height !== bh) {
      preview.width = bw;
      preview.height = bh;
    }

    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, bw, bh);
    // 之后所有坐标仍用「图片坐标」：版式计算 / 水印定位一行都不用改
    pctx.setTransform(geo.k, 0, 0, geo.k, 0, 0);
    pctx.imageSmoothingEnabled = true;
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(img, 0, 0, item.w, item.h);

    const params = Object.assign({}, p, { code: codeFor(item) });
    renderer.draw(pctx, params, item.w, item.h, item.base, rowsFor(item));

    // CSS 尺寸与背板解耦：背板被限流时浏览器只会轻微缩放，不影响版式判断
    preview.style.maxWidth = 'none';
    preview.style.maxHeight = 'none';
    preview.style.width = Math.max(40, Math.round(geo.cssW)) + 'px';
    preview.style.height = 'auto';

    preview.classList.add('show');
    $('imgMeta').textContent = `${item.w} × ${item.h} · ${(item.file.size / 1024 / 1024).toFixed(2)} MB · ${item.name}` +
      (item.shot ? ` · 拍摄时间 ${item.shot}` + (item.range ? `（区间 ${item.range.start}-${item.range.end}）` : '') : '');
  }

  /* ---------------- 队列 UI ---------------- */
  function syncQueue() {
    const box = $('thumbs');
    box.innerHTML = '';
    state.items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = 'thumb' + (i === state.active ? ' active' : '');
      d.title = it.name;
      const im = document.createElement('img');
      im.src = it.thumb || it.url;       // 优先用 96px 缩略图，别让浏览器解码原图
      im.alt = it.name;
      d.appendChild(im);
      const x = document.createElement('button');
      x.className = 'x';
      x.textContent = '×';
      x.title = '移除';
      x.onclick = (e) => { e.stopPropagation(); removeItem(i); };
      d.appendChild(x);
      d.onclick = () => { state.active = i; syncQueue(); scheduleRender(); };
      box.appendChild(d);
    });

    const n = state.items.length;
    $('queueInfo').textContent = n ? `队列：${n} 张（点击缩略图切换）` : '队列为空';
    $('btnExportZip').disabled = n === 0 || state.busy;
    $('btnExportOne').disabled = n === 0 || state.busy;
    syncRangeMap();          // 队列变化（增/删/清空）后同步时间段映射清单
  }

  /* 只有 blob: 的 URL 才需要释放（超大图降采样后 url 是 data:，revoke 无效） */
  const releaseUrl = (u) => { if (u && /^blob:/.test(u)) URL.revokeObjectURL(u); };

  function removeItem(i) {
    const it = state.items[i];
    if (!it) return;
    releaseUrl(it.url);
    IMG.release(it);
    state.items.splice(i, 1);
    // 删掉的是当前图**之前**的项时，索引必须一起前移，
    // 否则 active 指向的会变成原来那张的下一张 —— 表现为「删别人的图，预览却换图了」。
    if (i < state.active) state.active--;
    if (state.active >= state.items.length) state.active = state.items.length - 1;
    if (state.active < 0) state.active = -1;
    syncQueue();
    scheduleRender();
  }

  function clearQueue() {
    state.items.forEach((it) => releaseUrl(it.url));
    IMG.clear();
    state.items = [];
    state.active = -1;
    syncQueue();
    scheduleRender();
  }

  /* ---------------- 导出 ---------------- */
  function targetSize(item, maxEdge) {
    if (!maxEdge || maxEdge <= 0) return { w: item.w, h: item.h, scaled: false };
    const long = Math.max(item.w, item.h);
    if (long <= maxEdge) return { w: item.w, h: item.h, scaled: false };
    const k = maxEdge / long;
    return { w: Math.round(item.w * k), h: Math.round(item.h * k), scaled: true };
  }

  /* 单张渲染到新画布；超大图可能超出画布上限，返回 null。
   * img 由调用方先 ensureImage 拿到（这里不碰网络/解码，方便失败时单独计数）。 */
  function renderToCanvas(item, img, code, maxEdge) {
    const t = targetSize(item, maxEdge);
    let c, ctx;
    try {
      c = document.createElement('canvas');
      c.width = t.w;
      c.height = t.h;
      ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, t.w, t.h);
      const base = t.scaled ? baseOf(t.w, t.h) : item.base;
      const params = Object.assign({}, state.params, { code });
      renderer.draw(ctx, params, t.w, t.h, base, rowsFor(item));
    } catch (e) {
      console.warn('渲染失败', item.name, e);
      if (c) { c.width = c.height = 0; }
      return null;
    }
    return c;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob((b) => resolve(b), type, quality);
      else {
        const url = canvas.toDataURL(type, quality);
        const bin = atob(url.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type }));
      }
    });
  }

  /* 文件名规则在 src/naming.js（纯函数），这里直接用顶部的别名 */

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* 一图一码：码固定存在 item.code 上，预览、导出、文件名里的 {code} 用同一个值。
   * 这样「预览看到的码 = 下载下来的码」，同一张图重导（或换格式再导）码也不变。
   * 只有位数被改过、或用户点「重新随机防伪码」时才会换新码。 */
  function codeFor(item) {
    const len = Math.max(1, Math.min(64, state.params.codeLen | 0));
    if (!item.code || item.code.length !== len) item.code = WM.randomCode(len);
    return item.code;
  }

  /** 给队列里（或指定的）全部图片重随机防伪码 */
  function rerollCodes(list) {
    const len = Math.max(1, Math.min(64, state.params.codeLen | 0));
    (list || state.items).forEach((it) => { it.code = WM.randomCode(len); });
  }

  async function exportOne() {
    const item = state.items[state.active];
    if (!item || state.busy) return;
    setBusy(true, '正在生成…', 0.4);
    await nextFrame();
    const type = $('format').value;
    const quality = (+$('quality').value) / 100;
    const maxEdge = +$('maxEdge').value || 0;
    const code = codeFor(item);          // 与预览同一个码
    let img;
    try { img = await ensureImage(item); }
    catch (e) { setBusy(false); toast('导出失败：这张图片无法解码'); return; }
    const canvas = renderToCanvas(item, img, code, maxEdge);
    if (!canvas) { setBusy(false); toast('导出失败：图片过大，超出浏览器画布上限（可设置「长边最大像素」后重试）'); return; }
    const blob = await canvasToBlob(canvas, type, quality);
    if (!blob) { setBusy(false); toast('导出失败：浏览器不支持该格式'); return; }
    const name = buildName($('nameTpl').value, item, code, 0, canvas.width, canvas.height) + '.' + extFor(type);
    canvas.width = canvas.height = 0;
    download(blob, name);
    setBusy(false);
    toast('已导出：' + name);
  }

  async function exportZip() {
    if (!state.items.length || state.busy) return;
    const type = $('format').value;
    const quality = (+$('quality').value) / 100;
    const maxEdge = +$('maxEdge').value || 0;
    const tpl = $('nameTpl').value;
    const ext = extFor(type);

    const entries = [];
    const used = new Set();
    let skipped = 0;

    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      setBusy(true, `正在渲染 ${i + 1}/${state.items.length}…`, i / state.items.length);
      await nextFrame();
      const code = codeFor(item);        // 每张图自己的码（预览里看到的就是这个）
      let img;
      try { img = await ensureImage(item); } catch (e) { skipped++; continue; }
      const canvas = renderToCanvas(item, img, code, maxEdge);
      if (!canvas) { skipped++; continue; }
      const blob = await canvasToBlob(canvas, type, quality);
      if (!blob) { skipped++; canvas.width = canvas.height = 0; continue; }
      let name = buildName(tpl, item, code, i, canvas.width, canvas.height) + '.' + ext;
      let n = 1;
      while (used.has(name)) name = buildName(tpl, item, code, i, canvas.width, canvas.height) + '_' + (n++) + '.' + ext;
      used.add(name);
      entries.push({ name, data: blob });
      canvas.width = canvas.height = 0;
    }

    if (!entries.length) { setBusy(false); toast('没有可导出的图片'); return; }

    setBusy(true, '正在打包 ZIP…', 1);
    await nextFrame();
    const zip = await Zip.createZip(entries);
    const stamp = new Date();
    const p2 = (n) => (n < 10 ? '0' + n : '' + n);
    download(zip, `watermark_${stamp.getFullYear()}${p2(stamp.getMonth() + 1)}${p2(stamp.getDate())}_${p2(stamp.getHours())}${p2(stamp.getMinutes())}.zip`);
    setBusy(false);
    toast(`已打包 ${entries.length} 张图片（${(zip.size / 1024 / 1024).toFixed(2)} MB）` +
      (skipped ? `，${skipped} 张过大已跳过` : ''));
  }

  /* ---------------- 进度 / 提示 ---------------- */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; }, 250);
    }, 2600);
  }

  function setBusy(busy, text, ratio) {
    state.busy = busy;
    const box = $('progress');
    box.hidden = !busy;
    if (text) $('progressText').textContent = text;
    if (typeof ratio === 'number') $('progressBar').style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
    $('btnExportZip').disabled = busy || state.items.length === 0;
    $('btnExportOne').disabled = busy || state.items.length === 0;
    $('btnAdd').disabled = busy;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 导入
    $('drop').onclick = () => $('fileInput').click();
    $('btnAdd').onclick = () => $('fileInput').click();
    $('fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };

    ['dragenter', 'dragover'].forEach((ev) => {
      document.addEventListener(ev, (e) => {
        e.preventDefault();
        $('drop').classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      document.addEventListener(ev, (e) => {
        e.preventDefault();
        if (ev === 'dragleave' && e.relatedTarget) return;
        $('drop').classList.remove('over');
      });
    });
    document.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) addFiles(items);
    });

    // 位置（segPos）
    document.querySelectorAll('#segPos button').forEach((b) => {
      b.onclick = () => {
        state.params.position = b.dataset.pos;
        document.querySelectorAll('#segPos button').forEach((x) => x.classList.toggle('active', x === b));
        scheduleRender();
        saveParams();
      };
    });

    // 参数控件（改动即持久化）
    // 滑块 input 高频触发 → 节流落盘；文本框/下拉/勾选等离散控件 → 立即落盘。
    // change（松手、失焦）一律立即落盘，保证最后一次改动不丢。
    const bindPersist = (id) => {
      const el = $(id);
      if (!el) return;
      const isSlider = el.type === 'range';
      el.addEventListener('input', () => {
        readUI(); scheduleRender();
        if (isSlider) saveParamsSoon(); else saveParams();
      });
      el.addEventListener('change', () => { readUI(); scheduleRender(); saveParams(); });
    };
    CONTROL_IDS.forEach(bindPersist);
    // 导出 / 视图设置也持久化（不需要重绘，只入库）
    EXPORT_IDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      const isSlider = el.type === 'range';
      el.addEventListener('input', () => { readUI(); if (isSlider) saveParamsSoon(); else saveParams(); });
      el.addEventListener('change', () => { readUI(); saveParams(); });
    });
    // 行内容：行块里的控件在创建时就绑好了事件（makeRowEditor → onRowEdit）
    $('btnAddRow').onclick = () => addRow();

    // 折叠卡（状态持久化）
    bindCards();

    // 队列
    $('btnClear').onclick = () => { clearQueue(); toast('已清空队列'); };
    // 「适应窗口」由 EXPORT_IDS 统一读写参数，这里只补一次重绘（缩略图/背板尺寸要重算）
    $('fitView').onchange = () => scheduleRender();
    window.addEventListener('resize', () => scheduleRender());

    // 时间段：应用到队列 / 重新随机 / 清空（清空 = 清空列表 + 取消全部分配）
    $('btnApplyRanges').onclick = () => applyRangesToQueue();
    $('btnRerollShots').onclick = () => rerollShots();
    $('btnClearRanges').onclick = () => {
      $('rangesText').value = '';
      readUI();
      assignRanges(state.items, []);
      syncRangeMap();
      scheduleRender();
      saveParams();
      toast('已清空时间段列表，所有图片改用自身拍摄时间');
    };

    // 导出
    $('btnExportOne').onclick = exportOne;
    $('btnExportZip').onclick = exportZip;

    // 防伪码：一图一码且固定，这里给一个整批重掷的入口
    $('btnRerollCodes').onclick = () => {
      if (!state.items.length) { toast('队列为空，先导入图片'); return; }
      rerollCodes();
      scheduleRender();
      toast(`已为 ${state.items.length} 张图片重新生成防伪码`);
    };
    // 位数改了 → 立刻整批按新长度重生成（否则要等每张图被重绘才更新）
    $('codeLen').addEventListener('change', () => { rerollCodes(); scheduleRender(); });

    // 恢复默认
    $('btnReset').onclick = () => {
      state.params = JSON.parse(JSON.stringify(WM.DEFAULTS));
      clearSavedParams();                 // 同时清掉存档，刷新后也是默认值
      writeUI();
      scheduleRender();
      toast('已恢复默认参数');
    };

    // 输出格式 → 质量可用性
    $('format').onchange = () => {
      const lossy = $('format').value !== 'image/png';
      $('quality').disabled = !lossy;
      $('quality').closest('.ctl').classList.toggle('off', !lossy);
    };
    $('quality').closest('.ctl').classList.toggle('off', $('format').value === 'image/png');

    // 快捷键：Ctrl/⌘+S 导出；Delete 移除当前；方向键微调边距
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.items.length > 1) exportZip(); else exportOne();
        return;
      }
      if (e.target !== document.body) return;
      if (e.key === 'Delete' && state.active >= 0) { removeItem(state.active); return; }
      const step = e.shiftKey ? 1 : 0.2;
      let used = true;
      if (e.key === 'ArrowLeft') state.params.marginX = Math.max(0, state.params.marginX - step);
      else if (e.key === 'ArrowRight') state.params.marginX = Math.min(40, state.params.marginX + step);
      else if (e.key === 'ArrowUp') state.params.marginY = Math.max(0, state.params.marginY - step);
      else if (e.key === 'ArrowDown') state.params.marginY = Math.min(40, state.params.marginY + step);
      else used = false;
      if (used) { e.preventDefault(); writeUI(); scheduleRender(); saveParams(); }
    });
  }

  /* ---------------- 启动 ----------------
   * 顺序很重要：必须先把（可能是存档恢复的）参数写进控件，再读回来，
   * 否则 readUI() 会把 HTML 里的默认值覆盖掉刚恢复的存档。 */
  writeUI();
  readUI();
  bindOutputEditing();   // 让 output 数值可点击就地编辑
  syncQueue();
  bind();
  window.addEventListener('beforeunload', () => {
    state.items.forEach((it) => releaseUrl(it.url));
    saveParams();                        // 关闭页面前落盘（内含清掉挂着的节流定时器）
  });

  // 方便调试
  window.__freya = state;
})();
