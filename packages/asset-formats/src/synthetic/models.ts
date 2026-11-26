import { writeGlb, type Box } from '../glb/index.js';
import { rgbOf } from '../palette/index.js';

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Box => ({
  center: [cx, cy, cz],
  half: [hx, hy, hz],
});

/** Модели-заглушки: метры, ось Y вверх, основание на нуле. Оттенок — индекс палитры. */
export const PLACEHOLDER_MODELS: readonly { key: string; boxes: Box[]; tint: number }[] = [
  { key: 'model.test-crate', boxes: [box(0, 0.35, 0, 0.35, 0.35, 0.35)], tint: 1 + 1 * 17 + 7 },
  { key: 'model.test-column', boxes: [box(0, 1.25, 0, 0.2, 1.25, 0.2)], tint: 1 + 4 * 17 + 10 },
  { key: 'model.test-wall', boxes: [box(0, 1.5, 0, 0.5, 1.5, 0.1)], tint: 1 + 9 * 17 + 6 },
  {
    key: 'model.test-tree',
    boxes: [box(0, 1, 0, 0.12, 1, 0.12), box(0, 2.6, 0, 0.7, 0.7, 0.7)],
    tint: 1 + 6 * 17 + 5,
  },
  {
    key: 'model.test-dummy',
    boxes: [box(0, 0.65, 0, 0.25, 0.65, 0.15), box(0, 1.5, 0, 0.15, 0.2, 0.15)],
    tint: 1 + 14 * 17 + 8,
  },
];

export const modelFiles = (): { key: string; path: string; bytes: Uint8Array }[] =>
  PLACEHOLDER_MODELS.map(({ key, boxes, tint }) => ({
    key,
    path: `models/${key.slice('model.'.length)}.glb`,
    bytes: writeGlb(key, boxes, rgbOf(tint)),
  }));
