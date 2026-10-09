/*
 * png.mjs - a minimal, LOSSLESS PNG codec for 8-bit RGB / RGBA, non-interlaced.
 *
 * Why not a canvas: a browser canvas stores premultiplied alpha, so a
 * decode -> putImageData -> toDataURL round trip rewrites the colour of every
 * semi-transparent pixel on the figure's anti-aliased edge. A build step that
 * means to change a few hundred temple pixels must leave every other byte alone,
 * so this reads and writes the samples exactly. Ancillary chunks (gAMA, sRGB,
 * pHYs, iCCP...) are carried through unchanged.
 */
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 2: 3, 6: 4 };

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('png: not a PNG file');
  const chunks = [];
  let p = 8;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    chunks.push({ type, data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode to { width, height, channels, data: Uint8Array (row-major samples), chunks }. */
export function decodePng(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('png: missing IHDR');
  const width = ihdr.data.readUInt32BE(0), height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8], colorType = ihdr.data[9], interlace = ihdr.data[12];
  const channels = CHANNELS[colorType];
  if (depth !== 8 || !channels || interlace !== 0) {
    throw new Error(`png: unsupported format (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[dst + x - channels] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? data[dst - stride + x - channels] : 0;
      const v = raw[src + x];
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : -1;
      if (pred < 0) throw new Error(`png: bad filter ${f} on row ${y}`);
      data[dst + x] = (v + pred) & 255;
    }
  }
  return { width, height, channels, colorType, data, chunks };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Per row, the standard minimum-sum-of-absolute-differences filter choice. */
function filterRows(data, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = data[row + x];
      const a = x >= channels ? data[row + x - channels] : 0;
      const b = y > 0 ? data[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? data[row - stride + x - channels] : 0;
      cand[0][x] = v;
      cand[1][x] = (v - a) & 255;
      cand[2][x] = (v - b) & 255;
      cand[3][x] = (v - ((a + b) >> 1)) & 255;
      cand[4][x] = (v - paeth(a, b, c)) & 255;
    }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      for (let x = 0; x < stride; x++) s += cand[f][x] < 128 ? cand[f][x] : 256 - cand[f][x];
      if (s < bestSum) { bestSum = s; best = f; }
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
  }
  return out;
}

/** Re-encode `img` (as returned by decodePng, with edited `data`), keeping its chunks. */
export function encodePng(img) {
  const idat = zlib.deflateSync(filterRows(img.data, img.width, img.height, img.channels), { level: 9 });
  const parts = [SIG];
  let wroteIdat = false;
  for (const c of img.chunks) {
    if (c.type === 'IDAT') {
      if (!wroteIdat) { parts.push(chunk('IDAT', idat)); wroteIdat = true; }
      continue;
    }
    parts.push(chunk(c.type, Buffer.from(c.data)));
  }
  return Buffer.concat(parts);
}
