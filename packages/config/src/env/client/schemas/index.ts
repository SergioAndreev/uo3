import { Type, type Static } from "@sinclair/typebox";
import { HttpUrlSchema, LogLevelSchema, NodeEnvSchema, WsUrlSchema } from "../../shared/index.js";

export const ClientEnvSchema = Type.Object(
  {
    VITE_APP_ENV: NodeEnvSchema("development"),
    VITE_API_BASE_URL: HttpUrlSchema({ description: "Базовый HTTP URL мета-API (apps/api)" }),
    VITE_GAME_WS_URL: WsUrlSchema({
      description: "WebSocket URL игрового сервера (apps/game-server)",
    }),
    VITE_ASSET_MODE: Type.Union([Type.Literal("synthetic"), Type.Literal("user-folder")], {
      default: "synthetic",
      description: "Режим загрузки ассетов (synthetic | user-folder)",
    }),
    VITE_LOG_LEVEL: LogLevelSchema("info"),
  },
  { additionalProperties: false },
);
export type ClientEnv = Static<typeof ClientEnvSchema>;

export const AdminEnvSchema = Type.Object(
  {
    VITE_APP_ENV: NodeEnvSchema("development"),
    VITE_API_BASE_URL: HttpUrlSchema({ description: "Базовый HTTP URL мета-API (apps/api)" }),
    VITE_LOG_LEVEL: LogLevelSchema("info"),
  },
  { additionalProperties: false },
);
export type AdminEnv = Static<typeof AdminEnvSchema>;
