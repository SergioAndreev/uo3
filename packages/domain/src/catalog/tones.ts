import { DomainError } from '../errors/index.js';

export const TONES = ['heat', 'frost', 'stone', 'wind', 'light'] as const;
export type Tone = (typeof TONES)[number];
export const TONE_NAMES: Readonly<Record<Tone, string>> = {
  heat: 'Жар',
  frost: 'Стужа',
  stone: 'Камень',
  wind: 'Ветер',
  light: 'Свет',
};

export interface ToneSet {
  readonly tones: readonly Tone[];
  /** Канонический ключ, например `heat+wind`. */
  readonly key: string;
}

/** Набор плетения: 2–3 различных тона в каноническом порядке. */
export function toneSet(tones: readonly string[]): ToneSet {
  const unique = new Set(tones);
  const known = tones.every((tone) => (TONES as readonly string[]).includes(tone));
  if (!known || unique.size !== tones.length || tones.length < 2 || tones.length > 3) {
    throw new DomainError(
      'ERR_INVALID_TONE_SET',
      `[${tones.join(', ')}]: нужно 2–3 различных тона`,
    );
  }
  const sorted = TONES.filter((tone) => unique.has(tone));
  return Object.freeze({ tones: Object.freeze(sorted), key: sorted.join('+') });
}
