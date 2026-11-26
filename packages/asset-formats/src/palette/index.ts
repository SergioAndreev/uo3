export const PALETTE_SIZE = 256;
export const TONES_COUNT = 15;
export const SHADES_COUNT = 17;
const HUE_START = 35;
const HUE_STEP = 15;
const SATURATION = 700; // тысячные
const LIGHT_START = 120;
const LIGHT_STEP = 50;

export interface PaletteEntry {
  readonly index: number;
  /** `null` у индекса 0 — естественный цвет материала. */
  readonly color: string | null;
  readonly tone: number | null;
  readonly shade: number | null;
}

/** HSL → sRGB в целых тысячных; `h` в градусах, `s` и `l` — 0..1000. */
export function hslToHex(h: number, s: number, l: number): string {
  const c = Math.round(((1000 - Math.abs(2 * l - 1000)) * s) / 1000);
  const hp = ((h % 360) + 360) % 360;
  const sector = Math.floor(hp / 60);
  const frac = ((hp % 60) * 1000) / 60;
  const x = Math.round((c * (1000 - Math.abs((sector % 2) * 1000 + frac - 1000))) / 1000);
  const m = l - Math.round(c / 2);
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector] as [number, number, number];
  const byte = (v: number): string =>
    Math.min(255, Math.max(0, Math.round(((v + m) * 255) / 1000)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** Палитра «янтарь — индиго»: 15 тонов по 17 ступеней, индекс 0 — естественный цвет. */
export function buildPalette(): PaletteEntry[] {
  const entries: PaletteEntry[] = [{ index: 0, color: null, tone: null, shade: null }];
  for (let tone = 0; tone < TONES_COUNT; tone++) {
    for (let shade = 0; shade < SHADES_COUNT; shade++) {
      entries.push({
        index: 1 + tone * SHADES_COUNT + shade,
        color: hslToHex(HUE_START + tone * HUE_STEP, SATURATION, LIGHT_START + shade * LIGHT_STEP),
        tone,
        shade,
      });
    }
  }
  return entries;
}

export const PALETTE: readonly PaletteEntry[] = Object.freeze(
  buildPalette().map((e) => Object.freeze(e)),
);

/** Цвет индекса как `[r, g, b]` 0..255; для 0 — `fallback`. */
export function rgbOf(
  index: number,
  fallback: [number, number, number] = [200, 200, 200],
): [number, number, number] {
  const color = PALETTE[index]?.color;
  if (!color) return fallback;
  return [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}
