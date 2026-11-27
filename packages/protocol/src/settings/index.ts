import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const strict = { additionalProperties: false } as const;
const Num = (minimum: number, maximum: number, defaultValue: number) =>
  Type.Number({ minimum, maximum, default: defaultValue });
const Int = (minimum: number, maximum: number, defaultValue: number) =>
  Type.Integer({ minimum, maximum, default: defaultValue });
const Bool = (defaultValue: boolean) => Type.Boolean({ default: defaultValue });
const Lit = <T extends string>(values: readonly T[], defaultValue: T) =>
  Type.Union(
    values.map((v) => Type.Literal(v)),
    { default: defaultValue },
  );

export const PROFILE_SCHEMA_VERSION = 1;
export const PROFILE_MAX_BYTES = 65_536;
export const PROFILE_WRITES_PER_MINUTE = 30;

/** Действия, которым можно назначить клавиши. */
export const CONTROL_ACTIONS = [
  'move.forward',
  'move.back',
  'move.left',
  'move.right',
  'move.run',
  'combat.stance',
  'panel.hero',
  'panel.pack',
  'panel.skills',
  'panel.journal',
  'camera.rotate_left',
  'camera.rotate_right',
  'target.self',
  'target.last',
  ...Array.from({ length: 10 }, (_, i) => `slot.${i + 1}` as const),
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** Комбинации, которые забирает браузер. */
const ctrlLetter = (letter: string): string => `Ctrl+Key${letter}`;
export const RESERVED_CHORDS = new Set([
  ...['W', 'T', 'N', 'R', 'L'].map(ctrlLetter),
  `Ctrl+Shift+Key${'T'}`,
  'Ctrl+Tab',
  'F5',
  'F11',
  'Alt+F4',
]);

/** Аккорд: модификаторы в порядке `Ctrl+Alt+Shift+` и `KeyboardEvent.code`. */
export const Chord = Type.String({
  pattern: '^(Ctrl\\+)?(Alt\\+)?(Shift\\+)?([A-Z][A-Za-z0-9]{1,20}|F[1-9]|F1[0-2])$',
  maxLength: 40,
});

export const DEFAULT_BINDINGS: Readonly<Record<ControlAction, string>> = {
  'move.forward': 'KeyW',
  'move.back': 'KeyS',
  'move.left': 'KeyA',
  'move.right': 'KeyD',
  'move.run': 'ShiftLeft',
  'combat.stance': 'Tab',
  'panel.hero': 'KeyC',
  'panel.pack': 'KeyB',
  'panel.skills': 'KeyK',
  'panel.journal': 'KeyJ',
  'camera.rotate_left': 'KeyQ',
  'camera.rotate_right': 'KeyE',
  'target.self': 'F1',
  'target.last': 'KeyT',
  ...(Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`slot.${i + 1}`, i === 9 ? 'Digit0' : `Digit${i + 1}`]),
  ) as Record<`slot.${number}`, string>),
};

export const GraphicsSettings = Type.Object(
  {
    preset: Lit(['low', 'medium', 'high'], 'medium'),
    cameraZoom: Num(0.5, 2, 1),
    /** Поворот камеры: 0, 90, 180, 270. */
    cameraRotation: Type.Union(
      [0, 90, 180, 270].map((v) => Type.Literal(v)),
      { default: 0 },
    ),
    shadows: Lit(['off', 'low', 'high'], 'low'),
    renderScale: Num(0.5, 1, 1),
    fpsCap: Lit(['30', '60', '120', 'uncapped'], '60'),
    hideRoofs: Bool(true),
    occlusionRadiusCells: Int(2, 12, 6),
  },
  strict,
);

export const AudioSettings = Type.Object(
  {
    masterVolume: Int(0, 100, 80),
    musicVolume: Int(0, 100, 60),
    effectsVolume: Int(0, 100, 80),
    ambientVolume: Int(0, 100, 60),
    muted: Bool(false),
    muteOnBlur: Bool(true),
  },
  strict,
);

export const GameplaySettings = Type.Object(
  {
    showNames: Lit(['all', 'hovered', 'none'], 'hovered'),
    showHealthBars: Bool(true),
    showDamageNumbers: Bool(true),
    confirmDangerousActions: Bool(true),
  },
  strict,
);

