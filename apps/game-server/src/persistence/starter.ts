import type { EntityId, Slot } from '@duskmarch/domain';
import type { Entity } from '../engine/partition.js';
import type { CriticalTx, PlannedLedger } from './critical.js';

export interface StarterEntry {
  key: string;
  count: number;
  slot?: Slot;
}

const item = (
  id: EntityId,
  contentKey: string,
  amount: number,
  placement: Entity['placement'],
  hero: EntityId,
): Entity => ({
  id,
  kind: 'item',
  placement,
  player: false,
  height: 0,
  blocksSight: false,
  behaviors: [],
  data: {
    contentKey,
    amount,
    components: {},
    schemaVersion: 1,
    entityVersion: 0,
    rootOwnerId: hero,
  },
});

/**
 * Однократная выдача стартового набора P05: предметы со слотом надеваются, остальные — в мешок (`pack`).
 * Флаг героя ставится в той же транзакции; повтор по ключу идемпотентности ничего не создаёт.
 */
export function starterTx(
  hero: EntityId,
  characterId: string,
  loadout: readonly StarterEntry[],
): CriticalTx {
  return {
    type: 'STARTER_LOADOUT_GRANT',
    idempotencyKey: `starter:${characterId}`,
    grantStarterFor: characterId,
    participants: [],
    payload: { characterId, loadout: loadout.map((e) => [e.key, e.count, e.slot ?? null]) },
    plan: (_get, newId) => {
      const upserts: Entity[] = [];
      const pack = loadout.find((e) => e.slot === 'pack');
      const packId = pack ? newId('item') : null;
      if (pack && packId)
        upserts.push(
          item(packId, pack.key, 1, { kind: 'equipped', holder: hero, slot: 'pack' }, hero),
        );
      for (const e of loadout) {
        if (e === pack) continue;
        if (!e.slot && !packId) throw new Error('в стартовом наборе нет мешка (слот pack)');
        const placement: Entity['placement'] = e.slot
          ? { kind: 'equipped', holder: hero, slot: e.slot }
          : { kind: 'container', parent: packId as EntityId };
        upserts.push(item(newId('item'), e.key, e.count, placement, hero));
      }
      const minted: Record<string, number> = {};
      for (const e of upserts)
        minted[e.data!.contentKey] = (minted[e.data!.contentKey] ?? 0) + e.data!.amount;
      const ledger: PlannedLedger[] = upserts.map((e) => ({
        eventKind: 'CREATE',
        itemId: e.id,
        amountDelta: e.data!.amount,
        toOwnerId: hero,
        toParentId: e.placement.kind === 'container' ? e.placement.parent : hero,
        characterId,
      }));
      return { upserts, deletes: [], minted, ledger, result: { items: upserts.map((e) => e.id) } };
    },
  };
}
