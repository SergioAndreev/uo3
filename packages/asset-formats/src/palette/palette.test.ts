import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PALETTE, buildPalette, hslToHex, rgbOf } from './index.js';

it('границы палитры', () => {
  expect(PALETTE).toHaveLength(256);
  expect(PALETTE[0]).toEqual({ index: 0, color: null, tone: null, shade: null });
  expect(PALETTE[1]).toMatchObject({ tone: 0, shade: 0 });
  expect(PALETTE[255]).toMatchObject({ tone: 14, shade: 16 });
  const lum = (hex: string) =>
    [1, 3, 5].reduce((s, i) => s + Number.parseInt(hex.slice(i, i + 2), 16), 0);
  expect(lum(PALETTE[1]?.color ?? '')).toBeLessThan(lum(PALETTE[17]?.color ?? ''));
  expect(rgbOf(0)).toEqual([200, 200, 200]);
});

it('тон 0 — янтарь, тон 14 — индиго', () => {
  const [r, g, b] = rgbOf(1 + 8);
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  const [ir, ig, ib] = rgbOf(1 + 14 * 17 + 8);
  expect(ib).toBeGreaterThan(ir);
  expect(ir).toBeGreaterThan(ig);
});

it('цвета различны и воспроизводимы, совпадают с эталоном', () => {
  const colors = PALETTE.slice(1).map((e) => e.color);
  expect(new Set(colors).size).toBe(255);
  expect(buildPalette()).toEqual(PALETTE);
  // Эталон — независимое вычисление с плавающей точкой (Python colorsys): допуск ±1 на канал.
  const golden = JSON.parse(
    readFileSync(new URL('./palette.vectors.json', import.meta.url), 'utf8'),
  ) as string[];
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  colors.forEach((color, i) => {
    const b = channels(golden[i] ?? '');
    channels(color ?? '').forEach((v, c) => {
      expect(Math.abs(v - (b[c] ?? 0)), `${i + 1}: ${color} ≠ ${golden[i]}`).toBeLessThanOrEqual(1);
    });
  });
});

it('HSL → sRGB на опорных цветах', () => {
  expect(hslToHex(0, 1000, 500)).toBe('#ff0000');
  expect(hslToHex(120, 1000, 500)).toBe('#00ff00');
  expect(hslToHex(240, 1000, 500)).toBe('#0000ff');
  expect(hslToHex(60, 1000, 500)).toBe('#ffff00');
  expect(hslToHex(300, 1000, 250)).toBe('#800080');
  expect(hslToHex(0, 0, 1000)).toBe('#ffffff');
});
