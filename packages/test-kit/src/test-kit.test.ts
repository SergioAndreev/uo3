import { asItemId, isDomainError, kindOf } from '@duskmarch/domain';
import { expect, it } from 'vitest';
import {
  FakeClock,
  idSequence,
  randomPosition,
  testAllocator,
  testProfile,
  testRng,
} from './index.js';

it('FakeClock двигается только явно и не назад', () => {
  const clock = new FakeClock();
  clock.advance(5_000);
  expect(clock.now()).toBe(5_000);
  expect(clock.tick()).toBe(100);
  let caught: unknown;
  try {
    clock.setTime(4_000);
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught, 'ERR_CLOCK_REGRESSION')).toBe(true);
  expect(clock.now()).toBe(5_000);
  expect(() => clock.advance(-1)).toThrow('ERR_CLOCK_REGRESSION');
  clock.advanceTicks(2);
  clock.setTime(6_000);
  expect(clock.utc()).toBe(Date.UTC(2026, 0, 1) + 6_000);
});

it('фабрики воспроизводимы', async () => {
  expect(testRng('a').next()).toBe(testRng('a').next());
  expect(testRng('a').next()).not.toBe(testRng('b').next());
  const allocator = await testAllocator();
  expect(kindOf(allocator.next('structure'))).toBe('structure');
  const next = idSequence('item');
  expect([asItemId(next()), next()]).toEqual([0x60000001, 0x60000002]);
  const p = randomPosition(testRng('p'), 255, 64, 3);
  expect(p.x).toBeLessThan(64);
  expect(p.h).toBe(3);
  expect(testProfile().preset).toBe('proving');
  expect(testProfile('standard', { features: { mounts: false } }).features.mounts).toBe(false);
});

it('фикстуры мира', async () => {
  const { flatChunk, packChunks, provingPack } = await import('./index.js');
  expect(provingPack()).toBe(provingPack());
  const chunks = packChunks();
  expect([...chunks.keys()].sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  expect(chunks.get('0,0')?.realm).toBe(255);
  const flat = flatChunk(3);
  expect(flat.heights.every((h) => h === 3)).toBe(true);
  expect(flat.flags[0]).toBe(4);
});
