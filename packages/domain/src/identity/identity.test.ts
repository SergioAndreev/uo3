import { expect, expectTypeOf, it } from 'vitest';
import { isDomainError, type DomainErrorCode } from '../errors/index.js';
import {
  EntityRegistry,
  EphemeralIdAllocator,
  IdAllocator,
  InMemoryIdLeaseProvider,
  asEntityId,
  asHeroId,
  asItemId,
  compareEntityIds,
  formatEntityId,
  kindOf,
  makeEntityId,
  parseEntityId,
  readEntityId,
  writeEntityId,
  entityIdFromJson,
  type EntityId,
  type HeroId,
  type ItemId,
  type IdLease,
  type IdLeaseProvider,
  type WorldEntityKind,
} from './index.js';

const fails = (fn: () => unknown, code: DomainErrorCode): unknown => {
  try {
    fn();
  } catch (error) {
    expect(isDomainError(error, code), String(error)).toBe(true);
    return error;
  }
  throw new Error(`ожидалась ошибка ${code}`);
};

it('вид по старшим битам', () => {
  expect([0x20000001, 0x40000001, 0x60000001, 0x80000001, 0xe0000001].map(kindOf)).toEqual([
    'hero',
    'creature',
    'item',
    'structure',
    'ephemeral',
  ]);
  expect(asEntityId(0)).toBe(0);
  for (const value of [0x20000000, 0xa0000001, 0xc0000001]) {
    expect(kindOf(value)).toBeUndefined();
    fails(() => asEntityId(value), 'ERR_INVALID_ENTITY_ID');
  }
});

it('отклоняет некорректные числа и чужой вид', () => {
  for (const value of [1.5, -1, Number.NaN, Infinity, 0x100000000]) {
    fails(() => asEntityId(value), 'ERR_INVALID_ENTITY_ID');
  }
  const error = fails(() => asItemId(0x20000005), 'ERR_ENTITY_KIND_MISMATCH');
  expect((error as { details: unknown }).details).toEqual({ expected: 'item', actual: 'hero' });
  fails(() => asHeroId(0), 'ERR_ENTITY_KIND_MISMATCH');
  fails(() => makeEntityId('item', 0), 'ERR_INVALID_ENTITY_ID');
});

it('типы видов несовместимы', () => {
  expectTypeOf<ItemId>().not.toMatchTypeOf<HeroId>();
  expectTypeOf<HeroId>().toMatchTypeOf<EntityId>();
  expectTypeOf<number>().not.toMatchTypeOf<EntityId>();
});

it('текст и байты', () => {
  const id = asItemId(0x6000002a);
  expect(formatEntityId(id)).toBe('I-6000002A');
  expect(parseEntityId('I-6000002A')).toBe(id);
  const bytes = new Uint8Array(6);
  writeEntityId(id, bytes, 1);
  expect([...bytes]).toEqual([0, 0x60, 0, 0, 0x2a, 0]);
  expect(readEntityId(bytes, 1)).toBe(id);
  fails(() => readEntityId(new Uint8Array(3)), 'ERR_INVALID_ENTITY_ID');
  fails(() => writeEntityId(id, new Uint8Array(4), 1), 'ERR_INVALID_ENTITY_ID');
  fails(() => formatEntityId(asEntityId(0)), 'ERR_INVALID_ENTITY_ID');
  expect(entityIdFromJson(0x6000002a)).toBe(id);
  fails(() => entityIdFromJson('I-6000002A'), 'ERR_INVALID_ENTITY_ID');
});

it.each(['i-6000002A', 'I-6000002a', 'I-2A', 'H-6000002A', ' I-6000002A', 'I-A000002A'])(
  'отклоняет текст %j',
  (text) => {
    fails(() => parseEntityId(text), 'ERR_INVALID_ENTITY_ID');
  },
);

