/* test-zip.js — 验证 ZIP 打包结果能被标准工具解开
 * 用法: node _tools/test-zip.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'src', 'zip.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'globalThis', code)(mod, global);
const { createZip } = global.FreyaZip || mod.exports;

// Node 18+ 有 Blob
const entries = [
  { name: '照片 001.jpg', data: Buffer.from('hello jpeg content') },
  { name: 'sub/dir/图片-002.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
  { name: 'plain.txt', data: new TextEncoder().encode('中文内容 test') }
];

(async () => {
  const blob = await createZip(entries);
  const buf = Buffer.from(await blob.arrayBuffer());
  const out = path.join(__dirname, 'test-out.zip');
  fs.writeFileSync(out, buf);
  console.log('wrote ' + out + ' (' + buf.length + ' bytes)  entries=' + entries.length);

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
      // 校验 CRC
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
  const eocdPos = buf.length - 22;
  const eocd = buf.readUInt32LE(eocdPos);
  const total = buf.readUInt16LE(eocdPos + 10);
  console.log('EOCD signature: ' + (eocd === 0x06054b50 ? 'OK' : 'FAIL') + '  entries=' + total + (total === entries.length ? ' OK' : ' FAIL'));
  console.log('文件数: ' + count + (count === entries.length ? ' OK' : ' FAIL'));
})().catch((e) => { console.error(e); process.exit(1); });
