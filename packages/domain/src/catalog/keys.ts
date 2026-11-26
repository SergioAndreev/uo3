import { Type } from '@sinclair/typebox';
import { DomainError } from '../errors/index.js';

/** Индекс собственной палитры «янтарь — индиго»; 0 — естественный цвет. */
export type Tint = number & { readonly __tint: true };
export const NATURAL_TINT = 0 as Tint;
export function tint(value: number): Tint {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new DomainError('ERR_INVALID_TINT', `оттенок ${value} вне 0..255`);
  }
  return value as Tint;
}

export const CONTENT_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
export type ContentKey = string & { readonly __contentKey: true };
export function contentKey(value: string): ContentKey {
  if (!CONTENT_KEY_PATTERN.test(value)) {
    throw new DomainError('ERR_INVALID_CONTENT_KEY', `«${value}» не ключ вида group.name`);
  }
  return value as ContentKey;
}

export const TintSchema = Type.Integer({ minimum: 0, maximum: 255, $id: 'Tint' });
export const ContentKeySchema = Type.String({
  pattern: CONTENT_KEY_PATTERN.source,
  $id: 'ContentKey',
});