export const InterfaceSettings = Type.Object(
  {
    locale: Lit(['ru', 'en'], 'ru'),
    uiScale: Num(0.75, 1.5, 1),
    fontSize: Int(12, 20, 14),
    reduceMotion: Bool(false),
  },
  strict,
);

export const ControlsSettings = Type.Object(
  {
    bindings: Type.Record(
      Type.Union(CONTROL_ACTIONS.map((a) => Type.Literal(a))),
      Type.Union([Chord, Type.Null()]),
    ),
  },
  strict,
);

export const PROFILE_CATEGORIES = [
  'graphics',
  'audio',
  'gameplay',
  'interface',
  'controls',
] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

/** Облачный профиль аккаунта. */
export const ClientProfile = Type.Object(
  {
    schemaVersion: Type.Literal(PROFILE_SCHEMA_VERSION),
    graphics: GraphicsSettings,
    audio: AudioSettings,
    gameplay: GameplaySettings,
    interface: InterfaceSettings,
    controls: ControlsSettings,
  },
  strict,
);
export type ClientProfile = Static<typeof ClientProfile>;

/** Ответ API: профиль с ревизией. */
export interface ClientProfileEnvelope {
  revision: number;
  updatedAt: string;
  profile: ClientProfile;
}

/** Частичная правка: категория → поля. */
export const ClientProfilePatch = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    changes: Type.Partial(
      Type.Object(
        {
          graphics: Type.Partial(GraphicsSettings),
          audio: Type.Partial(AudioSettings),
          gameplay: Type.Partial(GameplaySettings),
          interface: Type.Partial(InterfaceSettings),
          controls: Type.Object(
            { bindings: Type.Optional(Type.Partial(ControlsSettings.properties.bindings)) },
            strict,
          ),
        },
        strict,
      ),
    ),
  },
  strict,
);
export type ClientProfilePatch = Static<typeof ClientProfilePatch>;

export const ClientProfilePut = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }), profile: ClientProfile },
  strict,
);
export const ClientProfileReset = Type.Object(
  {
    expectedRevision: Type.Integer({ minimum: 1 }),
    categories: Type.Optional(
      Type.Array(Type.Union(PROFILE_CATEGORIES.map((c) => Type.Literal(c))), {
        minItems: 1,
        maxItems: 5,
      }),
    ),
  },
  strict,
);

/** Профиль по умолчанию. */
export function defaultProfile(): ClientProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    graphics: Value.Create(GraphicsSettings),
    audio: Value.Create(AudioSettings),
    gameplay: Value.Create(GameplaySettings),
    interface: Value.Create(InterfaceSettings),
    controls: { bindings: { ...DEFAULT_BINDINGS } },
  };
}

/** Слияние правки в профиль (без проверки). */
export function applyPatch(
  profile: ClientProfile,
  changes: ClientProfilePatch['changes'],
): ClientProfile {
  const next = JSON.parse(JSON.stringify(profile)) as ClientProfile;
  for (const category of PROFILE_CATEGORIES) {
    const part = changes[category];
    if (!part) continue;
    if (category === 'controls') {
      next.controls.bindings = {
        ...next.controls.bindings,
        ...(part as { bindings?: Record<string, string | null> }).bindings,
      } as ClientProfile['controls']['bindings'];
    } else {
      Object.assign(next[category], part);
    }
  }
  return next;
}

/** Ошибки проверки профиля: пути полей. */
export function profileErrors(value: unknown): string[] {
  return [...Value.Errors(ClientProfile, value)].slice(0, 20).map((e) => e.path || '/');
}

/** Конфликты привязок: аккорд → действия, у которых он назначен больше одного раза. */
export function bindingConflicts(
  bindings: Readonly<Record<string, string | null>>,
): Record<string, string[]> {
  const byChord = new Map<string, string[]>();
  for (const [action, chord] of Object.entries(bindings)) {
    if (!chord) continue;
    byChord.set(chord, [...(byChord.get(chord) ?? []), action]);
  }
  return Object.fromEntries([...byChord].filter(([, actions]) => actions.length > 1));
}

/** Коды ошибок профиля (HTTP-статусы). */
export const PROFILE_ERRORS = {
  PROFILE_VALIDATION_FAILED: 422,
  PROFILE_REVISION_CONFLICT: 409,
  PROFILE_PAYLOAD_TOO_LARGE: 413,
  PROFILE_RATE_LIMITED: 429,
} as const;
