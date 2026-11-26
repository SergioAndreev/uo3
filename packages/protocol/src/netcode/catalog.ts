import { ACCESS_LEVELS } from '@duskmarch/domain';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { NetcodeErrorCode } from './errors.js';
import { MAX_FRAME_BYTES, MAX_LARGE_FRAME_BYTES, PHASE_BLOCKS, type Phase } from './opcodes.js';

export type RoomScope = 'world' | 'hub' | 'both';
export type RateCategory = 'movement' | 'world' | 'speech' | 'time' | 'panel' | 'staff';
export type HeroState = 'alive' | 'fallen';
type AccessLevel = (typeof ACCESS_LEVELS)[number];

/** Лимиты частоты по категориям: в секунду и всплеск. */
export const RATE_LIMITS: Readonly<Record<RateCategory, { perSecond: number; burst: number }>> = {
  movement: { perSecond: 12, burst: 6 },
  world: { perSecond: 10, burst: 15 },
  speech: { perSecond: 3, burst: 5 },
  time: { perSecond: 2, burst: 6 },
  panel: { perSecond: 6, burst: 10 },
  staff: { perSecond: 10, burst: 20 },
};

export interface IntentSpec<S extends TSchema = TSchema> {
  readonly name: string;
  readonly phase: Phase;
  readonly opcode: number;
  readonly room: RoomScope;
  readonly schema: S;
  readonly rate: RateCategory;
  readonly minLevel: AccessLevel;
  readonly states: readonly HeroState[];
  /** Большие фреймы (до 64 КиБ): ответы панелей и команды персонала. */
  readonly large?: boolean;
}

export const defineIntent = <S extends TSchema>(spec: IntentSpec<S>): IntentSpec<S> =>
  Object.freeze(spec);

export interface Catalog {
  byOpcode: ReadonlyMap<number, IntentSpec>;
  byName: ReadonlyMap<string, IntentSpec>;
}

/** Сборка каталога: опкод в блоке своей фазы, имена и опкоды уникальны. */
export function buildCatalog(specs: readonly IntentSpec[]): Catalog {
  const byOpcode = new Map<number, IntentSpec>();
  const byName = new Map<string, IntentSpec>();
  for (const spec of specs) {
    const [lo, hi] = PHASE_BLOCKS[spec.phase];
    if (spec.opcode < lo || spec.opcode > hi) {
      throw new Error(`${spec.name}: опкод 0x${spec.opcode.toString(16)} вне блока ${spec.phase}`);
    }
    if (!/^[a-z]+\.[a-z_]+$/.test(spec.name))
      throw new Error(`${spec.name}: имя не namespace.action`);
    if (byOpcode.has(spec.opcode))
      throw new Error(`${spec.name}: опкод уже занят ${byOpcode.get(spec.opcode)?.name}`);
    if (byName.has(spec.name)) throw new Error(`${spec.name}: имя уже занято`);
    byOpcode.set(spec.opcode, spec);
    byName.set(spec.name, spec);
  }
  return { byOpcode, byName };
}

/** Конечные числа и глубина вложенности не больше `maxDepth`. */
export function sane(value: unknown, maxDepth = 6, depth = 0): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value !== 'object') return true;
  if (depth >= maxDepth) return false;
  return Object.values(value as Record<string, unknown>).every((v) => sane(v, maxDepth, depth + 1));
}

export type IntentCheck =
  | { ok: true; spec: IntentSpec; value: unknown }
  | { ok: false; error: NetcodeErrorCode; details?: Record<string, unknown> };

/** Проверка входящего намерения до очереди тика: размер, опкод, комната, схема. */
export function checkIntent(
  catalog: Catalog,
  opcode: number,
  payload: unknown,
  room: 'world' | 'hub',
  frameBytes: number,
): IntentCheck {
  if (frameBytes > MAX_LARGE_FRAME_BYTES) return { ok: false, error: 'PROTO_FRAME_TOO_LARGE' };
  const spec = catalog.byOpcode.get(opcode);
  if (!spec) return { ok: false, error: 'PROTO_UNKNOWN_OPCODE' };
  if (frameBytes > (spec.large ? MAX_LARGE_FRAME_BYTES : MAX_FRAME_BYTES))
    return { ok: false, error: 'PROTO_FRAME_TOO_LARGE' };
  if (spec.room !== 'both' && spec.room !== room)
    return { ok: false, error: 'PROTO_WRONG_ROOM_TYPE' };
  if (!sane(payload) || !Value.Check(spec.schema, payload)) {
    const paths = [...Value.Errors(spec.schema, payload)].slice(0, 10).map((e) => e.path || '/');
    return {
      ok: false,
      error: 'PROTO_INVALID_PAYLOAD',
      details: { paths: paths.length ? paths : ['/'] },
    };
  }
  return { ok: true, spec, value: payload };
}

