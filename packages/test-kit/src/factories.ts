import {
  DAWN,
  IdAllocator,
  InMemoryIdLeaseProvider,
  SeededRng,
  position,
  type Position,
  type RealmId,
  type WorldEntityKind,
} from '@duskmarch/domain';
import { buildProfile, type Preset, type Profile } from '@duskmarch/rules';

export const TEST_SEED = 20261126;

/** ГПСЧ теста: сид по имени теста делает падения воспроизводимыми. */
export const testRng = (name = 'test'): SeededRng => new SeededRng(`${TEST_SEED}:${name}`);

/** Аллокатор, готовый к синхронной выдаче. */
export async function testAllocator(leaseSize = 4_096): Promise<IdAllocator> {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize });
  await allocator.ready();
  return allocator;
}

/** Последовательные идентификаторы одного вида без аллокатора. */
export function idSequence<K extends WorldEntityKind>(kind: K, start = 1) {
  const codes = { hero: 1, creature: 2, item: 3, structure: 4 } as const;
  let seq = start;
  return () => ((codes[kind] << 29) | seq++) >>> 0;
}

/** Случайная позиция внутри квадрата плана. */
export const randomPosition = (rng: SeededRng, realm: RealmId = DAWN, size = 64, h = 0): Position =>
  position(realm, rng.int(0, size - 1), rng.int(0, size - 1), h);

export const testProfile = (preset: Preset = 'proving', override: unknown = {}): Profile =>
  buildProfile(preset, override);
