import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCESS_LEVELS, type AccessLevel } from '../catalog/social.js';
import { isDomainError } from '../errors/index.js';
import {
  PERMISSIONS,
  assignCeiling,
  canActOn,
  canAssign,
  canSetEffective,
  compareLevels,
  evaluateAccess,
  grants,
  isAccessLevel,
  isStaff,
  parseAccessLevel,
  permissionsOf,
  type AccessContext,
} from './index.js';

const ctx = (level: AccessLevel, over: Partial<AccessContext> = {}): AccessContext => ({
  maxLevel: level,
  effectiveLevel: level,
  mfa: true,
  banned: false,
  ...over,
});

describe('иерархия уровней', () => {
  it('порядок совпадает с ACCESS_LEVELS', () => {
    ACCESS_LEVELS.forEach((a, i) =>
      ACCESS_LEVELS.forEach((b, j) =>
        expect(Math.sign(compareLevels(a, b))).toBe(Math.sign(i - j)),
      ),
    );
    expect(isStaff('player')).toBe(false);
    expect(ACCESS_LEVELS.slice(1).every(isStaff)).toBe(true);
  });

  it('неизвестный уровень отклоняется', () => {
    expect(isAccessLevel('superuser')).toBe(false);
    expect(isAccessLevel(3)).toBe(false);
    expect(parseAccessLevel('moderator')).toBe('moderator');
    try {
      parseAccessLevel('superuser');
      expect.unreachable();
    } catch (error) {
      expect(isDomainError(error, 'ERR_UNKNOWN_ACCESS_LEVEL')).toBe(true);
    }
  });
});

describe('матрица разрешений', () => {
  it('права помощника; у игрока прав нет', () => {
    expect(permissionsOf('player')).toEqual([]);
    expect(permissionsOf('helper')).toEqual(['player.assist', 'chat.warn']);
  });

  it('права модератора и ведущего', () => {
    const moderator = permissionsOf('moderator');
    expect(moderator).toEqual(
      expect.arrayContaining([
        'player.assist',
        'chat.warn',
        'account.inspect',
        'account.sessions.revoke',
        'account.ban.temp',
        'world.observe',
      ]),
    );
    expect(moderator).not.toContain('world.edit');
    const gm = permissionsOf('game-master');
    expect(gm).toEqual(
      expect.arrayContaining([...moderator, 'world.events.manage', 'world.edit', 'beacon.manage']),
    );
    expect(gm).not.toContain('account.ban.permanent');
  });

  it('права администратора и владельца', () => {
    const admin = permissionsOf('administrator');
    for (const p of [
      'account.ban.permanent',
      'account.unban',
      'account.tfa.reset',
      'account.access.assign',
      'audit.read',
      'shard.manage',
    ] as const) {
      expect(admin).toContain(p);
    }
    expect(admin).not.toContain('ruleset.manage');
    expect(permissionsOf('owner')).toHaveLength(Object.keys(PERMISSIONS).length);
  });

  it('наследование: каждый следующий уровень — надмножество', () => {
    for (let i = 1; i < ACCESS_LEVELS.length; i++) {
      const lower = permissionsOf(ACCESS_LEVELS[i - 1] as AccessLevel);
      expect(permissionsOf(ACCESS_LEVELS[i] as AccessLevel)).toEqual(
        expect.arrayContaining([...lower]),
      );
    }
  });

  it('неизвестное разрешение запрещено даже владельцу', () => {
    expect(grants('owner', 'world.destroy')).toBe(false);
    expect(grants('owner', 'toString')).toBe(false);
    expect(evaluateAccess(ctx('owner'), 'world.destroy')).toEqual({
      allowed: false,
      reason: 'unknown_permission',
    });
  });

  it('таблица в документации синхронизирована', () => {
    const doc = readFileSync(new URL('../../docs/access.md', import.meta.url), 'utf8');
    const rows = [...doc.matchAll(/^\| `([a-z.]+)` \| `([a-z-]+)` \|/gm)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(rows)).toEqual(PERMISSIONS);
  });
});

describe('evaluateAccess', () => {
  it('ведущий управляет событиями', () => {
    expect(evaluateAccess(ctx('game-master'), 'world.events.manage')).toEqual({ allowed: true });
  });

  it('пониженный эффективный уровень лишает прав', () => {
    expect(evaluateAccess(ctx('game-master', { effectiveLevel: 'player' }), 'world.edit')).toEqual({
      allowed: false,
      reason: 'insufficient',
    });
  });

  it('эффективный уровень выше назначенного обрезается', () => {
    expect(evaluateAccess(ctx('helper', { effectiveLevel: 'owner' }), 'world.edit')).toEqual({
      allowed: false,
      reason: 'insufficient',
    });
  });

  it('бан и отсутствие второго фактора', () => {
    expect(evaluateAccess(ctx('owner', { banned: true }), 'world.edit')).toEqual({
      allowed: false,
      reason: 'banned',
    });
    expect(evaluateAccess(ctx('moderator', { mfa: false }), 'account.inspect')).toEqual({
      allowed: false,
      reason: 'mfa_required',
    });
    expect(evaluateAccess(ctx('player', { mfa: false }), 'account.inspect')).toEqual({
      allowed: false,
      reason: 'insufficient',
    });
  });
});

describe('иерархия действий и назначение', () => {
  it('действовать можно только на строго младший уровень', () => {
    expect(canActOn('moderator', 'moderator')).toBe(false);
    expect(canActOn('administrator', 'owner')).toBe(false);
    expect(canActOn('administrator', 'game-master')).toBe(true);
  });

  it('потолки назначения', () => {
    expect(assignCeiling('administrator')).toBe('game-master');
    expect(assignCeiling('owner')).toBe('owner');
    expect(assignCeiling('game-master')).toBeNull();
  });

  it('администратор назначает до ведущего', () => {
    expect(canAssign('administrator', 'player', 'moderator')).toBe(true);
    expect(canAssign('administrator', 'game-master', 'player')).toBe(true);
    expect(canAssign('administrator', 'player', 'administrator')).toBe(false);
    expect(canAssign('administrator', 'administrator', 'player')).toBe(false);
    expect(canAssign('game-master', 'player', 'helper')).toBe(false);
  });

  it('владелец назначает любые уровни, в том числе другому владельцу', () => {
    expect(canAssign('owner', 'helper', 'moderator')).toBe(true);
    expect(canAssign('owner', 'player', 'owner')).toBe(true);
    expect(canAssign('owner', 'owner', 'administrator')).toBe(true);
  });

  it('эффективный уровень не выше назначенного', () => {
    expect(canSetEffective('game-master', 'player')).toBe(true);
    expect(canSetEffective('game-master', 'game-master')).toBe(true);
    expect(canSetEffective('helper', 'moderator')).toBe(false);
  });
});
