import { Type } from '@sinclair/typebox';
import { AppEnv, LogLevel, Url } from '../../shared/index.js';

const common = {
  VITE_APP_ENV: AppEnv({ description: 'Среда приложения' }),
  VITE_API_BASE_URL: Url('http', { description: 'Адрес API' }),
  VITE_LOG_LEVEL: LogLevel({ description: 'Уровень логирования' }),
};

export const AdminEnvSchema = Type.Object(common);

export const ClientEnvSchema = Type.Object({
  ...common,
  VITE_GAME_WS_URL: Url('ws', { description: 'Адрес игрового сервера' }),
  VITE_ASSET_MODE: Type.Union([Type.Literal('synthetic'), Type.Literal('bundled')], {
    default: 'synthetic',
    description: 'Источник ассетов',
  }),
});
