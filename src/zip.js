/* =========================================================================
 * zip.js — 极简 ZIP 打包器（零依赖）
 * 只使用 STORE（不压缩）方式；JPEG/PNG 本身已压缩，再 deflate 收益极小。
 * 生成标准 ZIP：Local File Header + Central Directory + EOCD，
 * 文件名以 UTF-8 编码并置 bit 11 标志，Windows / macOS 均可正常解压。
 * ========================================================================= */
(function (global) {
  'use strict';

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

  /**
   * 创建 ZIP。
   * @param {Array<{name:string, data:Uint8Array|ArrayBuffer|Blob}>} entries
   * @returns {Promise<Blob>}
   */
  async function createZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dt = dosDateTime(now);

    for (const e of entries) {
      let data = e.data;
      if (typeof Blob !== 'undefined' && data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
      data = toBytes(data);

      const nameBytes = new TextEncoder().encode(e.name);
      const crc = crc32(data);
      const size = data.length;

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

      chunks.push(local, data);

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

  const api = { createZip, crc32 };
  global.FreyaZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
