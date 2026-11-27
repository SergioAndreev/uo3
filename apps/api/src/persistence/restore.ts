import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from '@duskmarch/db';
import {
  DbIdLeaseProvider,
  characterBrief,
  itemOwner,
  heroDiff,
  heroSnapshot,
  restoreHero,
  restoreItem,
  undoRestore,
  type HeroSnapshot,
  type ItemRestoreMode,
} from '@duskmarch/db/world';
import { hasAccess, makeEntityId, type AccessLevel } from '@duskmarch/domain';
import { IdentityError } from '../identity/core/errors.js';
import type { IdentityServices, Principal, RequestMeta } from '../identity/core/index.js';
import type { GameServices } from '../game/index.js';

/** Состояние героя на метку `T` (клон PITR, поднятый `pnpm backup drill --keep`). */
export interface RestoreSource {
  heroAt(shardId: string, characterId: string, targetTime: Date): Promise<HeroSnapshot | null>;
}

export interface RestoreStore {
  hero(shardId: string, characterId: string): Promise<HeroSnapshot | null>;
  /** Аккаунт и статус героя (проверка присутствия в мире). */
  character(
    shardId: string,
    characterId: string,
  ): Promise<{ accountId: string; status: string } | null>;
  /** Герой-владелец предмета, если предмет активен у героя. */
  ownerOf(
    shardId: string,
    itemId: number,
  ): Promise<{ characterId: string; accountId: string } | null>;
  restoreHero(
    shardId: string,
    target: HeroSnapshot,
    targetTime: Date,
    actor: RestoreActorInfo,
  ): Promise<{ operationId: string; txId: string }>;
  restoreItem(
    shardId: string,
    itemId: number,
    toCharacterId: string,
    mode: ItemRestoreMode,
    actor: RestoreActorInfo,
  ): Promise<{ operationId: string; itemId: number; previousOwner: number | null }>;
  undo(
    shardId: string,
    operationId: string,
    actor: RestoreActorInfo,
  ): Promise<{ operationId: string }>;
}

export interface RestoreActorInfo {
  accountId: string;
  accessLevel: AccessLevel;
  reason: string;
}

const PREVIEW_TTL_MS = 15 * 60_000;
const OFFLINE_WAIT_MS = 10_000;

const storeError = (error: unknown): never => {
  const code = (error as { code?: string }).code;
  if (code?.startsWith('PERSIST_')) {
    throw new IdentityError(code as never, (error as Error).message, {
      details: (error as { details?: Record<string, unknown> }).details ?? {},
    });
  }
  throw error;
};

/** Точечный откат героя и предмета, отмена операции. */
export class RestoreAdmin {
  private readonly previews = new Map<
    string,
    {
      characterId: string;
      shardId: string;
      target: HeroSnapshot;
      targetTime: Date;
      expires: number;
    }
  >();
  private readonly secret = randomBytes(32);

