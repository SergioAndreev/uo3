import type { AccessLevel } from '../catalog/social.js';
import { compareLevels, grants, isPermission, isStaff } from './permissions.js';

/** Контекст проверки, общий для API и игрового сервера. */
export interface AccessContext {
  /** Назначенный уровень. */
  readonly maxLevel: AccessLevel;
  /** Уровень, с которым сотрудник играет сейчас; не выше назначенного. */
  readonly effectiveLevel: AccessLevel;
  /** Сессия подтверждена вторым фактором. */
  readonly mfa: boolean;
  readonly banned: boolean;
}

export type AccessDenial = 'banned' | 'mfa_required' | 'insufficient' | 'unknown_permission';
export type AccessDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: AccessDenial };

const ALLOW: AccessDecision = Object.freeze({ allowed: true });
const deny = (reason: AccessDenial): AccessDecision => Object.freeze({ allowed: false, reason });

/** Проверка по эффективному уровню; права персонала требуют второго фактора. */
export function evaluateAccess(context: AccessContext, permission: string): AccessDecision {
  if (!isPermission(permission)) return deny('unknown_permission');
  if (context.banned) return deny('banned');
  const level =
    compareLevels(context.effectiveLevel, context.maxLevel) <= 0
      ? context.effectiveLevel
      : context.maxLevel;
  if (!grants(level, permission)) return deny('insufficient');
  if (isStaff(context.maxLevel) && !context.mfa) return deny('mfa_required');
  return ALLOW;
}

/** Действие над чужим аккаунтом допустимо только над строго младшим уровнем. */
export const canActOn = (actor: AccessLevel, target: AccessLevel): boolean =>
  compareLevels(actor, target) > 0;

/** Наивысший уровень, который может назначить исполнитель. */
export function assignCeiling(actor: AccessLevel): AccessLevel | null {
  if (actor === 'owner') return 'owner';
  if (actor === 'administrator') return 'game-master';
  return null;
}

/**
 * Можно ли сменить уровень цели с `current` на `next`.
 * Защита последнего владельца проверяется отдельно — по данным хранилища.
 */
export function canAssign(actor: AccessLevel, current: AccessLevel, next: AccessLevel): boolean {
  const ceiling = assignCeiling(actor);
  if (ceiling === null || !grants(actor, 'account.access.assign')) return false;
  const reachable = canActOn(actor, current) || (actor === 'owner' && current === 'owner');
  return reachable && compareLevels(next, ceiling) <= 0;
}

/** Эффективный уровень — от `player` до назначенного. */
export const canSetEffective = (max: AccessLevel, next: AccessLevel): boolean =>
  compareLevels(next, max) <= 0;
