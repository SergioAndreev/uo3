import { ACCESS_LEVELS, hasAccess, type AccessLevel } from '../catalog/social.js';
import { DomainError } from '../errors/index.js';

/** Разрешение → минимальный уровень. Старший уровень наследует права младших. */
export const PERMISSIONS = Object.freeze({
  'player.assist': 'helper',
  'chat.warn': 'helper',
  'account.inspect': 'moderator',
  'account.sessions.revoke': 'moderator',
  'account.ban.temp': 'moderator',
  'world.observe': 'moderator',
  'character.manage': 'moderator',
  'world.events.manage': 'game-master',
  'world.edit': 'game-master',
  'beacon.manage': 'game-master',
  'character.restore': 'game-master',
  'account.ban.permanent': 'administrator',
  'account.unban': 'administrator',
  'account.tfa.reset': 'administrator',
  'account.access.assign': 'administrator',
  'audit.read': 'administrator',
  'shard.manage': 'administrator',
  'ruleset.manage': 'owner',
} as const satisfies Record<string, AccessLevel>);

export type Permission = keyof typeof PERMISSIONS;

/** Предельный срок временного бана для уровня без `account.ban.permanent`. */
export const TEMP_BAN_MAX_MS = 30 * 24 * 60 * 60 * 1000;

export const isPermission = (value: string): value is Permission =>
  Object.prototype.hasOwnProperty.call(PERMISSIONS, value);

export const isAccessLevel = (value: unknown): value is AccessLevel =>
  typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);

/** Разбор строки из запроса, токена или БД. */
export function parseAccessLevel(value: unknown): AccessLevel {
  if (!isAccessLevel(value)) {
    throw new DomainError(
      'ERR_UNKNOWN_ACCESS_LEVEL',
      `неизвестный уровень доступа ${String(value)}`,
    );
  }
  return value;
}

/** Порядок старшинства: отрицательно, если `a` младше `b`. */
export const compareLevels = (a: AccessLevel, b: AccessLevel): number =>
  ACCESS_LEVELS.indexOf(a) - ACCESS_LEVELS.indexOf(b);

/** Персонал — любой уровень от `helper`. */
export const isStaff = (level: AccessLevel): boolean => hasAccess(level, 'helper');

/** Разрешение вне таблицы запрещено для всех уровней. */
export const grants = (level: AccessLevel, permission: string): boolean =>
  isPermission(permission) && hasAccess(level, PERMISSIONS[permission]);

export function permissionsOf(level: AccessLevel): readonly Permission[] {
  return Object.freeze((Object.keys(PERMISSIONS) as Permission[]).filter((p) => grants(level, p)));
}
