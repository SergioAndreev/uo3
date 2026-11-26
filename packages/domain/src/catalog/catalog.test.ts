import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isDomainError, type DomainErrorCode } from '../errors/index.js';
import {
  ACCESS_LEVELS,
  CELL_FLAGS,
  FRAMES,
  NO_FLAGS,
  REPUTATIONS,
  RESOURCES,
  SCHOOLS,
  SCHOOL_NAMES,
  SKILLS,
  SKILL_MODES,
  SLOTS,
  SLOT_INFO,
  STATS,
  SURFACES,
  TONES,
  contentKey,
  hasAccess,
  hasFlag,
  listFlags,
  occupiedSlots,
  parseCellFlags,
  skillByKey,
  skillTenths,
  tint,
  toneSet,
  withFlags,
  withoutFlags,
} from './index.js';

const fails = (fn: () => unknown, code: DomainErrorCode): void => {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught, code), String(caught)).toBe(true);
};

it('характеристики и ресурсы', () => {
  expect(STATS).toEqual(['might', 'finesse', 'will']);
  expect(RESOURCES).toEqual(['health', 'verve', 'resonance']);
});

it('36 навыков, по шесть в школе, id уникальны', () => {
  expect(SKILLS).toHaveLength(36);
  expect(SKILLS.map((s) => s.id)).toEqual([...Array(36).keys()]);
  expect(new Set(SKILLS.map((s) => s.key)).size).toBe(36);
  for (const school of SCHOOLS) expect(SKILLS.filter((s) => s.school === school)).toHaveLength(6);
  expect(skillByKey('beaconry')).toMatchObject({ id: 29, school: 'path', name: 'Маячное дело' });
  expect(Object.isFrozen(SKILLS[0])).toBe(true);
});

it('id навыков неизменны', () => {
  expect(SKILLS.map((s) => `${s.id}:${s.key}`).join(' ')).toMatchInlineSnapshot(
    `"0:edge 1:haft 2:maul 3:ward 4:brawl 5:tactics 6:archery 7:tracking 8:trapping 9:taming 10:skinning 11:stealth 12:smithing 13:joinery 14:weaving 15:brewing 16:cooking 17:masonry 18:heat 19:frost 20:stone 21:wind 22:light 23:binding 24:mining 25:felling 26:foraging 27:angling 28:sailing 29:beaconry 30:trade 31:mending 32:lore 33:oratory 34:music 35:stewardship"`,
  );
});

it('значения и режимы навыков', () => {
  expect(skillTenths(0)).toBe(0);
  expect(skillTenths(1000)).toBe(1000);
  for (const value of [1001, -1, 2.5])
    fails(() => skillTenths(value), 'ERR_SKILL_VALUE_OUT_OF_RANGE');
  expect(SKILL_MODES).toEqual(['grow', 'keep', 'yield']);
});

it('тоны и плетения', () => {
  expect(TONES).toEqual(['heat', 'frost', 'stone', 'wind', 'light']);
  expect(toneSet(['wind', 'heat']).key).toBe('heat+wind');
  expect(toneSet(['heat', 'wind']).key).toBe('heat+wind');
  const triples = [
    ['light', 'stone', 'frost'],
    ['frost', 'light', 'stone'],
    ['stone', 'frost', 'light'],
    ['frost', 'stone', 'light'],
    ['light', 'frost', 'stone'],
    ['stone', 'light', 'frost'],
  ];
  expect(new Set(triples.map((t) => toneSet(t).key))).toEqual(new Set(['frost+stone+light']));
  for (const bad of [
    ['heat'],
    ['heat', 'heat'],
    ['heat', 'frost', 'stone', 'wind'],
    ['heat', 'fire'],
  ]) {
    fails(() => toneSet(bad), 'ERR_INVALID_TONE_SET');
  }
});

it('слоты экипировки', () => {
  expect(SLOTS).toHaveLength(13);
  expect(occupiedSlots('main-hand', true)).toEqual(['main-hand', 'off-hand']);
  expect(occupiedSlots('main-hand')).toEqual(['main-hand']);
  expect(occupiedSlots('head', true)).toEqual(['head']);
  expect(SLOT_INFO['ring-left'].visible).toBe(false);
  expect(SLOT_INFO.cloak.visible).toBe(true);
});

it('репутация и уровни доступа', () => {
  expect(REPUTATIONS).toEqual(['neutral', 'ally', 'offender', 'outcast', 'enemy']);
  expect(hasAccess('moderator', 'helper')).toBe(true);
  expect(hasAccess('moderator', 'game-master')).toBe(false);
  ACCESS_LEVELS.forEach((a, i) =>
    ACCESS_LEVELS.forEach((b, j) => expect(hasAccess(a, b)).toBe(i >= j)),
  );
});

it('каркасы, поверхности и флаги клеток', () => {
  expect(FRAMES).toEqual(['humanoid', 'beast', 'avian', 'aquatic', 'construct', 'wisp']);
  expect(SURFACES).toEqual([
    'soil',
    'grass',
    'sand',
    'stone',
    'snow',
    'ice',
    'ash',
    'moss',
    'shallow-water',
    'deep-water',
    'void',
  ]);
  expect(CELL_FLAGS).toHaveLength(10);
  const mask = withFlags(NO_FLAGS, 'water', 'deep');
  expect(mask).toBe(0x18);
  expect(hasFlag(mask, 'standable')).toBe(false);
  expect(listFlags(withoutFlags(mask, 'deep'))).toEqual(['water']);
  expect(parseCellFlags(0x3ff)).toBe(0x3ff);
  for (const bad of [0x400, 0x80000000, -1, 1.5])
    fails(() => parseCellFlags(bad), 'ERR_UNKNOWN_CELL_FLAG');
});

it('оттенки и ключи контента', () => {
  expect(tint(255)).toBe(255);
  fails(() => tint(256), 'ERR_INVALID_TINT');
  expect(contentKey('item.amber-lantern')).toBe('item.amber-lantern');
  expect(contentKey('creature.ash-hound')).toBe('creature.ash-hound');
  for (const bad of ['Item.Lantern', 'lantern', 'item.', '.item'])
    fails(() => contentKey(bad), 'ERR_INVALID_CONTENT_KEY');
});

it('таблица навыков в документации совпадает с каталогом', () => {
  const doc = readFileSync(new URL('../../docs/core-enumerations.md', import.meta.url), 'utf8');
  const rows = doc
    .split('\n')
    .map((line) => /^\| (\d+) \| `([a-z]+)` \| ([^|]+) \| ([^|]+) \|$/.exec(line))
    .filter((m) => m !== null)
    .map((m) => ({ id: Number(m[1]), key: m[2], name: m[3]?.trim(), school: m[4]?.trim() }));
  expect(rows).toEqual(
    SKILLS.map((s) => ({ id: s.id, key: s.key, name: s.name, school: SCHOOL_NAMES[s.school] })),
  );
});
