import { deflateSync } from 'node:zlib';
import { crc32 } from '@duskmarch/asset-formats/chunk';

/** PNG RGB 8 бит без зависимостей: заголовок, IDAT через zlib, IEND. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.length !== width * height * 3)
    throw new RangeError('размер буфера не совпадает с изображением');
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const block = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    block('IHDR', header),
    block('IDAT', new Uint8Array(deflateSync(raw))),
    block('IEND', new Uint8Array()),
  ];
  const total = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    total.set(part, offset);
    offset += part.length;
  }
  return total;
}
