import { expect, it } from 'vitest';
import { modelFiles } from '../synthetic/models.js';
import { readGlb, writeGlb } from './index.js';

it('модели-заглушки — корректный GLB', () => {
  const models = modelFiles();
  expect(models.map((m) => m.key)).toEqual([
    'model.test-crate',
    'model.test-column',
    'model.test-wall',
    'model.test-tree',
    'model.test-dummy',
  ]);
  for (const { bytes } of models) {
    const glb = readGlb(bytes);
    expect(glb.version).toBe(2);
    const primitive = glb.json.meshes[0]?.primitives[0];
    expect(primitive?.attributes).toEqual({ POSITION: 0, NORMAL: 1 });
    expect(primitive?.indices).toBe(2);
    expect(glb.binBytes % 4).toBe(0);
  }
});

it('нормали граней направлены наружу', () => {
  const bytes = writeGlb('x', [{ center: [0, 0, 0], half: [1, 1, 1] }], [255, 0, 0]);
  const glb = readGlb(bytes);
  expect(glb.binBytes).toBe(24 * 12 * 2 + 36 * 2);
  const json = glb.json as unknown as { bufferViews: { byteOffset: number }[] };
  const bin = bytes.subarray(bytes.length - glb.binBytes);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const pos = (i: number) => [0, 1, 2].map((a) => view.getFloat32(i * 12 + a * 4, true));
  const idxOffset = json.bufferViews[2]?.byteOffset ?? 0;
  for (let t = 0; t < 12; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => pos(view.getUint16(idxOffset + (t * 3 + k) * 2, true)));
    const u = [0, 1, 2].map((k) => (b?.[k] ?? 0) - (a?.[k] ?? 0));
    const w = [0, 1, 2].map((k) => (c?.[k] ?? 0) - (a?.[k] ?? 0));
    const n = [
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    ];
    const centroid = [0, 1, 2].map((k) => ((a?.[k] ?? 0) + (b?.[k] ?? 0) + (c?.[k] ?? 0)) / 3);
    expect(n[0]! * centroid[0]! + n[1]! * centroid[1]! + n[2]! * centroid[2]!).toBeGreaterThan(0);
  }
});

it('повреждённый GLB отклоняется', () => {
  const good = writeGlb('x', [{ center: [0, 0, 0], half: [1, 1, 1] }], [0, 0, 0]);
  const broken = (offset: number, value: number) => {
    const copy = good.slice();
    new DataView(copy.buffer).setUint32(offset, value, true);
    return copy;
  };
  expect(() => readGlb(broken(0, 0))).toThrow('магии');
  expect(() => readGlb(broken(4, 1))).toThrow('версия');
  expect(() => readGlb(broken(8, 1))).toThrow('длина');
  expect(() => readGlb(broken(16, 0))).toThrow('JSON');
  expect(() => readGlb(good.subarray(0, 10))).toThrow();
});
