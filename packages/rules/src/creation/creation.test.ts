import { describe, expect, it } from 'vitest';
import { buildProfile, DUSKMARCH } from '../index.js';
import { isDomainError } from '@duskmarch/domain';
import {
  FAST_DELETE_MS,
  SLOW_DELETE_MS,
  availableStartSkills,
  creationStatViolations,
  deletionGraceMs,
  nameKey,
  nameViolations,
  normalizeName,
  startSkillViolations,
} from './index.js';

const LISTS = {
  titles: ['Помощник', 'Модератор', 'Ведущий', 'Админ', 'Хранитель', 'GM', 'Admin', 'Mod'],
  reserved: ['Эйра', 'Заря', 'Марь', 'Ладь', 'Кремнёв', 'Соляр'],
};

describe('профиль: блок creation', () => {
  it('standard и proving, версия 2', () => {
    expect(DUSKMARCH.version).toBe(2);
    expect(DUSKMARCH.creation).toMatchObject({
      statPool: 90,
      statMin: 10,
      statMax: 60,
      skillPoolTenths: 1000,
      skillMaxTenths: 500,
      maxStartSkills: 3,
    });
    expect(buildProfile('proving').creation).toMatchObject({
      skillPoolTenths: 2000,
      skillMaxTenths: 1000,
    });
  });

  it('инвариант пула характеристик', () => {
    try {
      buildProfile('standard', { creation: { statPool: 200 } });
      expect.unreachable();
    } catch (error) {
      expect(isDomainError(error, 'ERR_RULESET_INVARIANT')).toBe(true);
      expect(JSON.stringify(error)).toContain('creation.statPool');
    }
    expect(() => buildProfile('standard', { creation: { skillMaxTenths: 2000 } })).toThrow();
    expect(() => buildProfile('standard', { creation: { skillPoolTenths: 1600 } })).toThrow();
  });
});

describe('характеристики и навыки', () => {
  it('пул и пределы характеристик', () => {
    expect(creationStatViolations(DUSKMARCH, { might: 40, finesse: 30, will: 20 })).toEqual([]);
    expect(creationStatViolations(DUSKMARCH, { might: 40, finesse: 30, will: 30 })).toHaveLength(1);
    expect(creationStatViolations(DUSKMARCH, { might: 70, finesse: 10, will: 10 })).toHaveLength(1);
    expect(creationStatViolations(DUSKMARCH, { might: 45.5, finesse: 30, will: 14.5 }).length).toBe(
      2,
    );
  });

  it('доступность навыков по флагам', () => {
    expect(availableStartSkills(DUSKMARCH)).toHaveLength(36);
    const noSea = buildProfile('standard', { features: { seafaring: false } });
    expect(availableStartSkills(noSea)).not.toContain('sailing');
    expect(availableStartSkills(noSea)).toHaveLength(35);
  });

  it('стартовые навыки', () => {
    expect(
      startSkillViolations(DUSKMARCH, [
        { skill: 'edge', tenths: 500 },
        { skill: 'archery', tenths: 500 },
      ]),
    ).toEqual([]);
    expect(
      startSkillViolations(DUSKMARCH, [
        { skill: 'edge', tenths: 500 },
        { skill: 'edge', tenths: 500 },
      ]),
    ).toContain('edge: повтор');
    expect(
      startSkillViolations(DUSKMARCH, [
        { skill: 'edge', tenths: 600 },
        { skill: 'archery', tenths: 400 },
      ]).length,
    ).toBe(1);
    expect(startSkillViolations(DUSKMARCH, [])).toHaveLength(2);
    expect(
      startSkillViolations(DUSKMARCH, [
        { skill: 'flying', tenths: 500 },
        { skill: 'edge', tenths: 500 },
      ]),
    ).toEqual(['flying: недоступен при создании']);
    const noSea = buildProfile('standard', { features: { seafaring: false } });
    expect(
      startSkillViolations(noSea, [
        { skill: 'sailing', tenths: 500 },
        { skill: 'edge', tenths: 500 },
      ]),
    ).toHaveLength(1);
    const proving = buildProfile('proving');
    const big = [
      { skill: 'edge', tenths: 1000 },
      { skill: 'archery', tenths: 1000 },
    ];
    expect(startSkillViolations(proving, big)).toEqual([]);
    expect(startSkillViolations(DUSKMARCH, big).length).toBeGreaterThan(0);
  });

  it('срок удаления', () => {
    expect(deletionGraceMs(3_600_000, 1000)).toBe(FAST_DELETE_MS);
    expect(deletionGraceMs(30 * 86_400_000, 1000)).toBe(SLOW_DELETE_MS);
    expect(deletionGraceMs(3_600_000, 1200)).toBe(SLOW_DELETE_MS);
  });
});

describe('имена', () => {
  it('нормализация', () => {
    expect(normalizeName('  мирослава   ясная ')).toBe('Мирослава Ясная');
    expect(normalizeName('о’нил-ярый')).toBe("О'Нил-Ярый");
  });

  it('нарушения', () => {
    expect(nameViolations('Мирослава Ясная', LISTS)).toEqual([]);
    expect(nameViolations('Иvan', LISTS)).toEqual(['mixed_script']);
    expect(nameViolations('Модератор Ив', LISTS)).toEqual(['reserved_prefix']);
    expect(nameViolations('Соляр', LISTS)).toEqual(['reserved_name']);
    expect(nameViolations('Солнце Соляр', LISTS)).toEqual(['reserved_name']);
    expect(nameViolations('Ив', LISTS)).toEqual(['length']);
    expect(nameViolations('Очень Длинное Имя', LISTS)).toEqual(['length', 'words']);
    expect(nameViolations('Ива7', LISTS)).toEqual(['characters']);
    expect(nameViolations('Ива--Ли', LISTS)).toEqual(['words']);
    expect(nameViolations('Modest', LISTS)).toEqual([]);
  });

  it('скелет: регистр, ё и латинские двойники', () => {
    expect(nameKey('ЯСНА')).toBe(nameKey('Ясна'));
    expect(nameKey('Алёна')).toBe(nameKey('Алена'));
    expect(nameKey('Opex')).toBe(nameKey('Орех'));
  });
});
