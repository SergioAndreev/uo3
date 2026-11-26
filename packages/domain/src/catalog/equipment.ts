import { deepFreeze } from '../util/index.js';

export const SLOTS = [
  'head',
  'neck',
  'torso',
  'cloak',
  'hands',
  'belt',
  'legs',
  'feet',
  'ring-left',
  'ring-right',
  'main-hand',
  'off-hand',
  'pack',
] as const;
export type Slot = (typeof SLOTS)[number];

export interface SlotInfo {
  readonly slot: Slot;
  /** Виден ли предмет на модели героя. */
  readonly visible: boolean;
  /** Слот принимает предмет на обе руки. */
  readonly twoHanded: boolean;
}

const HIDDEN: readonly Slot[] = ['ring-left', 'ring-right'];
export const SLOT_INFO: Readonly<Record<Slot, SlotInfo>> = deepFreeze(
  Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      { slot, visible: !HIDDEN.includes(slot), twoHanded: slot === 'main-hand' },
    ]),
  ) as Record<Slot, SlotInfo>,
);

/** Слоты, которые занимает предмет. */
export const occupiedSlots = (slot: Slot, twoHanded = false): Slot[] =>
  twoHanded && SLOT_INFO[slot].twoHanded ? [slot, 'off-hand'] : [slot];
