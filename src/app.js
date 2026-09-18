/* =========================================================================
 * app.js — 界面逻辑：导入 / 参数 / 预览 / 批量导出
 * ========================================================================= */
(function () {
  'use strict';

  const WM = window.FreyaWM;
  const Zip = window.FreyaZip;
  if (!WM || !Zip) { console.error('依赖脚本未加载'); return; }

  const $ = (id) => document.getElementById(id);

  /* ---------------- 参数持久化（localStorage） ----------------
   * 只持久化「参数」，不持久化图片队列；code 是每张导出时随机生成的，不入库。
   * 隐私模式/禁用存储时 localStorage 会抛异常，全部包 try/catch 静默降级。 */
  const STORE_KEY = 'freya-watermark.params.v1';

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

  function saveParams() {
    try {
      const out = JSON.parse(JSON.stringify(state.params));
      delete out.code;
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* 存储不可用则忽略 */ }
  }

  function clearSavedParams() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 状态 ---------------- */
  const state = {
    items: [],          // { id, file, url, img, name, base, date, code, w, h }
    active: -1,
    previewCode: WM.randomCode(WM.DEFAULTS.codeLen),
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
          resolve({ img, url });
          return;
        }
        const k = MAX_DECODE_EDGE / Math.max(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const img2 = new Image();
        img2.onload = () => { URL.revokeObjectURL(url); resolve({ img: img2, url: img2.src }); };
        img2.onerror = () => resolve({ img, url });
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
      state.items.push({
        id: 'it' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        file, url: loaded.url, img: loaded.img, name: file.name,
        w, h, base: baseOf(w, h), date,
        code: WM.randomCode(state.params.codeLen)
      });
      added++;
      setBusy(true, `正在读取图片… ${i + 1}/${list.length}`, (i + 1) / list.length);
    }
    setBusy(false);

    if (added) {
      if (state.active < 0) state.active = 0;
      syncQueue();
      scheduleRender();
      toast(`已导入 ${added} 张图片`);
    } else {
      toast('导入失败：不支持的文件格式');
    }
  }

  /* ---------------- 参数 ↔ 界面 ---------------- */
  const CONTROL_IDS = ['scale', 'marginX', 'marginY', 'opacity', 'tableOpacity', 'title', 'titleLS', 'bodyLS',
    'labelLS', 'valueGapRatio', 'titleFontScale', 'titleHeightScale', 'titleLineHeightRatio', 'headerPadRatio',
    'labelW', 'accent', 'dotColor', 'bgColor', 'textColor', 'fontFamily', 'radius', 'shadow',
    'showTable', 'showLogo', 'logoScale', 'showCode', 'codeLen', 'codeLabel', 'codeSize'];

  /* 导出/视图设置：也纳入持久化（面板上「全部数据」都要存） */
  const EXPORT_IDS = ['format', 'quality', 'nameTpl', 'maxEdge', 'fitView'];

  /* 让已有的 <output> 数值「点一下就地编辑」——不新增任何元素，排版不会变。
   * 编辑时把 output 临时换成同尺寸的 input，提交后还原成 output（格式由 readUI 负责回填）。
   * 取值范围来自同一个 .ctl 里的滑块，超范围自动夹取。 */
  function bindOutputEditing() {
    document.querySelectorAll('output').forEach((out) => {
      if (out.dataset.editable) return;
      const ctl = out.closest('.ctl');
      const slider = ctl && ctl.querySelector('input[type="range"]');
      if (!slider || !slider.id) return;      // 只有绑定到滑块的 output 才可编辑
      out.dataset.editable = '1';
      out.title = '点击可直接输入数值';
      out.classList.add('editable');

      const commit = (raw, prevText) => {
        const v = parseFloat(String(raw).replace('%', '').trim());
        if (isFinite(v)) {
          slider.value = String(v);            // 交给浏览器按 min/max/step 夹取
          // 触发既有链路：readUI 会把 output 文本重写成新值（含 % / 小数位格式）
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
          ctl.querySelector('input.ctl-edit')?.replaceWith(out);
        } else {
          ctl.querySelector('input.ctl-edit')?.replaceWith(out);
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

  const ROW_IDS = [1, 2, 3].map((i) => ({
    on: 'r' + i + 'on', label: 'r' + i + 'label', type: 'r' + i + 'type', text: 'r' + i + 'text', idx: i - 1
  }));

  function readUI() {
    const p = state.params;
    p.scale = +$('scale').value / 100;
    p.marginX = +$('marginX').value;
    p.marginY = +$('marginY').value;
    p.opacity = +$('opacity').value / 100;
    p.tableOpacity = +$('tableOpacity').value / 100;
    p.title = $('title').value;
    p.titleLS = +$('titleLS').value;
    p.bodyLS = +$('bodyLS').value;
    p.labelLS = +$('labelLS').value;
    p.valueGapRatio = +$('valueGapRatio').value;
    p.titleFontScale = +$('titleFontScale').value / 100;
    p.titleHeightScale = +$('titleHeightScale').value / 100;
    p.titleLineHeightRatio = +$('titleLineHeightRatio').value;
    p.headerPadRatio = +$('headerPadRatio').value / 100;
    p.labelW = +$('labelW').value / 100;    p.accent = $('accent').value;
    p.dotColor = $('dotColor').value;
    p.bgColor = $('bgColor').value;
    p.textColor = $('textColor').value;
    p.fontFamily = $('fontFamily').value;
    p.radius = +$('radius').value / 1000;
    p.shadow = +$('shadow').value / 100;
    p.showTable = $('showTable').checked;
    p.showLogo = $('showLogo').checked;
    p.logoScale = +$('logoScale').value / 100;
    p.showCode = $('showCode').checked;
    p.codeLen = Math.max(1, +$('codeLen').value || 10);
    p.codeLabel = $('codeLabel').value;
    p.codeSize = +$('codeSize').value / 100;

    p.rows = ROW_IDS.map((r) => ({
      on: $(r.on).checked,
      label: $(r.label).value,
      type: $(r.type).value,
      text: $(r.text).value
    }));

    // 导出 / 视图设置（同样持久化）
    p.format = $('format').value;
    p.quality = +$('quality').value;
    p.nameTpl = $('nameTpl').value;
    p.maxEdge = +$('maxEdge').value || 0;
    p.fitView = $('fitView').checked;

    // 数值回显
    $('outScale').textContent = $('scale').value + '%';
    $('outMarginX').textContent = (+$('marginX').value).toFixed(1) + '%';
    $('outMarginY').textContent = (+$('marginY').value).toFixed(1) + '%';
    $('outOpacity').textContent = $('opacity').value + '%';
    $('outTableOpacity').textContent = $('tableOpacity').value + '%';
    $('outLabelW').textContent = $('labelW').value + '%';
    $('outTitleLS').textContent = (+$('titleLS').value).toFixed(2);
    $('outBodyLS').textContent = (+$('bodyLS').value).toFixed(2);
    $('outLabelLS').textContent = (+$('labelLS').value).toFixed(2);
    $('outValueGap').textContent = (+$('valueGapRatio').value).toFixed(2);
    $('outTitleScale').textContent = $('titleFontScale').value + '%';
    $('outTitleHeight').textContent = $('titleHeightScale').value + '%';
    $('outTitleLineH').textContent = (+$('titleLineHeightRatio').value).toFixed(2);
    $('outHeaderPad').textContent = $('headerPadRatio').value + '%';
    $('outRadius').textContent = $('radius').value;
    $('outShadow').textContent = $('shadow').value + '%';
    $('outLogoScale').textContent = $('logoScale').value + '%';
    $('outCodeSize').textContent = $('codeSize').value + '%';
    $('outQuality').textContent = $('quality').value + '%';

    ROW_IDS.forEach((r) => {
      const off = !$(r.on).checked;
      $(r.on).closest('.field').classList.toggle('off', off);
    });
  }

  function writeUI() {
    const p = state.params;
    $('scale').value = Math.round(p.scale * 100);
    $('marginX').value = p.marginX;
    $('marginY').value = p.marginY;
    $('opacity').value = Math.round(p.opacity * 100);
    $('tableOpacity').value = Math.round((p.tableOpacity == null ? 1 : p.tableOpacity) * 100);
    $('title').value = p.title;
    $('titleLS').value = p.titleLS;
    $('bodyLS').value = p.bodyLS;
    $('labelLS').value = p.labelLS == null ? 0.185 : p.labelLS;
    $('valueGapRatio').value = p.valueGapRatio == null ? 0.2 : p.valueGapRatio;
    $('titleFontScale').value = Math.round((p.titleFontScale == null ? 1 : p.titleFontScale) * 100);
    $('titleHeightScale').value = Math.round((p.titleHeightScale == null ? 1 : p.titleHeightScale) * 100);
    $('titleLineHeightRatio').value = p.titleLineHeightRatio == null ? 1.5 : p.titleLineHeightRatio;
    $('headerPadRatio').value = Math.round((p.headerPadRatio == null ? 1.8 : p.headerPadRatio) * 100);
    $('labelW').value = Math.round((p.labelW == null ? 1 : p.labelW) * 100);
    $('accent').value = p.accent;
    $('dotColor').value = p.dotColor;
    $('bgColor').value = p.bgColor;
    $('textColor').value = p.textColor;
    $('fontFamily').value = p.fontFamily;
    $('radius').value = Math.round(p.radius * 1000);
    $('shadow').value = Math.round(p.shadow * 100);
    $('showTable').checked = p.showTable;
    $('showLogo').checked = p.showLogo;
    $('logoScale').value = Math.round(p.logoScale * 100);
    $('showCode').checked = p.showCode;
    $('codeLen').value = p.codeLen;
    $('codeLabel').value = p.codeLabel;
    $('codeSize').value = p.codeSize * 100;
    ROW_IDS.forEach((r) => {
      const row = p.rows[r.idx] || {};
      $(r.on).checked = row.on !== false;
      $(r.label).value = row.label || '';
      $(r.type).value = row.type || 'text';
      $(r.text).value = row.text || '';
    });
    // 导出 / 视图设置（缺省时回落到 HTML 初值）
    if (p.format != null) $('format').value = p.format;
    if (p.quality != null) $('quality').value = p.quality;
    if (p.nameTpl != null) $('nameTpl').value = p.nameTpl;
    if (p.maxEdge != null) $('maxEdge').value = p.maxEdge;
    if (p.fitView != null) $('fitView').checked = !!p.fitView;
    readUI();
    document.querySelectorAll('#segPos button').forEach((b) => b.classList.toggle('active', b.dataset.pos === p.position));
  }

  /* ---------------- 行内容求值 ---------------- */
  function rowsFor(item) {
    const p = state.params;
    return p.rows.map((r) => {
      let value = r.text;
      if (r.type === 'datetime' || r.type === 'date' || r.type === 'time') {
        value = WM.formatDate((item && item.date) || new Date(), r.type);
      }
      return { on: r.on, label: r.label, value };
    });
  }

  /* ---------------- 预览 ---------------- */
  let renderTimer = 0;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPreview, 60);
  }

  const preview = $('preview');
  const pctx = preview.getContext('2d');
  let previewScale = 1;

  function renderPreview() {
    const item = state.items[state.active];
    if (!item) {
      preview.classList.remove('show');
      $('empty').hidden = false;
      $('imgMeta').textContent = '未导入图片';
      return;
    }
    $('empty').hidden = true;

    const p = state.params;
    const previewCode = state.previewCode;

    // 画布始终按原图分辨率绘制（所见即所得），用 CSS 缩放显示
    if (preview.width !== item.w || preview.height !== item.h) {
      preview.width = item.w;
      preview.height = item.h;
      previewScale = 1;
    }

    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, item.w, item.h);
    pctx.drawImage(item.img, 0, 0, item.w, item.h);

    const params = Object.assign({}, p, { code: previewCode });
    renderer.draw(pctx, params, item.w, item.h, item.base, rowsFor(item));

    preview.classList.add('show');
    applyFit();
    $('imgMeta').textContent = `${item.w} × ${item.h} · ${(item.file.size / 1024 / 1024).toFixed(2)} MB · ${item.name}`;
  }

  function applyFit() {
    if (!$('fitView').checked) {
      preview.style.maxWidth = 'none';
      preview.style.maxHeight = 'none';
      preview.style.width = 'auto';
      preview.style.height = 'auto';
      return;
    }
    const wrap = $('canvasWrap');
    const availW = wrap.clientWidth - 36;
    const availH = wrap.clientHeight - 36;
    const item = state.items[state.active];
    if (!item) return;
    const k = Math.min(availW / item.w, availH / item.h, 1);
    preview.style.maxWidth = 'none';
    preview.style.maxHeight = 'none';
    preview.style.width = Math.max(40, Math.round(item.w * k)) + 'px';
    preview.style.height = 'auto';
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
      im.src = it.url;
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
  }

  function removeItem(i) {
    const it = state.items[i];
    if (it) URL.revokeObjectURL(it.url);
    state.items.splice(i, 1);
    if (state.active >= state.items.length) state.active = state.items.length - 1;
    syncQueue();
    scheduleRender();
  }

  function clearQueue() {
    state.items.forEach((it) => URL.revokeObjectURL(it.url));
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

  /* 单张渲染到新画布；超大图可能超出画布上限，返回 null */
  function renderToCanvas(item, code, maxEdge) {
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
      ctx.drawImage(item.img, 0, 0, t.w, t.h);
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

  function extFor(type) {
    if (type === 'image/png') return 'png';
    if (type === 'image/webp') return 'webp';
    return 'jpg';
  }

  function safeName(s) {
    return String(s).replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80) || 'image';
  }

  function buildName(tpl, item, code, i, w, h) {
    const d = item.date || new Date();
    const p2 = (n) => (n < 10 ? '0' + n : '' + n);
    const out = String(tpl || '{name}_watermark')
      .replace(/\{name\}/g, safeName(item.name))
      .replace(/\{date\}/g, `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`)
      .replace(/\{time\}/g, `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`)
      .replace(/\{code\}/g, code)
      .replace(/\{i\}/g, String(i + 1))
      .replace(/\{w\}/g, String(w))
      .replace(/\{h\}/g, String(h));
    return (out.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'image');
  }

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

  async function exportOne() {
    const item = state.items[state.active];
    if (!item || state.busy) return;
    setBusy(true, '正在生成…', 0.4);
    await nextFrame();
    const type = $('format').value;
    const quality = (+$('quality').value) / 100;
    const maxEdge = +$('maxEdge').value || 0;
    const code = WM.randomCode(state.params.codeLen);
    const canvas = renderToCanvas(item, code, maxEdge);
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
      const code = WM.randomCode(state.params.codeLen);
      const canvas = renderToCanvas(item, code, maxEdge);
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
    CONTROL_IDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', () => { readUI(); scheduleRender(); saveParams(); });
      el.addEventListener('change', () => { readUI(); scheduleRender(); saveParams(); });
    });
    // 导出 / 视图设置也持久化
    EXPORT_IDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => { readUI(); saveParams(); });
      el.addEventListener('input', () => { readUI(); saveParams(); });
    });
    ROW_IDS.forEach((r) => {
      [r.on, r.label, r.type, r.text].forEach((id) => {
        const el = $(id);
        el.addEventListener('input', () => { readUI(); scheduleRender(); saveParams(); });
        el.addEventListener('change', () => { readUI(); scheduleRender(); saveParams(); });
      });
    });

    // 快捷按钮（会改写行内容 → 一并持久化）
    document.querySelectorAll('[data-now]').forEach((b) => {
      b.onclick = () => {
        const t = $(b.dataset.now);
        t.value = WM.formatDate(new Date(), 'datetime');
        t.dataset.manual = '1';
        $(b.dataset.now.replace('text', 'type')).value = 'text';
        readUI(); scheduleRender(); saveParams();
      };
    });
    document.querySelectorAll('[data-filetime]').forEach((b) => {
      b.onclick = () => {
        const item = state.items[state.active];
        const d = (item && item.date) || new Date();
        $(b.dataset.filetime).value = WM.formatDate(d, 'datetime');
        $(b.dataset.filetime.replace('text', 'type')).value = 'text';
        readUI(); scheduleRender(); saveParams();
      };
    });

    // 队列
    $('btnClear').onclick = () => { clearQueue(); toast('已清空队列'); };
    $('fitView').onchange = applyFit;
    window.addEventListener('resize', () => applyFit());

    // 导出
    $('btnExportOne').onclick = exportOne;
    $('btnExportZip').onclick = exportZip;

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
    state.items.forEach((it) => URL.revokeObjectURL(it.url));
    saveParams();                        // 关闭页面前落盘
  });

  // 方便调试
  window.__freya = state;
})();
