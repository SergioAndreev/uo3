import { canonicalEmail } from './core/email.js';
import { uuidv7, type Entropy } from './crypto/random.js';
import type { IdentityStore } from './ports.js';

export type BootstrapResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: 'owner_exists' | 'account_not_found' | 'invalid_email' };

/**
 * Первый владелец шарда: повышает существующий подтверждённый аккаунт.
 * Отказывает, если владелец уже есть, — дальше уровни назначает он сам.
 */
export async function bootstrapOwner(
  store: IdentityStore,
  rawEmail: string,
  now: number,
  entropy: Entropy,
): Promise<BootstrapResult> {
  const email = canonicalEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid_email' };
  return store.transaction(async (tx) => {
    await tx.lockOwners();
    if ((await tx.listAccountsByLevel('owner')).length > 0)
      return { ok: false, reason: 'owner_exists' };
    const account = await tx.findAccountByEmail(email);
    if (account?.status !== 'active') return { ok: false, reason: 'account_not_found' };
    await tx.updateAccount(account.id, {
      accessLevel: 'owner',
      effectiveLevel: 'owner',
      updatedAt: now,
    });
    await tx.revokeSessions(account.id, 'access_level_changed', now);
    await tx.insertAudit({
      id: uuidv7(now, entropy),
      actorId: account.id,
      targetId: account.id,
      action: 'access_level.bootstrap',
      outcome: 'allowed',
      before: { level: account.accessLevel },
      after: { level: 'owner' },
      reason: 'первый владелец шарда (CLI)',
      ip: 'cli',
      userAgent: 'identity:bootstrap-owner',
      at: now,
    });
    return { ok: true, accountId: account.id };
  });
}
