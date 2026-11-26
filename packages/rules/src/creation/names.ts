/** Списки имён из контента. */
export interface NameLists {
  /** Служебные титулы: имя не может с них начинаться. */
  readonly titles: readonly string[];
  /** Имена лора и запрещённые слова: имя не может их содержать как слово. */
  readonly reserved: readonly string[];
}

export type NameViolation =
  'length' | 'characters' | 'mixed_script' | 'words' | 'reserved_prefix' | 'reserved_name';

const CYR = /^[а-яё]$/i;
const LAT = /^[a-z]$/i;
const SEPARATORS = new Set([' ', '-', "'"]);

/** NFC, обрезка, схлопывание пробелов, заглавная первая буква каждой части. */
export function normalizeName(raw: string): string {
  const collapsed = raw.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/’/g, "'");
  return collapsed
    .toLowerCase()
    .replace(/(^|[ \-'])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Латинские двойники кириллических букв. */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
};

/** Скелет для уникальности: регистр, ё→е, латинские двойники → кириллица. */
export function nameKey(name: string): string {
  return [...normalizeName(name).toLowerCase()]
    .map((ch) => (ch === 'ё' ? 'е' : (HOMOGLYPHS[ch] ?? ch)))
    .join('');
}

const words = (name: string) => name.split(/[ \-']/).filter(Boolean);

export function nameViolations(raw: string, lists: NameLists): NameViolation[] {
  const name = normalizeName(raw);
  const out = new Set<NameViolation>();
  const length = [...name].length;
  if (length < 3 || length > 16) out.add('length');
  const letters = [...name].filter((ch) => !SEPARATORS.has(ch));
  if (letters.some((ch) => !CYR.test(ch) && !LAT.test(ch))) out.add('characters');
  else if (letters.some((ch) => CYR.test(ch)) && letters.some((ch) => LAT.test(ch))) {
    out.add('mixed_script');
  }
  if (/[ \-']{2,}|^[ \-']|[ \-']$/.test(name) || words(name).length > 2) out.add('words');
  const lower = name.toLowerCase();
  const first = words(lower)[0] ?? '';
  if (lists.titles.some((t) => first === t.toLowerCase())) out.add('reserved_prefix');
  const keys = new Set(words(lower).map((w) => nameKey(w)));
  if (lists.reserved.some((r) => keys.has(nameKey(r)))) out.add('reserved_name');
  return [...out];
}
