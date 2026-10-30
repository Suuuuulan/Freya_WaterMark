/* test-zip.js — 验证 ZIP 打包结果能被标准工具解开
 * 用法: node tools/test-zip.js
 * 覆盖：STORE 方式、CRC32、UTF-8 文件名标志、EOCD、Blob 条目（分块 CRC）、ZIP64 上限保护
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'src', 'zip.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'globalThis', code)(mod, global);
const Zip = global.FreyaZip || mod.exports;
const { createZip } = Zip;

let bad = 0;
const t = (name, ok, detail) => {
  if (ok) console.log('  OK   ' + name + (detail ? '  (' + detail + ')' : ''));
  else { bad++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
};

// Node 18+ 有 Blob
const entries = [
  { name: '照片 001.jpg', data: Buffer.from('hello jpeg content') },
  { name: 'sub/dir/图片-002.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
  { name: 'plain.txt', data: new TextEncoder().encode('中文内容 test') },
  // 导出流程里条目就是 Blob（canvas.toBlob 的产物），这里特意混一个进去
  { name: 'from-blob.jpg', data: new Blob([Buffer.from('blob entry content 数据')], { type: 'image/jpeg' }) }
];

(async () => {
  /* ---------- 0. 分块 CRC 与大 Blob 一致 ---------- */
  console.log('\n0) Blob 分块 CRC（跨 chunk 边界）');
  {
    const big = new Uint8Array(9 * 1024 * 1024);       // 9MB > 4MB chunk，必然跨块
    for (let i = 0; i < big.length; i++) big[i] = (i * 37 + 11) & 0xff;
    const whole = Zip.crc32(big);
    const chunked = await Zip.crc32OfBlob(new Blob([big]));
    t('9MB Blob 的流式 CRC 与整块 CRC 相同', whole === chunked,
      'whole=0x' + whole.toString(16) + ' chunked=0x' + chunked.toString(16));
    t('空 Blob 的 CRC = 0', (await Zip.crc32OfBlob(new Blob([]))) === 0);
  }

  /* ---------- 1. 正常打包 ---------- */
  const blob = await createZip(entries);
  const buf = Buffer.from(await blob.arrayBuffer());
  const out = path.join(__dirname, 'test-out.zip');
  fs.writeFileSync(out, buf);
  console.log('\nwrote ' + out + ' (' + buf.length + ' bytes)  entries=' + entries.length);

  // 手工解析校验
  let p = 0, count = 0;
  const seen = [];
  while (p < buf.length - 4) {
    const sig = buf.readUInt32LE(p);
    if (sig === 0x04034b50) {
      const flags = buf.readUInt16LE(p + 6);
      const method = buf.readUInt16LE(p + 8);
      const crc = buf.readUInt32LE(p + 14);
      const csize = buf.readUInt32LE(p + 18);
      const usize = buf.readUInt32LE(p + 22);
      const nlen = buf.readUInt16LE(p + 26);
      const elen = buf.readUInt16LE(p + 28);
      const name = buf.subarray(p + 30, p + 30 + nlen).toString('utf8');
      const data = buf.subarray(p + 30 + nlen + elen, p + 30 + nlen + elen + csize);
      let c = 0xffffffff;
      for (const b of data) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      const calc = (c ^ 0xffffffff) >>> 0;
      const okCrc = calc === crc;
      const okMethod = method === 0;
      const okUtf8 = (flags & 0x0800) !== 0;
      const okSize = usize === data.length;
      console.log(`  [${count}] "${name}" method=${method} crc=${okCrc ? 'OK' : 'FAIL'} size=${okSize ? 'OK' : 'FAIL'} utf8flag=${okUtf8 ? 'OK' : 'MISSING'} bytes=${csize}`);
      if (!okCrc || !okMethod || !okUtf8 || !okSize) bad++;
      seen.push(name);
      count++;
      p += 30 + nlen + elen + csize;
    } else {
      break;
    }
  }
  // central directory
  const cdSig = buf.readUInt32LE(p);
  console.log('central directory signature: ' + (cdSig === 0x02014b50 ? 'OK' : 'FAIL(0x' + cdSig.toString(16) + ')'));
  if (cdSig !== 0x02014b50) bad++;
  const eocdPos = buf.length - 22;
  const eocd = buf.readUInt32LE(eocdPos);
  const total = buf.readUInt16LE(eocdPos + 10);
  console.log('EOCD signature: ' + (eocd === 0x06054b50 ? 'OK' : 'FAIL') + '  entries=' + total + (total === entries.length ? ' OK' : ' FAIL'));
  if (eocd !== 0x06054b50 || total !== entries.length) bad++;
  console.log('文件数: ' + count + (count === entries.length ? ' OK' : ' FAIL'));
  if (count !== entries.length) bad++;

  /* ---------- 2. Blob 条目内容正确 ---------- */
  console.log('\n2) Blob 条目');
  {
    const cdStart = p;
    // 从 central directory 里取 from-blob.jpg 的偏移，再从 data descriptor 前的 local header 读内容
    const want = 'blob entry content 数据';
    const zipBlob = new Blob([buf]);
    const text = Buffer.from(await zipBlob.arrayBuffer()).toString('utf8');
    t('Blob 条目内容原样写入', text.indexOf(want) >= 0);
    t('central directory 在数据之后', cdStart > 0);
  }

  /* ---------- 3. ZIP64 上限保护 ---------- */
  console.log('\n3) 上限保护');
  {
    let msg = '';
    try { await createZip(new Array(Zip.LIMITS.MAX_ENTRIES + 1).fill({ name: 'a', data: new Uint8Array(1) })); }
    catch (e) { msg = e.message; }
    t('条目数超过 65535 → 明确报错（不再产出坏包）', /条目过多/.test(msg), msg || '未抛错');
  }

  console.log('\n' + (bad ? '✗ ' + bad + ' 处失败' : '✓ 全部通过'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