const strict = { additionalProperties: false } as const;
const Id = Type.Integer({ minimum: 1, maximum: 0xffff_ffff });
const RequestId = Type.Optional(Type.Integer({ minimum: 0, maximum: 0xffff_ffff }));

/** Направление шага: 0..7 и бит бега 0x80, других битов нет. */
export const StepDirection = Type.Union(
  [0, 1, 2, 3, 4, 5, 6, 7, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87].map((d) =>
    Type.Literal(d),
  ),
);
export const WALK_WINDOW = 4;

/**
 * Контракты намерений, которые реализуют следующие фазы. Схемы содержат только намерение игрока,
 * без исходов симуляции (урон, попадание, итоговые координаты).
 */
export const BASE_INTENTS = [
  defineIntent({
    name: 'move.walk_req',
    phase: 'P12',
    opcode: 0x0100,
    room: 'world',
    rate: 'movement',
    minLevel: 'player',
    states: ['alive', 'fallen'],
    schema: Type.Object(
      {
        seq: Type.Integer({ minimum: 0, maximum: 255 }),
        direction: StepDirection,
        requestId: RequestId,
      },
      strict,
    ),
  }),
  defineIntent({
    name: 'item.pick_up',
    phase: 'P13',
    opcode: 0x0120,
    room: 'world',
    rate: 'world',
    minLevel: 'player',
    states: ['alive'],
    schema: Type.Object(
      {
        targetId: Id,
        amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 60_000 })),
        requestId: RequestId,
      },
      strict,
    ),
  }),
  defineIntent({
    name: 'world.inspect',
    phase: 'P13',
    opcode: 0x0125,
    room: 'world',
    rate: 'world',
    minLevel: 'player',
    states: ['alive', 'fallen'],
    schema: Type.Object({ targetId: Id, requestId: RequestId }, strict),
  }),
  defineIntent({
    name: 'world.use',
    phase: 'P13',
    opcode: 0x0126,
    room: 'world',
    rate: 'world',
    minLevel: 'player',
    states: ['alive'],
    schema: Type.Object({ targetId: Id, requestId: RequestId }, strict),
  }),
  defineIntent({
    name: 'panel.response',
    phase: 'P14',
    opcode: 0x0151,
    room: 'world',
    rate: 'panel',
    minLevel: 'player',
    states: ['alive', 'fallen'],
    large: true,
    schema: Type.Object(
      {
        panelId: Id,
        button: Type.Integer({ minimum: 0, maximum: 65_535 }),
        fields: Type.Optional(
          Type.Record(Type.String({ maxLength: 32 }), Type.String({ maxLength: 4_096 })),
        ),
        requestId: RequestId,
      },
      strict,
    ),
  }),
  defineIntent({
    name: 'combat.attack_req',
    phase: 'P16',
    opcode: 0x01a1,
    room: 'world',
    rate: 'world',
    minLevel: 'player',
    states: ['alive'],
    schema: Type.Object({ targetId: Id, requestId: RequestId }, strict),
  }),
  defineIntent({
    name: 'weave.cast',
    phase: 'P18',
    opcode: 0x01f0,
    room: 'world',
    rate: 'world',
    minLevel: 'player',
    states: ['alive'],
    schema: Type.Object(
      {
        tones: Type.Array(
          Type.Union(['heat', 'frost', 'stone', 'wind', 'light'].map((t) => Type.Literal(t))),
          { minItems: 2, maxItems: 3 },
        ),
        targetId: Type.Optional(Id),
        requestId: RequestId,
      },
      strict,
    ),
  }),
  defineIntent({
    name: 'social.hub_chat_send',
    phase: 'P26',
    opcode: 0x02f0,
    room: 'hub',
    rate: 'speech',
    minLevel: 'player',
    states: ['alive', 'fallen'],
    schema: Type.Object(
      {
        channel: Type.String({ maxLength: 32 }),
        text: Type.String({ minLength: 1, maxLength: 512 }),
        requestId: RequestId,
      },
      strict,
    ),
  }),
  defineIntent({
    name: 'staff.command',
    phase: 'P29',
    opcode: 0x0360,
    room: 'both',
    rate: 'staff',
    minLevel: 'helper',
    states: ['alive', 'fallen'],
    large: true,
    schema: Type.Object(
      {
        command: Type.String({ maxLength: 64 }),
        args: Type.Array(Type.String({ maxLength: 1_024 }), { maxItems: 32 }),
        requestId: RequestId,
      },
      strict,
    ),
  }),
] as const;

export const BASE_CATALOG = buildCatalog(BASE_INTENTS);
export type WalkRequest = Static<(typeof BASE_INTENTS)[0]['schema']>;
