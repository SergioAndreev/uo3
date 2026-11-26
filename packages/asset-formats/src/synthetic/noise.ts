import { splitmix32 } from '@duskmarch/domain';

/** Значение решётки `0..1` по сиду и целым координатам, без состояния. */
export function lattice(seed: number, x: number, y: number): number {
  const mixed = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed) >>> 0;
  return splitmix32(mixed)[0] / 0x1_0000_0000;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Шум значений с октавами: только +, −, ×, / — одинаково на всех платформах. */
export function valueNoise(seed: number, x: number, y: number, scale: number, octaves = 4): number {
  let total = 0;
  let amplitude = 1;
  let norm = 0;
  let size = scale;
  for (let o = 0; o < octaves; o++) {
    const fx = x / size;
    const fy = y / size;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const s = (seed + o * 0x9e3779b9) >>> 0;
    const a = lattice(s, ix, iy);
    const b = lattice(s, ix + 1, iy);
    const c = lattice(s, ix, iy + 1);
    const d = lattice(s, ix + 1, iy + 1);
    total += amplitude * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    norm += amplitude;
    amplitude /= 2;
    size /= 2;
  }
  return total / norm;
}
