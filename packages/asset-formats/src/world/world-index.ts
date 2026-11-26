import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CHUNK_SIZE, CONTENT_KEY_PATTERN } from '@duskmarch/domain';
import { error, type Issue } from '../util/issues.js';

const Int = (minimum: number, maximum: number) => Type.Integer({ minimum, maximum });
export const WorldIndexSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    realm: Type.Object(
      { id: Int(0, 255), key: Type.String({ pattern: '^[a-z][a-z0-9-]*$' }) },
      { additionalProperties: false },
    ),
    width: Int(CHUNK_SIZE, 65_536),
    height: Int(CHUNK_SIZE, 65_536),
    chunkSize: Type.Literal(CHUNK_SIZE),
    chunks: Type.Array(
      Type.Object(
        {
          cx: Int(0, 2_047),
          cy: Int(0, 2_047),
          key: Type.String({ pattern: CONTENT_KEY_PATTERN.source }),
          sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
        },
        { additionalProperties: false },
      ),
    ),
    landmarks: Type.Optional(
      Type.Record(
        Type.String({ pattern: '^[a-z][a-z0-9-]*$' }),
        Type.Array(
          Type.Object({ x: Int(0, 65_535), y: Int(0, 65_535) }, { additionalProperties: false }),
          {
            minItems: 1,
          },
        ),
      ),
    ),
  },
  { additionalProperties: false },
);
export type WorldIndex = Static<typeof WorldIndexSchema>;

export const chunkKey = (realmKey: string, cx: number, cy: number): string =>
  `chunk.${realmKey}.x${cx}.y${cy}`;
export const chunkPath = (realmKey: string, cx: number, cy: number): string =>
  `chunks/${realmKey}/${cx}_${cy}.dmck`;

/** Проверка индекса плана: размеры кратны 32, каждый чанк сетки ровно один раз. */
export function validateWorldIndex(value: unknown): Issue[] {
  if (!Value.Check(WorldIndexSchema, value)) {
    return [...Value.Errors(WorldIndexSchema, value)].map((e) =>
      error('WORLD_SCHEMA', `${e.path}: ${e.message}`),
    );
  }
  const issues: Issue[] = [];
  const { width, height, chunks } = value;
  if (width % CHUNK_SIZE !== 0 || height % CHUNK_SIZE !== 0) {
    issues.push(error('WORLD_GRID', `размер ${width}×${height} не кратен ${CHUNK_SIZE}`));
    return issues;
  }
  const cols = width / CHUNK_SIZE;
  const rows = height / CHUNK_SIZE;
  const seen = new Set<string>();
  for (const { cx, cy } of chunks) {
    const id = `${cx},${cy}`;
    if (cx >= cols || cy >= rows)
      issues.push(error('WORLD_GRID', `чанк (${cx}, ${cy}) вне сетки ${cols}×${rows}`));
    else if (seen.has(id)) issues.push(error('WORLD_DUPLICATE', `чанк (${cx}, ${cy}) повторяется`));
    seen.add(id);
  }
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!seen.has(`${cx},${cy}`)) issues.push(error('WORLD_GRID', `нет чанка (${cx}, ${cy})`));
    }
  }
  return issues;
}
