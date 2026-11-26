import { BUILTIN_REALMS, SCHOOLS, SKILL_BY_KEY } from '@duskmarch/domain';
import {
  DUSKMARCH,
  creationStatViolations,
  nameViolations,
  startSkillViolations,
} from '@duskmarch/rules';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUNDS,
  NAME_LISTS,
  SCHOOL_LOADOUTS,
  START_CITIES,
  nameLists,
  startCity,
  starterLoadout,
} from './index.js';

describe('контент героя', () => {
  it('предыстории проходят правила создания standard', () => {
    expect(BACKGROUNDS.map((b) => b.key)).toEqual([
      'mercenary',
      'ranger',
      'artisan',
      'resonant',
      'wayfarer',
      'envoy',
    ]);
    expect(new Set(BACKGROUNDS.map((b) => b.school))).toEqual(new Set(SCHOOLS));
    for (const b of BACKGROUNDS) {
      expect(creationStatViolations(DUSKMARCH, b.stats), b.key).toEqual([]);
      expect(startSkillViolations(DUSKMARCH, b.skills), b.key).toEqual([]);
    }
  });

  it('города лежат в своих планах', () => {
    expect(START_CITIES.map((c) => c.key)).toEqual(['lad', 'kremnev', 'solyar', 'proving-camp']);
    for (const city of START_CITIES) {
      const realm = BUILTIN_REALMS.find((r) => r.key === city.realm);
      expect(realm, city.key).toBeDefined();
      expect(city.x).toBeLessThan(realm?.width ?? 0);
      expect(city.y).toBeLessThan(realm?.height ?? 0);
    }
    expect(startCity('lad')?.realm).toBe('dawn');
    expect(startCity('atlantis')).toBeUndefined();
  });

  it('наборы школ и ключи контента', () => {
    expect(Object.keys(SCHOOL_LOADOUTS).sort()).toEqual([...SCHOOLS].sort());
    for (const entries of Object.values(SCHOOL_LOADOUTS)) {
      for (const e of entries) expect(e.key).toMatch(/^item\.[a-z][a-z0-9-]*$/);
    }
  });

  it('стартовый набор созвучника и без повторов школы', () => {
    const resonant = BACKGROUNDS.find((b) => b.key === 'resonant')!;
    const kit = starterLoadout(resonant.skills).map((e) => e.key);
    expect(kit).toEqual(expect.arrayContaining(['item.tuning-fork', 'item.chalk', 'item.satchel']));
    const blade = starterLoadout([
      { skill: 'edge', tenths: 500 },
      { skill: 'tactics', tenths: 500 },
    ]);
    expect(blade.filter((e) => e.key === 'item.short-blade')).toEqual([
      { key: 'item.short-blade', count: 1 },
    ]);
    expect(starterLoadout(resonant.skills)).toEqual(starterLoadout([...resonant.skills].reverse()));
    expect(SKILL_BY_KEY.get('lore')?.school).toBe('society');
  });

  it('списки имён', () => {
    const lists = nameLists();
    expect(nameViolations('Админ Ива', lists)).toEqual(['reserved_prefix']);
    expect(nameViolations('Тупица', lists)).toEqual(['reserved_name']);
    expect(NAME_LISTS.reserved).toContain('Соляр');
  });
});
