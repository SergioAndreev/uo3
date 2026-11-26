import { createHash, randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { sha256 } from './index.js';

it('векторы FIPS 180-4', () => {
  expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

it('совпадает с node:crypto на случайных данных', () => {
  for (let i = 0; i < 300; i++) {
    const bytes = new Uint8Array(randomBytes(i));
    expect(sha256(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  }
});