it('круговое преобразование случайных значений', () => {
  let state = 20261126;
  const kinds: WorldEntityKind[] = ['hero', 'creature', 'item', 'structure'];
  for (let i = 0; i < 10_000; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const id = makeEntityId(kinds[i % 4] ?? 'item', state & 0x1fffffff || 1);
    const bytes = new Uint8Array(4);
    writeEntityId(id, bytes);
    expect(parseEntityId(formatEntityId(id))).toBe(id);
    expect(readEntityId(bytes)).toBe(id);
    expect(JSON.parse(JSON.stringify(id))).toBe(id);
  }
});

it('беззнаковый порядок', () => {
  const ids = [0xe0000001, 0x60000001, 0, 0x20000001, 0x80000001].map(asEntityId);
  expect([...ids].sort(compareEntityIds)).toEqual([
    0, 0x20000001, 0x60000001, 0x80000001, 0xe0000001,
  ]);
  const [a = 0, b = 0, c = 0] = ids;
  expect(Math.sign(compareEntityIds(a as EntityId, b as EntityId))).toBe(
    -Math.sign(compareEntityIds(b as EntityId, a as EntityId)),
  );
  expect(compareEntityIds(c as EntityId, c as EntityId)).toBe(0);
});

/** Поставщик с ручным завершением запросов. */
class ManualProvider implements IdLeaseProvider {
  readonly requests: { kind: WorldEntityKind; resolve: () => void }[] = [];
  private readonly inner = new InMemoryIdLeaseProvider();
  lease(kind: WorldEntityKind, size: number): Promise<IdLease> {
    return new Promise((done) => {
      this.requests.push({ kind, resolve: () => void this.inner.lease(kind, size).then(done) });
    });
  }
}
const flush = () => new Promise((done) => setTimeout(done, 0));

it('монотонная выдача без повторов, независимые счётчики', async () => {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider());
  await allocator.ready();
  const items = [allocator.next('item'), allocator.next('item'), allocator.next('item')];
  expect(items).toEqual([0x60000001, 0x60000002, 0x60000003]);
  expect(allocator.next('item')).toBe(0x60000004);
  expect(allocator.next('hero')).toBe(0x20000001);
});

it('размер блока проверяется', () => {
  for (const size of [128, 100_000, 300.5]) {
    fails(
      () => new IdAllocator(new InMemoryIdLeaseProvider(), { leaseSize: size }),
      'ERR_INVALID_LEASE_SIZE',
    );
  }
});

it('упреждающая аренда на 3277-й выдаче и ERR_ID_LEASE_PENDING', async () => {
  const provider = new ManualProvider();
  const allocator = new IdAllocator(provider);
  const ready = allocator.ready();
  provider.requests.splice(0).forEach((r) => r.resolve());
  await ready;
  for (let i = 1; i < 3277; i++) allocator.next('item');
  expect(provider.requests).toHaveLength(0);
  allocator.next('item');
  expect(provider.requests.map((r) => r.kind)).toEqual(['item']);
  for (let i = 3278; i <= 4096; i++) allocator.next('item');
  expect(provider.requests).toHaveLength(1);
  fails(() => allocator.next('item'), 'ERR_ID_LEASE_PENDING');
  provider.requests[0]?.resolve();
  await flush();
  expect(allocator.next('item')).toBe(0x60000000 + 4097);
});

