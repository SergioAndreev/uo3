import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { COORD_XY_MAX, COORD_XY_MIN, Z_MAX, Z_MIN } from "./point.js";

export const Point2DSchema = Type.Object(
  {
    x: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    y: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
  },
  { additionalProperties: false },
);

export const Point3DSchema = Type.Object(
  {
    x: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    y: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    z: Type.Integer({ minimum: Z_MIN, maximum: Z_MAX }),
  },
  { additionalProperties: false },
);

export const Rect2DSchema = Type.Object(
  {
    x: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    y: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    width: Type.Integer({ minimum: 0, maximum: COORD_XY_MAX + 1 }),
    height: Type.Integer({ minimum: 0, maximum: COORD_XY_MAX + 1 }),
  },
  { additionalProperties: false },
);

export const WorldLocationSchema = Type.Object(
  {
    facet: Type.Integer({ minimum: 0, maximum: 255 }),
    x: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    y: Type.Integer({ minimum: COORD_XY_MIN, maximum: COORD_XY_MAX }),
    z: Type.Integer({ minimum: Z_MIN, maximum: Z_MAX }),
  },
  { additionalProperties: false },
);

export const DirectionByteSchema = Type.Union([
  Type.Integer({ minimum: 0, maximum: 7 }),
  Type.Integer({ minimum: 0x80, maximum: 0x87 }),
]);

export const Point2DValidator = TypeCompiler.Compile(Point2DSchema);
export const Point3DValidator = TypeCompiler.Compile(Point3DSchema);
export const Rect2DValidator = TypeCompiler.Compile(Rect2DSchema);
export const WorldLocationValidator = TypeCompiler.Compile(WorldLocationSchema);
export const DirectionByteValidator = TypeCompiler.Compile(DirectionByteSchema);
