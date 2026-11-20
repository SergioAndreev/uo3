import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export const Layer = {
  Invalid: 0x00,
  OneHanded: 0x01,
  TwoHanded: 0x02,
  Shoes: 0x03,
  Pants: 0x04,
  Shirt: 0x05,
  Helm: 0x06,
  Gloves: 0x07,
  Ring: 0x08,
  Talisman: 0x09,
  Neck: 0x0a,
  Hair: 0x0b,
  Waist: 0x0c,
  InnerTorso: 0x0d,
  Bracelet: 0x0e,
  Face: 0x0f,
  FacialHair: 0x10,
  MiddleTorso: 0x11,
  Earrings: 0x12,
  Arms: 0x13,
  Cloak: 0x14,
  Backpack: 0x15,
  OuterTorso: 0x16,
  OuterLegs: 0x17,
  InnerLegs: 0x18,
  Mount: 0x19,
  ShopBuy: 0x1a,
  ShopResale: 0x1b,
  ShopSell: 0x1c,
  Bank: 0x1d,
} as const;

export type Layer = (typeof Layer)[keyof typeof Layer];

export const LAYER_MIN = 0x00;
export const LAYER_MAX = 0x1d;

export type LayerCategory = "invalid" | "weapon" | "equipment" | "appearance" | "system";

export interface LayerMetadata {
  readonly code: Layer;
  readonly name: string;
  readonly category: LayerCategory;
  readonly visible: boolean;
  readonly draggable: boolean;
  readonly conflicts: readonly Layer[];
}

const NO_CONFLICTS: readonly Layer[] = Object.freeze([]);

export const LAYER_METADATA: Readonly<Record<Layer, LayerMetadata>> = Object.freeze({
  [Layer.Invalid]: Object.freeze({
    code: Layer.Invalid,
    name: "Invalid",
    category: "invalid",
    visible: false,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.OneHanded]: Object.freeze({
    code: Layer.OneHanded,
    name: "OneHanded",
    category: "weapon",
    visible: true,
    draggable: true,
    conflicts: Object.freeze([Layer.TwoHanded]),
  }),
  [Layer.TwoHanded]: Object.freeze({
    code: Layer.TwoHanded,
    name: "TwoHanded",
    category: "weapon",
    visible: true,
    draggable: true,
    conflicts: Object.freeze([Layer.OneHanded]),
  }),
  [Layer.Shoes]: Object.freeze({
    code: Layer.Shoes,
    name: "Shoes",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Pants]: Object.freeze({
    code: Layer.Pants,
    name: "Pants",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Shirt]: Object.freeze({
    code: Layer.Shirt,
    name: "Shirt",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Helm]: Object.freeze({
    code: Layer.Helm,
    name: "Helm",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Gloves]: Object.freeze({
    code: Layer.Gloves,
    name: "Gloves",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Ring]: Object.freeze({
    code: Layer.Ring,
    name: "Ring",
    category: "equipment",
    visible: false,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Talisman]: Object.freeze({
    code: Layer.Talisman,
    name: "Talisman",
    category: "equipment",
    visible: false,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Neck]: Object.freeze({
    code: Layer.Neck,
    name: "Neck",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Hair]: Object.freeze({
    code: Layer.Hair,
    name: "Hair",
    category: "appearance",
    visible: true,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Waist]: Object.freeze({
    code: Layer.Waist,
    name: "Waist",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.InnerTorso]: Object.freeze({
    code: Layer.InnerTorso,
    name: "InnerTorso",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Bracelet]: Object.freeze({
    code: Layer.Bracelet,
    name: "Bracelet",
    category: "equipment",
    visible: false,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Face]: Object.freeze({
    code: Layer.Face,
    name: "Face",
    category: "appearance",
    visible: true,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.FacialHair]: Object.freeze({
    code: Layer.FacialHair,
    name: "FacialHair",
    category: "appearance",
    visible: true,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.MiddleTorso]: Object.freeze({
    code: Layer.MiddleTorso,
    name: "MiddleTorso",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Earrings]: Object.freeze({
    code: Layer.Earrings,
    name: "Earrings",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Arms]: Object.freeze({
    code: Layer.Arms,
    name: "Arms",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Cloak]: Object.freeze({
    code: Layer.Cloak,
    name: "Cloak",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Backpack]: Object.freeze({
    code: Layer.Backpack,
    name: "Backpack",
    category: "system",
    visible: false,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.OuterTorso]: Object.freeze({
    code: Layer.OuterTorso,
    name: "OuterTorso",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.OuterLegs]: Object.freeze({
    code: Layer.OuterLegs,
    name: "OuterLegs",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.InnerLegs]: Object.freeze({
    code: Layer.InnerLegs,
    name: "InnerLegs",
    category: "equipment",
    visible: true,
    draggable: true,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Mount]: Object.freeze({
    code: Layer.Mount,
    name: "Mount",
    category: "system",
    visible: true,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.ShopBuy]: Object.freeze({
    code: Layer.ShopBuy,
    name: "ShopBuy",
    category: "system",
    visible: false,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.ShopResale]: Object.freeze({
    code: Layer.ShopResale,
    name: "ShopResale",
    category: "system",
    visible: false,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.ShopSell]: Object.freeze({
    code: Layer.ShopSell,
    name: "ShopSell",
    category: "system",
    visible: false,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
  [Layer.Bank]: Object.freeze({
    code: Layer.Bank,
    name: "Bank",
    category: "system",
    visible: false,
    draggable: false,
    conflicts: NO_CONFLICTS,
  }),
});

export const LAYER_DRAW_ORDER: readonly Layer[] = Object.freeze([
  Layer.Mount,
  Layer.Shoes,
  Layer.Pants,
  Layer.InnerLegs,
  Layer.OuterLegs,
  Layer.Shirt,
  Layer.InnerTorso,
  Layer.Arms,
  Layer.Gloves,
  Layer.Neck,
  Layer.MiddleTorso,
  Layer.Waist,
  Layer.OuterTorso,
  Layer.Cloak,
  Layer.Face,
  Layer.Hair,
  Layer.FacialHair,
  Layer.Earrings,
  Layer.Helm,
  Layer.Ring,
  Layer.Bracelet,
  Layer.Talisman,
  Layer.OneHanded,
  Layer.TwoHanded,
]);

export function asLayer(value: unknown, fieldPath?: string): Layer {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < LAYER_MIN ||
    value > LAYER_MAX
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_LAYER,
      `Layer must be an integer in [0x00, 0x1D], received ${String(value)}`,
      { ...(fieldPath !== undefined ? { fieldPath } : {}), details: { received: value } },
    );
  }
  return value as Layer;
}

export function getLayerMetadata(layer: Layer | number): LayerMetadata {
  return LAYER_METADATA[asLayer(layer)];
}

export function getConflictingLayers(layer: Layer | number): readonly Layer[] {
  return LAYER_METADATA[asLayer(layer)].conflicts;
}