it('два аллокатора одного поставщика не пересекаются', async () => {
  const provider = new InMemoryIdLeaseProvider();
  const a = new IdAllocator(provider, { leaseSize: 256 });
  const b = new IdAllocator(provider, { leaseSize: 256 });
  await Promise.all([a.ready(), b.ready()]);
  const seen = new Set<number>();
  for (let i = 0; i < 50_000; i++) {
    for (const allocator of [a, b]) {
      let id: number | undefined;
      while (id === undefined) {
        try {
          id = allocator.next('creature');
        } catch {
          await flush();
        }
      }
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  }
  expect(seen.size).toBe(100_000);
});

it('восстановление: отметка опережает данные и наоборот', async () => {
  const provider = new InMemoryIdLeaseProvider({ item: 0x1000, hero: 0x11 });
  const allocator = new IdAllocator(provider);
  allocator.hydrate({
    item: { maxLoaded: 0x60000010, highWater: 0x60001000 },
    hero: { maxLoaded: 0x20000010, highWater: 0x20000005 },
  });
  await allocator.ready();
  expect(allocator.next('item')).toBe(0x60001000);
  expect(allocator.next('hero')).toBe(0x20000011);
});

it('снимок в формате design.md', async () => {
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider());
  await allocator.ready();
  expect(allocator.snapshot()).toEqual({
    version: 1,
    kinds: {
      hero: { next: 536870913, highWater: 536875009 },
      creature: { next: 1073741825, highWater: 1073745921 },
      item: { next: 1610612737, highWater: 1610616833 },
      structure: { next: 2147483649, highWater: 2147487745 },
    },
  });
  allocator.next('item');
  const restored = new IdAllocator(new InMemoryIdLeaseProvider({ item: 4097 }));
  restored.hydrate({ item: { highWater: allocator.snapshot().kinds.item.highWater } });
  await restored.ready();
  expect(restored.next('item')).toBe(0x60000000 + 4097);
});

it('события заполнения однократны, исчерпание без перехода в другой вид', async () => {
  const events: unknown[] = [];
  const provider = new InMemoryIdLeaseProvider({ creature: 0x1fffffff });
  const allocator = new IdAllocator(provider, { onFill: (e) => events.push(e) });
  allocator.hydrate({ creature: { highWater: 0x40000000 + 0x1fffffff } });
  await allocator.ready();
  expect(allocator.next('creature')).toBe(0x5fffffff);
  fails(() => allocator.next('creature'), 'ERR_ENTITY_ID_EXHAUSTED');
  expect(events).toEqual([
    { kind: 'creature', threshold: 80, seq: 0x1fffffff },
    { kind: 'creature', threshold: 95, seq: 0x1fffffff },
  ]);
  await expect(provider.lease('creature', 256)).rejects.toThrow('ERR_ENTITY_ID_EXHAUSTED');
});

it('порог 80 % срабатывает один раз', async () => {
  const events: number[] = [];
  const start = Math.ceil(0x1fffffff * 0.8) - 1;
  const allocator = new IdAllocator(new InMemoryIdLeaseProvider({ hero: start }), {
    onFill: (e) => events.push(e.threshold),
  });
  allocator.hydrate({ hero: { highWater: 0x20000000 + start } });
  await allocator.ready();
  for (let i = 0; i < 3; i++) allocator.next('hero');
  expect(events).toEqual([80]);
});

it('ошибки фоновой аренды передаются обработчику', async () => {
  const errors: unknown[] = [];
  const allocator = new IdAllocator(
    { lease: () => Promise.reject(new Error('db down')) },
    {
      onLeaseError: (e) => errors.push(e),
    },
  );
  await allocator.ready();
  fails(() => allocator.next('item'), 'ERR_ID_LEASE_PENDING');
  await flush();
  expect(errors.length).toBeGreaterThan(0);
});

it('реестр: коллизии и резервные значения', () => {
  const registry = new EntityRegistry<string>();
  const id = asItemId(0x60000042);
  registry.register(id, 'первый');
  fails(() => registry.register(id, 'второй'), 'ERR_ENTITY_ID_COLLISION');
  expect(registry.get(id)).toBe('первый');
  fails(() => registry.register(asEntityId(0), 'x'), 'ERR_RESERVED_ENTITY_ID');
  const marker = new EphemeralIdAllocator().next();
  expect(marker).toBe(0xe0000001);
  fails(() => registry.register(marker, 'x'), 'ERR_RESERVED_ENTITY_ID');
  expect(registry.size).toBe(1);
  expect(registry.remove(id)).toBe(true);
});
