import { createHash } from 'node:crypto';
import { hasAccess, isStaff, type AccessLevel } from '@duskmarch/domain';
import { buildProfile, fingerprint, type Profile } from '@duskmarch/rules';
import { startCity } from '@duskmarch/content';
import {
  IdentityError,
  type Identity,
  type Principal,
  type RequestMeta,
  type StaffService,
} from '../identity/core/index.js';
import type { GameStore, LivePort, ShardLive, ShardRecord } from './ports.js';
import { isValidRange, parseVersion, satisfies, type Version } from './semver.js';

export type EffectiveStatus =
  'online' | 'degraded' | 'offline' | 'maintenance' | 'draining' | 'unknown';
export type Load = 'low' | 'medium' | 'high' | 'full' | 'unknown';

/** Тик дольше этого — шард деградирован. */
export const DEGRADED_TICK_MS = 75;

export interface ShardView {
  shard: ShardRecord;
  live: ShardLive | null;
  status: EffectiveStatus;
  online: number | null;
  load: Load;
  /** Онлайн с резервами достиг `hardCapacity`. */
  full: boolean;
}

export interface Viewer {
  principal: Principal | null;
  protocol: Version | null;
}

/** Каталог шардов и их живое состояние. */
export class ShardService {
  private readonly profiles = new Map<string, Profile>();

  constructor(
    private readonly id: Identity,
    private readonly store: GameStore,
    private readonly live: LivePort,
    private readonly staff: StaffService,
  ) {}

  profile(shard: ShardRecord): Profile {
    const key = `${shard.preset}:${JSON.stringify(shard.rulesetOverride)}`;
    let profile = this.profiles.get(key);
    if (!profile)
      this.profiles.set(key, (profile = buildProfile(shard.preset, shard.rulesetOverride)));
    return profile;
  }

  /** Разбор `X-Duskmarch-Protocol`; отсутствие заголовка — `null`. */
  protocol(header: string | undefined): Version | null {
    if (header === undefined) return null;
    const version = parseVersion(header);
    if (!version)
      throw new IdentityError('SHARD_PROTOCOL_HEADER_INVALID', 'ожидается semver x.y.z');
    return version;
  }

  private canSee(shard: ShardRecord, principal: Principal | null, direct: boolean): boolean {
    if (shard.visibility === 'staff')
      return principal !== null && isStaff(principal.acl) && principal.mfa;
    return shard.visibility === 'public' || direct;
  }

  async view(shard: ShardRecord): Promise<ShardView> {
    const now = this.id.now();
    let live: ShardLive | null = null;
    try {
      live = await this.live.read(shard.id, now);
    } catch {
      live = null;
    }
    let status: EffectiveStatus;
    if (shard.manualStatus === 'maintenance') status = 'maintenance';
    else if (shard.manualStatus === 'draining') status = 'draining';
    else if (live === null) status = 'unknown';
    else if (live.nodes.length === 0) status = 'offline';
    else if (live.nodes.every((n) => n.draining)) status = 'draining';
    else if (live.nodes.some((n) => n.tickP99Ms > DEGRADED_TICK_MS)) status = 'degraded';
    else status = 'online';
    const online = live ? live.nodes.reduce((sum, n) => sum + n.onlineCount, 0) : null;
    let load: Load = 'unknown';
    let full = false;
    if (live && online !== null) {
      let reserved = 0;
      for (const p of live.partitions)
        reserved += await this.live.reserved(shard.id, p.roomId, now);
      const ratio = (online + reserved) / shard.softCapacity;
      full = online + reserved >= shard.hardCapacity;
      load = full || ratio >= 1 ? 'full' : ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'medium' : 'low';
    }
    return { shard, live, status, online, load, full };
  }

  /** Причина, по которой уровень не может войти; `null` — вход открыт. */
  entryBlocked(view: ShardView, level: AccessLevel): string | null {
    if (view.status === 'draining') return 'draining';
    if (view.status === 'maintenance')
      return hasAccess(level, 'game-master') ? null : 'maintenance';
    if (view.status === 'offline') return 'offline';
    if (view.shard.visibility === 'staff' && !isStaff(level)) return 'staff_only';
    if (view.full && !isStaff(level)) return 'full';
    return null;
  }

