import { createHash } from 'node:crypto';
import { hasAccess, makeEntityId } from '@duskmarch/domain';
import { BACKGROUNDS, nameLists, startCity, starterLoadout } from '@duskmarch/content';
import {
  availableStartSkills,
  creationStatViolations,
  deletionGraceMs,
  isDeveloped,
  nameKey,
  nameViolations,
  normalizeName,
  startSkillViolations,
  vitals,
  type SkillPick,
} from '@duskmarch/rules';
import {
  DAY,
  IdentityError,
  MINUTE,
  type Identity,
  type Principal,
  type RequestMeta,
  type StaffService,
} from '../identity/core/index.js';
import { hit, peek } from '../identity/core/rate-limit.js';
import type { Appearance, CharacterRecord, GameStore, LivePort, ShardRecord } from './ports.js';
import type { ShardService } from './shards.js';

export const MAX_SLOTS = 7;
export const CREATIONS_PER_DAY = 3;
export const NAME_CHECKS_PER_MINUTE = 30;
export const RENAME_COOLDOWN_MS = 30 * DAY;
export const NAME_HOLD_MS = DAY;
export const RESTORE_WINDOW_MS = 90 * DAY;
const IDEMPOTENCY_TTL_MS = 5 * MINUTE;

/** Предохранитель удаления (дома P23, гильдии P26): причина отказа или `null`. */
export interface DeletionGuard {
  check(character: CharacterRecord): Promise<string | null>;
}

export interface CreateInput {
  name: string;
  background?: string | undefined;
  stats?: { might: number; finesse: number; will: number } | undefined;
  skills?: SkillPick[] | undefined;
  appearance: Appearance;
  startCity: string;
}

/** Индекс оттенка → тон и ступень палитры (0 — естественный цвет). */
const toneShade = (tint: number) =>
  tint === 0 ? null : { tone: Math.floor((tint - 1) / 17), shade: (tint - 1) % 17 };

export function appearanceViolations(a: Appearance): string[] {
  const errors: string[] = [];
  const skin = toneShade(a.skinTint);
  if (!skin || skin.tone > 3 || skin.shade < 4 || skin.shade > 12) errors.push('skinTint');
  const hair = toneShade(a.hairTint);
  if (!hair || hair.shade < 2 || hair.shade > 14) errors.push('hairTint');
  return errors;
}

const reasonOf = (raw: string): string => {
  const reason = raw.trim();
  if (reason.length < 10 || reason.length > 1000) {
    throw new IdentityError('CHAR_REASON_INVALID', 'причина от 10 до 1000 символов');
  }
  return reason;
};

/** Создание, список, удаление и переименование героев. */
export class CharacterService {
  constructor(
    private readonly id: Identity,
    private readonly store: GameStore,
    private readonly live: LivePort,
    private readonly shards: ShardService,
    private readonly staff: StaffService,
    private readonly guards: DeletionGuard[] = [],
  ) {}

  view(c: CharacterRecord) {
    const top = [...c.skills].sort((a, b) => b.tenths - a.tenths).slice(0, 3);
    return {
      id: c.id,
      entityId: c.entityId,
      name: c.name,
      slot: c.slot,
      status: c.status,
      stats: c.stats,
      vitals: vitals(c.stats),
      topSkills: top,
      appearance: c.appearance,
      background: c.background,
      realm: c.realm,
      startCity: c.startCity,
      createdAt: this.id.iso(c.createdAt),
      lastPlayedAt: c.lastPlayedAt === null ? null : this.id.iso(c.lastPlayedAt),
      deleteAt: c.deleteAt === null ? null : this.id.iso(c.deleteAt),
    };
  }

  /** Число слотов: шард + дополнительные, не больше 7. */
  async quota(accountId: string, shard: ShardRecord): Promise<number> {
    return Math.min(
      MAX_SLOTS,
      shard.characterSlots + (await this.store.extraSlots(accountId, shard.id)),
    );
  }

