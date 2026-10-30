/* =========================================================================
 * zip.js — 极简 ZIP 打包器（零依赖）
 * 只使用 STORE（不压缩）方式；JPEG/PNG 本身已压缩，再 deflate 收益极小。
 * 生成标准 ZIP：Local File Header + Central Directory + EOCD，
 * 文件名以 UTF-8 编码并置 bit 11 标志，Windows / macOS 均可正常解压。
 *
 * 内存策略：条目数据可以是 Blob，Blob **不会被转成 Uint8Array**：
 *   1) CRC 用 slice 分块流式计算（每块 4MB，算完即丢）；
 *   2) 原始 Blob 直接作为 `new Blob([...])` 的一部分（按引用拼接，不复制内容）。
 * 以前把所有条目都 arrayBuffer() 成一个 Uint8Array 再拼 Blob，峰值是数据量的两倍：
 * 50 张 8MB 的图 ≈ 400MB 数据 → 峰值接近 800MB。
 * ========================================================================= */
(function (global) {
  'use strict';

  const MAX_ENTRIES = 0xffff;          // 无 ZIP64 时条目数上限
  const MAX_U32 = 0xffffffff;          // 无 ZIP64 时单个尺寸/总偏移上限

  /* ---------------- CRC-32 ---------------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** 增量 CRC：c 传上一块的中间值（首块传 0xffffffff），返回新的中间值 */
  function crcUpdate(c, bytes) {
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return c;
  }

  /** 分块读 Blob 算 CRC，全程只占一个 chunk 的内存 */
  async function crc32OfBlob(blob) {
    const CHUNK = 4 * 1024 * 1024;
    let c = 0xffffffff;
    for (let pos = 0; pos < blob.size; pos += CHUNK) {
      const part = blob.slice(pos, Math.min(pos + CHUNK, blob.size));
      c = crcUpdate(c, new Uint8Array(await part.arrayBuffer()));
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------------- 字节写入工具 ---------------- */
  function u16(v) { return [v & 0xff, (v >>> 8) & 0xff]; }
  function u32(v) { return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]; }

  function dosDateTime(d) {
    const year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new TypeError('unsupported entry data');
  }

  const isBlob = (d) => typeof Blob !== 'undefined' && d instanceof Blob;

  /**
   * 创建 ZIP。
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|Blob|string}>} entries
   * @returns {Promise<Blob>}
   */
  async function createZip(entries) {
    if (entries.length > MAX_ENTRIES) {
      throw new Error(`ZIP 条目过多（${entries.length} > ${MAX_ENTRIES}），请分批导出`);
    }

    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dt = dosDateTime(now);

    for (const e of entries) {
      const blob = isBlob(e.data) ? e.data : null;
      const bytes = blob ? null : toBytes(e.data);

      const nameBytes = new TextEncoder().encode(e.name);
      const size = blob ? blob.size : bytes.length;
      if (size > MAX_U32) throw new Error(`单个文件超过 4GB（不支持 ZIP64）：${e.name}`);

      // Blob 走分块 CRC（不落地整块内存）；其它类型直接算
      const crc = blob ? await crc32OfBlob(blob) : crc32(bytes);

      const local = new Uint8Array(30 + nameBytes.length);
      let p = 0;
      const put = (arr) => { for (const b of arr) local[p++] = b; };
      put(u32(0x04034b50));        // local file header signature
      put(u16(20));                // version needed
      put(u16(0x0800));            // flags: UTF-8 filename
      put(u16(0));                 // method: store
      put(u16(dt.time));
      put(u16(dt.date));
      put(u32(crc));
      put(u32(size));              // compressed size
      put(u32(size));              // uncompressed size
      put(u16(nameBytes.length));
      put(u16(0));                 // extra length
      local.set(nameBytes, p);

      // 关键：Blob 原样作为 Blob 的一部分（按引用拼接，不复制内容）
      chunks.push(local, blob || bytes);

      const cd = new Uint8Array(46 + nameBytes.length);
      p = 0;
      const putc = (arr) => { for (const b of arr) cd[p++] = b; };
      putc(u32(0x02014b50));       // central directory signature
      putc(u16(20));               // version made by
      putc(u16(20));               // version needed
      putc(u16(0x0800));           // flags
      putc(u16(0));                // method
      putc(u16(dt.time));
      putc(u16(dt.date));
      putc(u32(crc));
      putc(u32(size));
      putc(u32(size));
      putc(u16(nameBytes.length));
      putc(u16(0));                // extra
      putc(u16(0));                // comment
      putc(u16(0));                // disk number
      putc(u16(0));                // internal attrs
      putc(u32(0));                // external attrs
      putc(u32(offset));           // relative offset of local header
      cd.set(nameBytes, p);
      central.push(cd);

      offset += local.length + size;
      if (offset > MAX_U32) throw new Error('压缩包超过 4GB（不支持 ZIP64），请减小「长边最大像素」或分批导出');
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);

    const eocd = new Uint8Array(22);
    let p = 0;
    const pute = (arr) => { for (const b of arr) eocd[p++] = b; };
    pute(u32(0x06054b50));
    pute(u16(0));
    pute(u16(0));
    pute(u16(entries.length));
    pute(u16(entries.length));
    pute(u32(cdSize));
    pute(u32(offset));
    pute(u16(0));

    return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
  }

  const api = { createZip, crc32, crc32OfBlob, crcUpdate, LIMITS: { MAX_ENTRIES, MAX_U32 } };
  global.FreyaZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