  summary(view: ShardView, viewer: Viewer, myCharacters?: number) {
    const { shard } = view;
    const profile = this.profile(shard);
    const level = viewer.principal?.acl ?? 'player';
    const blocked = viewer.principal ? this.entryBlocked(view, level) : null;
    return {
      id: shard.id,
      name: shard.name,
      region: shard.region,
      preset: shard.preset,
      realms: profile.realms.map((r) => ({ key: r.key, name: r.name, pvp: r.pvp })),
      characterSlots: shard.characterSlots,
      status: view.status,
      load: view.load,
      onlineCount: view.online,
      protocolRange: shard.protocolRange,
      ...(viewer.protocol ? { compatible: satisfies(viewer.protocol, shard.protocolRange) } : {}),
      ...(viewer.principal
        ? {
            myCharacters: myCharacters ?? 0,
            canEnter: blocked === null,
            ...(blocked ? { entryBlockedReason: blocked } : {}),
          }
        : {}),
    };
  }

  async list(viewer: Viewer) {
    const shards = (await this.store.listShards())
      .filter((s) => s.archivedAt === null && this.canSee(s, viewer.principal, false))
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1));
    const items = [];
    for (const shard of shards) {
      const mine = viewer.principal
        ? (await this.store.listCharacters(viewer.principal.accountId, shard.id)).length
        : undefined;
      items.push(this.summary(await this.view(shard), viewer, mine));
    }
    const degraded = items.some((i) => i.status === 'unknown');
    const etag = `W/"${createHash('sha256').update(JSON.stringify(items)).digest('base64url').slice(0, 22)}"`;
    return { items, etag, degraded };
  }

  /** Шард, видимый запросу; иначе `SHARD_NOT_FOUND`. */
  async visible(id: string, principal: Principal | null): Promise<ShardRecord> {
    const shard = await this.store.findShard(id);
    if (!shard || shard.archivedAt !== null || !this.canSee(shard, principal, true)) {
      throw new IdentityError('SHARD_NOT_FOUND', 'шард не найден');
    }
    return shard;
  }

  async card(id: string, viewer: Viewer) {
    const shard = await this.visible(id, viewer.principal);
    const view = await this.view(shard);
    const profile = this.profile(shard);
    const mine = viewer.principal
      ? (await this.store.listCharacters(viewer.principal.accountId, shard.id)).length
      : undefined;
    return {
      ...this.summary(view, viewer, mine),
      rules: {
        preset: profile.preset,
        version: profile.version,
        fingerprint: fingerprint(profile),
        features: profile.features,
        creationOpen: shard.creationOpen,
        renamePolicy: shard.renamePolicy,
      },
      startCities: shard.startCities.map((key) => ({ key, name: startCity(key)?.name ?? key })),
      maintenance:
        shard.manualStatus === 'maintenance'
          ? {
              etaAt: shard.maintenanceEta === null ? null : this.id.iso(shard.maintenanceEta),
              message: shard.maintenanceMessage,
            }
          : null,
    };
  }

  private async authorizeAdmin(principal: Principal, meta: RequestMeta) {
    return this.staff.authorize(principal, 'shard.manage', 'shard.manage', meta);
  }

  private check(shard: ShardRecord) {
    if (!isValidRange(shard.protocolRange)) {
      throw new IdentityError('SHARD_VALIDATION_FAILED', 'некорректный protocolRange');
    }
    if (shard.softCapacity > shard.hardCapacity) {
      throw new IdentityError('SHARD_VALIDATION_FAILED', 'softCapacity больше hardCapacity');
    }
    try {
      const profile = this.profile(shard);
      const realms = new Set(profile.realms.map((r) => r.key));
      for (const key of shard.startCities) {
        const city = startCity(key);
        if (!city || !realms.has(city.realm)) {
          throw new IdentityError(
            'SHARD_VALIDATION_FAILED',
            `город ${key} не подходит профилю шарда`,
          );
        }
      }
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError('SHARD_VALIDATION_FAILED', 'некорректное переопределение профиля', {
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  async create(
    principal: Principal,
    input: Partial<ShardRecord> & Pick<ShardRecord, 'id' | 'name' | 'region' | 'preset'>,
    meta: RequestMeta,
  ) {
    const actor = await this.authorizeAdmin(principal, meta);
    const now = this.id.now();
    const shard: ShardRecord = {
      rulesetOverride: {},
      visibility: 'public',
      manualStatus: 'normal',
      maintenanceEta: null,
      maintenanceMessage: null,
      creationOpen: true,
      characterSlots: 5,
      renamePolicy: 'cooldown',
      ticketTtlS: 30,
      softCapacity: 1000,
      hardCapacity: 1200,
      staffBuffer: 20,
      protocolRange: '>=0.1.0 <1.0.0',
      startCities: input.preset === 'proving' ? ['proving-camp'] : ['lad', 'kremnev', 'solyar'],
      sortOrder: 100,
      ...input,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.check(shard);
    if (await this.store.findShard(shard.id))
      throw new IdentityError('SHARD_ALREADY_EXISTS', 'шард уже существует');
    await this.store.transaction((store) => store.insertShard(shard));
    await this.id.store.transaction((store) =>
      this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: null,
          action: 'shard.create',
          outcome: 'allowed',
          before: null,
          after: { id: shard.id, preset: shard.preset },
          reason: null,
        },
        meta,
      ),
    );
    return this.card(shard.id, { principal, protocol: null });
  }

  async update(principal: Principal, id: string, patch: Partial<ShardRecord>, meta: RequestMeta) {
    const actor = await this.authorizeAdmin(principal, meta);
    const shard = await this.store.findShard(id);
    if (!shard) throw new IdentityError('SHARD_NOT_FOUND', 'шард не найден');
    const next = { ...shard, ...patch, updatedAt: this.id.now() };
    this.check(next);
    const rulesChanged =
      next.preset !== shard.preset ||
      JSON.stringify(next.rulesetOverride) !== JSON.stringify(shard.rulesetOverride);
    if (rulesChanged && (await this.store.countCharacters(id)) > 0) {
      throw new IdentityError('SHARD_RULES_LOCKED', 'на шарде уже есть герои');
    }
    await this.store.updateShard(id, { ...patch, updatedAt: next.updatedAt });
    await this.id.store.transaction(async (store) => {
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: null,
          action: 'shard.update',
          outcome: 'allowed',
          before: { id },
          after: patch,
          reason: null,
        },
        meta,
      );
      await this.id.publish(store, `shard.${id}.config_updated`, { shardId: id });
    });
    return this.card(id, { principal, protocol: null });
  }

  /** Обслуживание и дренаж: событие, отзыв билетов игроков. */
  async setStatus(
    principal: Principal,
    id: string,
    input: {
      status: ShardRecord['manualStatus'];
      etaAt?: string | undefined;
      message?: string | undefined;
    },
    meta: RequestMeta,
  ) {
    const actor = await this.authorizeAdmin(principal, meta);
    const shard = await this.store.findShard(id);
    if (!shard) throw new IdentityError('SHARD_NOT_FOUND', 'шард не найден');
    const eta = input.etaAt === undefined ? null : Date.parse(input.etaAt);
    await this.store.updateShard(id, {
      manualStatus: input.status,
      maintenanceEta: input.status === 'maintenance' ? eta : null,
      maintenanceMessage: input.status === 'maintenance' ? (input.message ?? null) : null,
      updatedAt: this.id.now(),
    });
    if (input.status !== 'normal') await this.live.revoke('shard', id, this.id.now());
    await this.id.store.transaction(async (store) => {
      await this.id.audit(
        store,
        {
          actorId: actor.id,
          targetId: null,
          action: 'shard.status',
          outcome: 'allowed',
          before: { status: shard.manualStatus },
          after: { status: input.status },
          reason: input.message ?? null,
        },
        meta,
      );
      await this.id.publish(store, `shard.${id}.status_changed`, {
        shardId: id,
        status: input.status,
      });
    });
    return this.card(id, { principal, protocol: null });
  }
}