  async options(shardId: string, principal: Principal | null) {
    const shard = await this.shards.visible(shardId, principal);
    const profile = this.shards.profile(shard);
    const skills = new Set(availableStartSkills(profile));
    return {
      creationOpen: shard.creationOpen,
      stats: {
        pool: profile.creation.statPool,
        min: profile.creation.statMin,
        max: profile.creation.statMax,
      },
      skills: {
        poolTenths: profile.creation.skillPoolTenths,
        minTenths: profile.creation.skillMinTenths,
        maxTenths: profile.creation.skillMaxTenths,
        maxCount: profile.creation.maxStartSkills,
        available: [...skills],
      },
      // Предыстории рассчитаны на пул standard: на шарде с другим пулом они не предлагаются.
      backgrounds: BACKGROUNDS.filter(
        (b) =>
          creationStatViolations(profile, b.stats).length === 0 &&
          startSkillViolations(profile, b.skills).length === 0,
      ),
      appearance: {
        builds: ['lean', 'average', 'sturdy'],
        faces: 8,
        hairStyles: 12,
        beards: 6,
        skinTones: [0, 1, 2, 3],
        skinShades: [4, 12],
        hairShades: [2, 14],
      },
      startCities: shard.startCities.flatMap((key) => {
        const city = startCity(key);
        return city
          ? [{ key, name: city.name, realm: city.realm, description: city.description }]
          : [];
      }),
    };
  }

  /** Занято ли имя для аккаунта (с учётом удержания после удаления). */
  private async nameTaken(shardId: string, key: string, accountId: string, exceptId?: string) {
    const live = await this.store.findByNameKey(shardId, key);
    if (live && live.id !== exceptId) return true;
    const hold = await this.store.findNameHold(shardId, key, this.id.now());
    return hold !== null && hold.accountId !== accountId;
  }

  private checkName(name: string): string {
    const violations = nameViolations(name, nameLists());
    if (violations.length > 0) {
      throw new IdentityError('CHAR_INVALID_NAME', 'имя не подходит', { details: { violations } });
    }
    return normalizeName(name);
  }

  async validateName(principal: Principal, shardId: string, name: string) {
    const shard = await this.shards.visible(shardId, principal);
    const state = await hit(this.id.kv, `name-check:${principal.accountId}`, MINUTE, this.id.now());
    if (state.count > NAME_CHECKS_PER_MINUTE) {
      throw new IdentityError('CHAR_NAME_RATE_LIMITED', 'слишком много проверок', {
        retryAfterS: state.retryAfterS,
      });
    }
    const violations = nameViolations(name, nameLists());
    const normalized = normalizeName(name);
    if (violations.length > 0) return { valid: false, normalized, violations };
    const taken = await this.nameTaken(shard.id, nameKey(normalized), principal.accountId);
    return taken
      ? { valid: false, normalized, violations: ['taken'] }
      : { valid: true, normalized, violations: [] };
  }

