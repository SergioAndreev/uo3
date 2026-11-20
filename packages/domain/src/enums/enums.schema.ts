import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { BODY_ID_MAX, BODY_ID_MIN } from "./body.js";
import { HUE_MAX, HUE_MIN } from "./hue.js";
import { LAYER_MAX, LAYER_MIN } from "./layer.js";
import { UOR_SKILL_MAX_ID } from "./skills-stats.js";
import { ITEM_ID_MAX, LAND_ID_MAX } from "./tile-data.js";

export const LayerSchema = Type.Integer({ minimum: LAYER_MIN, maximum: LAYER_MAX });
export const BodyIdSchema = Type.Integer({ minimum: BODY_ID_MIN, maximum: BODY_ID_MAX });
export const HueSchema = Type.Integer({ minimum: HUE_MIN, maximum: HUE_MAX });
export const RaceSchema = Type.Integer({ minimum: 0, maximum: 2 });
export const GenderSchema = Type.Integer({ minimum: 0, maximum: 1 });
export const NotorietySchema = Type.Integer({ minimum: 1, maximum: 7 });
export const AccessLevelSchema = Type.Integer({ minimum: 0, maximum: 6 });
export const SkillIdSchema = Type.Integer({ minimum: 0, maximum: UOR_SKILL_MAX_ID });
export const StatIdSchema = Type.Integer({ minimum: 0, maximum: 2 });
export const LockStateSchema = Type.Integer({ minimum: 0, maximum: 2 });

export const TileFlagsHexSchema = Type.String({
  pattern: "^0x[0-9a-fA-F]{1,16}$",
  description: "64-bit unsigned tiledata flag mask encoded as hex string",
});

export const LandTileDataSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 0, maximum: LAND_ID_MAX }),
    flags: TileFlagsHexSchema,
    textureId: Type.Integer({ minimum: 0, maximum: 0xffff }),
    name: Type.String(),
  },
  { additionalProperties: false },
);

export const ItemTileDataSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 0, maximum: ITEM_ID_MAX }),
    flags: TileFlagsHexSchema,
    weight: Type.Integer({ minimum: 0, maximum: 255 }),
    quality: Type.Integer({ minimum: 0, maximum: 255 }),
    quantity: Type.Integer({ minimum: 0, maximum: 255 }),
    animId: Type.Integer({ minimum: 0, maximum: 0xffff }),
    hue: Type.Integer({ minimum: 0, maximum: 255 }),
    value: Type.Integer({ minimum: 0, maximum: 255 }),
    height: Type.Integer({ minimum: 0, maximum: 255 }),
    name: Type.String(),
  },
  { additionalProperties: false },
);

export const LayerValidator = TypeCompiler.Compile(LayerSchema);
export const BodyIdValidator = TypeCompiler.Compile(BodyIdSchema);
export const HueValidator = TypeCompiler.Compile(HueSchema);
export const RaceValidator = TypeCompiler.Compile(RaceSchema);
export const GenderValidator = TypeCompiler.Compile(GenderSchema);
export const NotorietyValidator = TypeCompiler.Compile(NotorietySchema);
export const AccessLevelValidator = TypeCompiler.Compile(AccessLevelSchema);
export const SkillIdValidator = TypeCompiler.Compile(SkillIdSchema);
export const StatIdValidator = TypeCompiler.Compile(StatIdSchema);
export const LockStateValidator = TypeCompiler.Compile(LockStateSchema);
export const TileFlagsHexValidator = TypeCompiler.Compile(TileFlagsHexSchema);
export const LandTileDataValidator = TypeCompiler.Compile(LandTileDataSchema);
export const ItemTileDataValidator = TypeCompiler.Compile(ItemTileDataSchema);
