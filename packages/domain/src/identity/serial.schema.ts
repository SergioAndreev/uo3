import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  ITEM_SERIAL_MAX,
  ITEM_SERIAL_MIN,
  MOBILE_SERIAL_MAX,
  MOBILE_SERIAL_MIN,
  SERIAL_UINT32_MAX,
} from "./serial.js";

export const SerialNumberSchema = Type.Integer({
  minimum: 0,
  maximum: SERIAL_UINT32_MAX,
  description: "Unsigned 32-bit UO3 entity serial (0x00000000..0xFFFFFFFF)",
});

export const SerialHexSchema = Type.String({
  pattern: "^0x[0-9a-fA-F]{8}$",
  description: "Canonical 8-hex-digit serial string prefixed with 0x",
});

export const MobileSerialSchema = Type.Integer({
  minimum: MOBILE_SERIAL_MIN,
  maximum: MOBILE_SERIAL_MAX,
  description: "Mobile serial in range 0x00000001..0x3FFFFFFF",
});

export const ItemSerialSchema = Type.Integer({
  minimum: ITEM_SERIAL_MIN,
  maximum: ITEM_SERIAL_MAX,
  description: "Item/container/corpse/multi serial in range 0x40000000..0x7FFFFFFF",
});

export const SerialNumberValidator = TypeCompiler.Compile(SerialNumberSchema);
export const SerialHexValidator = TypeCompiler.Compile(SerialHexSchema);
export const MobileSerialValidator = TypeCompiler.Compile(MobileSerialSchema);
export const ItemSerialValidator = TypeCompiler.Compile(ItemSerialSchema);