  async create(
    principal: Principal,
    shardId: string,
    input: CreateInput,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ) {
    const shard = await this.shards.visible(shardId, principal);
    let idemKey: string | null = null;
    const bodyHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if (idempotencyKey !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(idempotencyKey)) {
        throw new IdentityError(
          'IDEMPOTENCY_KEY_INVALID',
          'Idempotency-Key: 1–64 символа [A-Za-z0-9_-]',
        );
      }
      idemKey = `identity:idem:char:${principal.accountId}:${shard.id}:${createHash('sha256').update(idempotencyKey).digest('hex')}`;
      const cached = await this.id.kv.get(idemKey);
      if (cached) {
        const { hash, response } = JSON.parse(cached) as { hash: string; response: unknown };
        if (hash !== bodyHash)
          throw new IdentityError('IDEMPOTENCY_KEY_REUSED', 'ключ уже использован с другим телом');
        return response as ReturnType<CharacterService['view']>;
      }
    }
    if (!shard.creationOpen)
      throw new IdentityError('CHAR_CREATION_CLOSED', 'создание героев закрыто');
    const unlimited = hasAccess(principal.acl, 'administrator');
    const rateKey = `char-create:${principal.accountId}:${shard.id}`;
    if (!unlimited) {
      const state = await peek(this.id.kv, rateKey, DAY, this.id.now());
      if (state.count >= CREATIONS_PER_DAY) {
        throw new IdentityError('CHAR_CREATION_RATE_LIMITED', 'не больше 3 героев в сутки', {
          retryAfterS: state.retryAfterS,
        });
      }
    }
    const profile = this.shards.profile(shard);
    const name = this.checkName(input.name);
    let stats = input.stats;
    let skills = input.skills;
    let background: string | null = null;
    if (input.background !== undefined) {
      const preset = BACKGROUNDS.find((b) => b.key === input.background);
      if (
        !preset ||
        creationStatViolations(profile, preset.stats).length > 0 ||
        startSkillViolations(profile, preset.skills).length > 0
      ) {
        throw new IdentityError('CHAR_INVALID_BACKGROUND', 'предыстория недоступна на шарде');
      }
      stats = { ...preset.stats };
      skills = preset.skills.map((s) => ({ ...s }));
      background = preset.key;
    }
    if (!stats || !skills) {
      throw new IdentityError(
        'CHAR_VALIDATION_FAILED',
        'нужна предыстория или характеристики с навыками',
      );
    }
    const statErrors = creationStatViolations(profile, stats);
    if (statErrors.length)
      throw new IdentityError('CHAR_INVALID_STATS', 'характеристики', {
        details: { errors: statErrors },
      });
    const skillErrors = startSkillViolations(profile, skills);
    if (skillErrors.length)
      throw new IdentityError('CHAR_INVALID_SKILLS', 'навыки', {
        details: { errors: skillErrors },
      });
    const looks = appearanceViolations(input.appearance);
    if (looks.length)
      throw new IdentityError('CHAR_INVALID_APPEARANCE', 'внешность', {
        details: { fields: looks },
      });
    const city = startCity(input.startCity);
    if (!city || !shard.startCities.includes(city.key)) {
      throw new IdentityError('CHAR_INVALID_START_CITY', 'город недоступен на шарде');
    }
    const key = nameKey(name);
    const now = this.id.now();
    const finalStats = stats;
    const finalSkills = skills;
    const record = await this.store.transaction(async (store) => {
      await store.lockAccountShard(principal.accountId, shard.id);
      const mine = await store.listCharacters(principal.accountId, shard.id);
      if (mine.length >= (await this.quota(principal.accountId, shard))) {
        throw new IdentityError('CHAR_SLOTS_FULL', 'все слоты заняты');
      }
      if (await this.nameTaken(shard.id, key, principal.accountId)) {
        throw new IdentityError('CHAR_NAME_TAKEN', 'имя занято');
      }
      const used = new Set(mine.map((c) => c.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const created: CharacterRecord = {
        id: this.id.id(),
        shardId: shard.id,
        accountId: principal.accountId,
        entityId: makeEntityId('hero', await store.nextHeroNumber(shard.id)),
        slot,
        name,
        nameKey: key,
        status: 'active',
        stats: { ...finalStats },
        skills: finalSkills.map((s) => ({ ...s })),
        appearance: { ...input.appearance },
        background,
        startCity: city.key,
        realm: city.realm,
        x: city.x,
        y: city.y,
        h: city.h,
        starterLoadout: starterLoadout(finalSkills),
        createdAt: now,
        lastPlayedAt: null,
        deleteAt: null,
        deletedAt: null,
        statusBeforeDeletion: null,
        renamedAt: null,
        lockReason: null,
      };
      try {
        await store.insertCharacter(created);
      } catch (error) {
        if (String(error).includes('name'))
          throw new IdentityError('CHAR_NAME_TAKEN', 'имя занято');
        throw new IdentityError('CHAR_SLOTS_FULL', 'слот занят параллельным запросом');
      }
      return created;
    });
    if (!unlimited) await hit(this.id.kv, rateKey, DAY, now);
    const response = this.view(record);
    if (idemKey)
      await this.id.kv.set(
        idemKey,
        JSON.stringify({ hash: bodyHash, response }),
        IDEMPOTENCY_TTL_MS,
      );
    await this.id.store.transaction((s) =>
      this.id.securityEvent(
        s,
        principal.accountId,
        'character_created',
        'success',
        meta,
        record.id,
      ),
    );
    return response;
  }

  async list(principal: Principal, shardId: string) {
    const shard = await this.shards.visible(shardId, principal);
    const characters = await this.store.listCharacters(principal.accountId, shard.id);
    return {
      characters: characters.map((c) => this.view(c)),
      slots: { used: characters.length, total: await this.quota(principal.accountId, shard) },
    };
  }

  /** Свой герой на этом шарде; иначе «не найден». */
  async owned(
    principal: Principal,
    shardId: string,
    characterId: string,
  ): Promise<CharacterRecord> {
    const c = await this.store.findCharacter(characterId);
    if (
      !c ||
      c.accountId !== principal.accountId ||
      c.shardId !== shardId ||
      c.status === 'deleted'
    ) {
      throw new IdentityError('CHAR_NOT_FOUND', 'герой не найден');
    }
    return c;
  }

  private async assertOffline(c: CharacterRecord) {
    const session = await this.live.session(c.shardId, c.accountId);
    if (session?.characterId === c.id)
      throw new IdentityError('CHAR_IN_WORLD', 'герой сейчас в мире');
  }

  async remove(
    principal: Principal,
    shardId: string,
    characterId: string,
    confirmName: string,
    meta: RequestMeta,
  ) {
    const c = await this.owned(principal, shardId, characterId);
    if (c.status === 'pending_deletion')
      throw new IdentityError('CHAR_PENDING_DELETION', 'уже в очереди удаления');
    if (normalizeName(confirmName) !== c.name) {
      throw new IdentityError('CHAR_NAME_CONFIRMATION_MISMATCH', 'подтвердите имя героя');
    }
    await this.assertOffline(c);
    for (const guard of this.guards) {
      const reason = await guard.check(c);
      if (reason)
        throw new IdentityError('CHAR_DELETION_BLOCKED', 'удаление заблокировано', {
          details: { reason },
        });
    }
    const now = this.id.now();
    const total = c.skills.reduce((s, k) => s + k.tenths, 0);
    const deleteAt = now + deletionGraceMs(now - c.createdAt, total);
    await this.store.updateCharacter(c.id, {
      status: 'pending_deletion',
      statusBeforeDeletion: c.status,
      deleteAt,
    });
    await this.live.revoke('char', c.id, now);
    await this.id.store.transaction((s) =>
      this.id.securityEvent(
        s,
        principal.accountId,
        'character_delete_requested',
        'success',
        meta,
        c.id,
      ),
    );
    return this.view({ ...c, status: 'pending_deletion', deleteAt });
  }

  async cancelDeletion(principal: Principal, shardId: string, characterId: string) {
    const c = await this.owned(principal, shardId, characterId);
    if (c.status !== 'pending_deletion' || (c.deleteAt ?? 0) <= this.id.now()) {
      throw new IdentityError('CHAR_NOT_PENDING_DELETION', 'герой не в очереди удаления');
    }
    const status = c.statusBeforeDeletion ?? 'active';
    await this.store.updateCharacter(c.id, { status, statusBeforeDeletion: null, deleteAt: null });
    return this.view({ ...c, status, deleteAt: null });
  }

  /** Финализация удалений с истёкшим сроком; повторный запуск ничего не меняет. */
  async finalizeDue(): Promise<number> {
    const now = this.id.now();
    let done = 0;
    for (const c of await this.store.dueDeletions(now)) {
      await this.store.transaction(async (store) => {
        const fresh = await store.findCharacter(c.id);
        if (fresh?.status !== 'pending_deletion') return;
        await store.updateCharacter(c.id, { status: 'deleted', deletedAt: now });
        const total = c.skills.reduce((s, k) => s + k.tenths, 0);
        if (isDeveloped(now - c.createdAt, total)) {
          await store.putNameHold({
            shardId: c.shardId,
            nameKey: c.nameKey,
            accountId: c.accountId,
            until: now + NAME_HOLD_MS,
          });
        }
        done++;
      });
    }
    return done;
  }

  private async applyRename(c: CharacterRecord, rawName: string, reason: string, by: string) {
    const name = this.checkName(rawName);
    const key = nameKey(name);
    await this.store.transaction(async (store) => {
      if (await this.nameTaken(c.shardId, key, c.accountId, c.id))
        throw new IdentityError('CHAR_NAME_TAKEN', 'имя занято');
      const now = this.id.now();
      try {
        await store.updateCharacter(c.id, {
          name,
          nameKey: key,
          renamedAt: now,
          status: c.status === 'rename_required' ? 'active' : c.status,
        });
      } catch {
        throw new IdentityError('CHAR_NAME_TAKEN', 'имя занято');
      }
      await store.insertNameHistory({
        id: this.id.id(),
        characterId: c.id,
        oldName: c.name,
        newName: name,
        reason,
        changedBy: by,
        at: now,
      });
    });
    return name;
  }

  async rename(principal: Principal, shardId: string, characterId: string, newName: string) {
    const c = await this.owned(principal, shardId, characterId);
    const shard = await this.shards.visible(shardId, principal);
    await this.assertOffline(c);
    if (c.status === 'locked' || c.status === 'pending_deletion') {
      throw new IdentityError(
        c.status === 'locked' ? 'CHAR_LOCKED' : 'CHAR_PENDING_DELETION',
        'переименование недоступно',
      );
    }
    if (c.status !== 'rename_required') {
      if (shard.renamePolicy === 'disabled')
        throw new IdentityError('CHAR_RENAME_DISABLED', 'переименование выключено на шарде');
      if (shard.renamePolicy === 'cooldown' && c.renamedAt !== null) {
        const left = c.renamedAt + RENAME_COOLDOWN_MS - this.id.now();
        if (left > 0)
          throw new IdentityError('CHAR_RENAME_COOLDOWN', 'переименование раз в 30 суток', {
            retryAfterS: Math.ceil(left / 1000),
          });
      }
    }
    await this.applyRename(
      c,
      newName,
      c.status === 'rename_required' ? 'required' : 'voluntary',
      principal.accountId,
    );
    return this.view((await this.store.findCharacter(c.id)) as CharacterRecord);
  }

  history(characterId: string) {
    return this.store.listNameHistory(characterId);
  }

  private async staffTarget(
    principal: Principal,
    characterId: string,
    permission: 'character.manage' | 'character.restore',
    meta: RequestMeta,
  ) {
    const actor = await this.staff.authorize(principal, permission, permission, meta);
    const c = await this.store.findCharacter(characterId);
    if (!c) throw new IdentityError('CHAR_NOT_FOUND', 'герой не найден');
    return { actor, c };
  }

  private async staffAudit(
    actorId: string,
    c: CharacterRecord,
    action: string,
    reason: string | null,
    meta: RequestMeta,
    event?: string,
  ) {
    await this.id.store.transaction(async (s) => {
      await this.id.audit(
        s,
        {
          actorId,
          targetId: c.accountId,
          action,
          outcome: 'allowed',
          before: { characterId: c.id, status: c.status },
          after: null,
          reason,
        },
        meta,
      );
      if (event)
        await this.id.publish(s, event, {
          shardId: c.shardId,
          characterId: c.id,
          accountId: c.accountId,
          reason,
        });
    });
  }

  async requireRename(
    principal: Principal,
    characterId: string,
    rawReason: string,
    meta: RequestMeta,
  ) {
    const reason = reasonOf(rawReason);
    const { actor, c } = await this.staffTarget(principal, characterId, 'character.manage', meta);
    if (c.status === 'deleted') throw new IdentityError('CHAR_NOT_FOUND', 'герой не найден');
    await this.store.updateCharacter(c.id, { status: 'rename_required' });
    await this.live.revoke('char', c.id, this.id.now());
    await this.staffAudit(
      actor.id,
      c,
      'character.rename_required',
      reason,
      meta,
      'character.rename_required',
    );
  }

  async lock(principal: Principal, characterId: string, rawReason: string, meta: RequestMeta) {
    const reason = reasonOf(rawReason);
    const { actor, c } = await this.staffTarget(principal, characterId, 'character.manage', meta);
    if (c.status === 'deleted') throw new IdentityError('CHAR_NOT_FOUND', 'герой не найден');
    await this.store.updateCharacter(c.id, {
      status: 'locked',
      lockReason: reason,
      statusBeforeDeletion: null,
    });
    await this.live.revoke('char', c.id, this.id.now());
    await this.staffAudit(actor.id, c, 'character.lock', reason, meta, 'character.locked');
  }

  async unlock(principal: Principal, characterId: string, rawReason: string, meta: RequestMeta) {
    const reason = reasonOf(rawReason);
    const { actor, c } = await this.staffTarget(principal, characterId, 'character.manage', meta);
    if (c.status !== 'locked') throw new IdentityError('CHAR_NOT_FOUND', 'герой не заблокирован');
    await this.store.updateCharacter(c.id, { status: 'active', lockReason: null });
    await this.staffAudit(actor.id, c, 'character.unlock', reason, meta);
  }

  async restoreDeleted(
    principal: Principal,
    characterId: string,
    rawReason: string,
    meta: RequestMeta,
  ) {
    const reason = reasonOf(rawReason);
    const { actor, c } = await this.staffTarget(principal, characterId, 'character.restore', meta);
    if (c.status !== 'deleted' || c.deletedAt === null)
      throw new IdentityError('CHAR_NOT_FOUND', 'герой не удалён');
    if (this.id.now() - c.deletedAt > RESTORE_WINDOW_MS)
      throw new IdentityError('CHAR_RESTORE_EXPIRED', 'срок хранения истёк');
    const shard = await this.store.findShard(c.shardId);
    if (!shard) throw new IdentityError('SHARD_NOT_FOUND', 'шард не найден');
    await this.store.transaction(async (store) => {
      await store.lockAccountShard(c.accountId, c.shardId);
      const mine = await store.listCharacters(c.accountId, c.shardId);
      if (mine.length >= (await this.quota(c.accountId, shard)))
        throw new IdentityError('CHAR_SLOTS_FULL', 'нет свободного слота');
      const used = new Set(mine.map((m) => m.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      const taken = await this.nameTaken(c.shardId, c.nameKey, c.accountId, c.id);
      await store.updateCharacter(c.id, {
        status: taken ? 'rename_required' : 'active',
        slot,
        deletedAt: null,
        deleteAt: null,
        statusBeforeDeletion: null,
        ...(taken ? { nameKey: `restored:${c.id.slice(0, 20)}` } : {}),
      });
    });
    await this.staffAudit(actor.id, c, 'character.restore', reason, meta);
    return this.view((await this.store.findCharacter(c.id)) as CharacterRecord);
  }
}
