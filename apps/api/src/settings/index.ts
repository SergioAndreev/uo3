import { accountClientProfiles, type Database } from '@duskmarch/db';
import {
  PROFILE_CATEGORIES,
  PROFILE_MAX_BYTES,
  PROFILE_SCHEMA_VERSION,
  PROFILE_WRITES_PER_MINUTE,
  applyPatch,
  defaultProfile,
  profileErrors,
  type ClientProfile,
  type ClientProfileEnvelope,
  type ClientProfilePatch,
  type ProfileCategory,
} from '@duskmarch/protocol';
import { and, eq } from 'drizzle-orm';
import { IdentityError } from '../identity/core/errors.js';
import type { IdentityServices, Principal } from '../identity/core/index.js';
import { hit } from '../identity/core/rate-limit.js';

interface StoredProfile {
  revision: number;
  profile: ClientProfile;
  updatedAt: Date;
}

/** Хранилище профилей; `save` — `null` при несовпадении ревизии. */
export interface ProfileStore {
  get(accountId: string): Promise<StoredProfile | null>;
  save(
    accountId: string,
    expectedRevision: number,
    profile: ClientProfile,
    now: Date,
  ): Promise<StoredProfile | null>;
}

export class MemoryProfileStore implements ProfileStore {
  private readonly rows = new Map<string, StoredProfile>();
  async get(accountId: string) {
    return this.rows.get(accountId) ?? null;
  }
  async save(accountId: string, expected: number, profile: ClientProfile, now: Date) {
    const current = this.rows.get(accountId)?.revision ?? 1;
    if (current !== expected) return null;
    const row = { revision: expected + 1, profile, updatedAt: now };
    this.rows.set(accountId, row);
    return row;
  }
}

export class DrizzleProfileStore implements ProfileStore {
  constructor(private readonly db: Database) {}

  async get(accountId: string) {
    const [row] = await this.db
      .select()
      .from(accountClientProfiles)
      .where(eq(accountClientProfiles.accountId, accountId));
    return row
      ? { revision: row.revision, profile: row.profile as ClientProfile, updatedAt: row.updatedAt }
      : null;
  }

  async save(accountId: string, expected: number, profile: ClientProfile, now: Date) {
    const values = {
      accountId,
      schemaVersion: PROFILE_SCHEMA_VERSION,
      revision: expected + 1,
      profile,
      updatedAt: now,
    };
    // Ревизия 1 — профиль по умолчанию без строки: первая запись — вставка.
    const rows =
      expected === 1
        ? await this.db
            .insert(accountClientProfiles)
            .values(values)
            .onConflictDoNothing()
            .returning()
        : await this.db
            .update(accountClientProfiles)
            .set(values)
            .where(
              and(
                eq(accountClientProfiles.accountId, accountId),
                eq(accountClientProfiles.revision, expected),
              ),
            )
            .returning();
    const row = rows[0];
    return row
      ? { revision: row.revision, profile: row.profile as ClientProfile, updatedAt: row.updatedAt }
      : null;
  }
}

export const etagOf = (revision: number): string => `"rev-${revision}"`;

/** Ревизия из `If-Match` или тела; без неё — конфликт. */
export function expectedRevisionOf(
  ifMatch: string | undefined,
  body: number | undefined,
): number | undefined {
  const m = ifMatch ? /^"rev-(\d+)"$/.exec(ifMatch.trim()) : null;
  if (m) return Number(m[1]);
  return body;
}

/** Профиль настроек клиента аккаунта: ревизии, размер, частота записи, сброс. */
export class ProfileService {
  constructor(
    private readonly identity: IdentityServices,
    private readonly store: ProfileStore,
  ) {}

  private envelope(row: StoredProfile | null): ClientProfileEnvelope {
    return row
      ? { revision: row.revision, updatedAt: row.updatedAt.toISOString(), profile: row.profile }
      : { revision: 1, updatedAt: new Date(0).toISOString(), profile: defaultProfile() };
  }

  async get(principal: Principal): Promise<ClientProfileEnvelope> {
    return this.envelope(await this.store.get(principal.accountId));
  }

  private async limit(principal: Principal): Promise<void> {
    const state = await hit(
      this.identity.identity.kv,
      `profile:${principal.accountId}`,
      60_000,
      this.identity.identity.now(),
    );
    if (state.count > PROFILE_WRITES_PER_MINUTE) {
      throw new IdentityError('PROFILE_RATE_LIMITED', 'слишком частая запись профиля', {
        retryAfterS: state.retryAfterS,
      });
    }
  }

  private async write(
    principal: Principal,
    expected: number | undefined,
    build: (current: ClientProfile) => ClientProfile,
  ) {
    await this.limit(principal);
    const current = this.envelope(await this.store.get(principal.accountId));
    if (expected === undefined || expected !== current.revision) {
      throw new IdentityError('PROFILE_REVISION_CONFLICT', 'профиль изменён на другом устройстве', {
        details: { current },
      });
    }
    const next = build(current.profile);
    const fields = profileErrors(next);
    if (fields.length > 0)
      throw new IdentityError('PROFILE_VALIDATION_FAILED', 'профиль вне границ схемы', {
        details: { fields },
      });
    if (Buffer.byteLength(JSON.stringify(next)) > PROFILE_MAX_BYTES) {
      throw new IdentityError('PROFILE_PAYLOAD_TOO_LARGE', 'профиль больше 64 КиБ');
    }
    const saved = await this.store.save(
      principal.accountId,
      expected,
      next,
      new Date(this.identity.identity.now()),
    );
    if (!saved) {
      throw new IdentityError('PROFILE_REVISION_CONFLICT', 'профиль изменён на другом устройстве', {
        details: { current: this.envelope(await this.store.get(principal.accountId)) },
      });
    }
    return this.envelope(saved);
  }

  put(principal: Principal, expected: number | undefined, profile: unknown) {
    return this.write(principal, expected, () => profile as ClientProfile);
  }

  patch(
    principal: Principal,
    expected: number | undefined,
    changes: ClientProfilePatch['changes'],
  ) {
    return this.write(principal, expected, (current) => applyPatch(current, changes));
  }

  reset(
    principal: Principal,
    expected: number | undefined,
    categories: readonly ProfileCategory[] = PROFILE_CATEGORIES,
  ) {
    return this.write(principal, expected, (current) => {
      const defaults = defaultProfile();
      const next = JSON.parse(JSON.stringify(current)) as ClientProfile;
      for (const c of categories) (next as unknown as Record<string, unknown>)[c] = defaults[c];
      return next;
    });
  }
}
