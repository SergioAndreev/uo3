import { DomainError } from '../errors/index.js';
import type { Cell, RealmId } from './position.js';

export type PvpMode = 'consent' | 'open';
export interface Realm {
  readonly id: RealmId;
  readonly key: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly pvp: PvpMode;
  readonly testOnly: boolean;
}

export const DAWN = 0;
export const DUSK = 1;
export const PROVING = 255;

export const BUILTIN_REALMS: readonly Realm[] = Object.freeze(
  [
    {
      id: DAWN,
      key: 'dawn',
      name: 'Заря',
      width: 4096,
      height: 4096,
      pvp: 'consent',
      testOnly: false,
    },
    {
      id: DUSK,
      key: 'dusk',
      name: 'Марь',
      width: 4096,
      height: 4096,
      pvp: 'open',
      testOnly: false,
    },
    {
      id: PROVING,
      key: 'proving',
      name: 'Испытательный',
      width: 64,
      height: 64,
      pvp: 'consent',
      testOnly: true,
    },
  ].map((realm) => Object.freeze(realm as Realm)),
);

/** Набор планов; профиль правил может добавить свои без изменения домена. */
export class RealmRegistry {
  private readonly byId = new Map<RealmId, Realm>();

  constructor(realms: readonly Realm[] = BUILTIN_REALMS) {
    for (const realm of realms) this.register(realm);
  }

  register(realm: Realm): void {
    if (!Number.isInteger(realm.id) || realm.id < 0 || realm.id > 255 || this.byId.has(realm.id)) {
      throw new DomainError('ERR_UNKNOWN_REALM', `план ${realm.id} занят или вне 0..255`);
    }
    this.byId.set(realm.id, Object.freeze({ ...realm }));
  }

  get(id: RealmId): Realm {
    const realm = this.byId.get(id);
    if (!realm) throw new DomainError('ERR_UNKNOWN_REALM', `план ${id} не зарегистрирован`);
    return realm;
  }

  list(): Realm[] {
    return [...this.byId.values()];
  }

  contains(id: RealmId, { x, y }: Cell): boolean {
    const realm = this.get(id);
    return x >= 0 && y >= 0 && x < realm.width && y < realm.height;
  }

  assertInside(id: RealmId, c: Cell): void {
    if (!this.contains(id, c)) {
      throw new DomainError(
        'ERR_OUT_OF_REALM_BOUNDS',
        `(${c.x}, ${c.y}) вне плана ${this.get(id).key}`,
      );
    }
  }
}