  constructor(
    private readonly identity: IdentityServices,
    private readonly game: GameServices,
    private readonly store: RestoreStore,
    private readonly source: RestoreSource | null,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** Предпросмотр: разница текущего состояния и состояния на `T`. */
  async preview(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    characterId: string,
    targetTime: Date,
  ) {
    await this.identity.staff.authorize(
      principal,
      'character.restore',
      'persistence.rollback_preview',
      meta,
    );
    if (!this.source)
      throw new IdentityError(
        'PERSIST_PITR_WINDOW_UNAVAILABLE',
        'клон на момент времени не подготовлен',
      );
    const target = await this.source.heroAt(shardId, characterId, targetTime);
    const current = await this.store.hero(shardId, characterId);
    if (!target || !current)
      throw new IdentityError(
        'PERSIST_CHARACTER_UNAVAILABLE',
        'герой не найден на метку или сейчас',
      );
    const id = randomBytes(12).toString('base64url');
    const expires = this.now() + PREVIEW_TTL_MS;
    this.previews.set(id, { characterId, shardId, target, targetTime, expires });
    return {
      previewToken: `${id}.${this.sign(`${id}:${characterId}:${shardId}`)}`,
      expiresAt: new Date(expires).toISOString(),
      diff: heroDiff(current, target),
    };
  }

  /** Свежее подтверждение, уровень `administrator`, право `character.restore`. */
  private async applier(principal: Principal, meta: RequestMeta, action: string) {
    await this.identity.auth.requireFresh(principal);
    const account = await this.identity.staff.authorize(
      principal,
      'character.restore',
      action,
      meta,
    );
    if (!hasAccess(account.accessLevel, 'administrator')) {
      throw new IdentityError('RBAC_INSUFFICIENT_PERMISSION', 'применение отката — администратор');
    }
    return account;
  }

  /** Герой вне мира: при `kick` — блокировка P05 (выход из мира, отказ во входе) и ожидание. */
  private async offline(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    characterId: string,
    kick: boolean,
    reason: string,
  ): Promise<boolean> {
    const c = await this.store.character(shardId, characterId);
    if (!c) throw new IdentityError('PERSIST_CHARACTER_UNAVAILABLE', 'герой не найден');
    const online = async () => (await this.game.live.session(shardId, c.accountId)) !== null;
    if (!(await online())) return false;
    if (!kick) throw new IdentityError('PERSIST_CHARACTER_ONLINE_BLOCKED', 'герой в мире');
    const locked = c.status !== 'locked';
    if (locked)
      await this.game.characters.lock(principal, characterId, `Точечный откат: ${reason}`, meta);
    const deadline = this.now() + OFFLINE_WAIT_MS;
    while (await online()) {
      if (this.now() > deadline)
        throw new IdentityError('PERSIST_CHARACTER_ONLINE_BLOCKED', 'герой не вышел из мира');
      await this.sleep(250);
    }
    return locked;
  }

  async applyCharacter(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    input: { characterId: string; previewToken: string; kickIfOnline: boolean; reason: string },
  ) {
    const account = await this.applier(principal, meta, 'persistence.rollback_character');
    const [id = '', sig = ''] = input.previewToken.split('.');
    const preview = this.previews.get(id);
    const expected = Buffer.from(this.sign(`${id}:${input.characterId}:${shardId}`));
    const given = Buffer.from(sig);
    if (
      !preview ||
      preview.characterId !== input.characterId ||
      preview.expires < this.now() ||
      expected.length !== given.length ||
      !timingSafeEqual(expected, given)
    ) {
      throw new IdentityError(
        'PERSIST_ROLLBACK_PREVIEW_REQUIRED',
        'нужен действующий предпросмотр',
      );
    }
    const lockedByUs = await this.offline(
      principal,
      meta,
      shardId,
      input.characterId,
      input.kickIfOnline,
      input.reason,
    );
    try {
      const actor = {
        accountId: account.id,
        accessLevel: account.accessLevel,
        reason: input.reason,
      };
      const result = await this.store
        .restoreHero(shardId, preview.target, preview.targetTime, actor)
        .catch(storeError);
      this.previews.delete(id);
      return result;
    } finally {
      if (lockedByUs)
        await this.game.characters.unlock(
          principal,
          input.characterId,
          `Откат завершён: ${input.reason}`,
          meta,
        );
    }
  }

  async restoreItem(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    input: { itemId: number; toCharacterId: string; mode: ItemRestoreMode; reason: string },
  ) {
    const account = await this.applier(principal, meta, 'persistence.restore_item');
    await this.offline(principal, meta, shardId, input.toCharacterId, false, input.reason);
    if (input.mode === 'reclaim_original') {
      const owner = await this.store.ownerOf(shardId, input.itemId);
      if (owner && (await this.game.live.session(shardId, owner.accountId))) {
        throw new IdentityError('PERSIST_CHARACTER_ONLINE_BLOCKED', 'текущий владелец в мире');
      }
    }
    const actor = { accountId: account.id, accessLevel: account.accessLevel, reason: input.reason };
    return this.store
      .restoreItem(shardId, input.itemId, input.toCharacterId, input.mode, actor)
      .catch(storeError);
  }

  async undo(
    principal: Principal,
    meta: RequestMeta,
    shardId: string,
    operationId: string,
    reason: string,
  ) {
    const account = await this.applier(principal, meta, 'persistence.restore_undo');
    return this.store
      .undo(shardId, operationId, {
        accountId: account.id,
        accessLevel: account.accessLevel,
        reason,
      })
      .catch(storeError);
  }
}

/** Хранилище восстановления на PostgreSQL. */
export class DrizzleRestoreStore implements RestoreStore {
  constructor(private readonly db: Database) {}

  hero = (shardId: string, characterId: string) => heroSnapshot(this.db, shardId, characterId);

  character = (shardId: string, characterId: string) =>
    characterBrief(this.db, shardId, characterId);
  ownerOf = (shardId: string, itemId: number) => itemOwner(this.db, shardId, itemId);

  restoreHero = (
    shardId: string,
    target: HeroSnapshot,
    targetTime: Date,
    actor: RestoreActorInfo,
  ) => restoreHero(this.db, { shardId, target, targetTime, actor });

  restoreItem(
    shardId: string,
    itemId: number,
    toCharacterId: string,
    mode: ItemRestoreMode,
    actor: RestoreActorInfo,
  ) {
    const ids = new DbIdLeaseProvider(this.db, shardId);
    return restoreItem(this.db, {
      shardId,
      itemId,
      toCharacterId,
      mode,
      actor,
      newId: async () => makeEntityId('item', (await ids.lease('item', 256)).from),
    });
  }

  undo = (shardId: string, operationId: string, actor: RestoreActorInfo) =>
    undoRestore(this.db, { shardId, operationId, actor });
}

/** Источник состояния на метку: база клона PITR (только чтение). */
export class CloneRestoreSource implements RestoreSource {
  constructor(private readonly clone: Database) {}
  heroAt = (shardId: string, characterId: string) => heroSnapshot(this.clone, shardId, characterId);
}

/** Хранилище для тестовых сборок без PostgreSQL: любая операция — недоступно. */
const unavailable = async (): Promise<never> => {
  throw new IdentityError('PERSIST_TX_UNAVAILABLE', 'хранилище восстановления недоступно');
};
export const unavailableRestoreStore: RestoreStore = {
  hero: unavailable,
  character: unavailable,
  ownerOf: unavailable,
  restoreHero: unavailable,
  restoreItem: unavailable,
  undo: unavailable,
};
