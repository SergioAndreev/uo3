import {
  decodeChunk,
  emptyChunk,
  generateSyntheticPack,
  type Chunk,
  type SyntheticPack,
} from '@duskmarch/asset-formats';

let cached: SyntheticPack | undefined;

/** Синтетический пакет `proving` (сид 42), общий для тестов процесса. */
export const provingPack = (): SyntheticPack => (cached ??= generateSyntheticPack('proving', 42));

/** Декодированные чанки пакета по ключу `cx,cy`. */
export function packChunks(pack: SyntheticPack = provingPack()): Map<string, Chunk> {
  const byPath = new Map(pack.manifest.entries.map((e) => [e.key, e.path]));
  return new Map(
    pack.world.chunks.map((c) => [
      `${c.cx},${c.cy}`,
      decodeChunk(pack.files.get(byPath.get(c.key) ?? '') ?? new Uint8Array()),
    ]),
  );
}

/** Пустой чанк с травой на высоте `h`. */
export function flatChunk(h = 0, realm = 255): Chunk {
  const chunk = emptyChunk(realm, 0, 0);
  chunk.surfaces.fill(1);
  chunk.heights.fill(h);
  chunk.flags.fill(1 << 2);
  return chunk;
}
