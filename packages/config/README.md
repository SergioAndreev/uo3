# `@uo3/config`

Центральный пакет общих конфигураций монорепозитория UO3: пресеты TypeScript, ESLint 9 (flat config), Prettier 3, Vitest 3 и типизированная система загрузки конфигурации на базе TypeBox.

## Доступные subpath-экспорты

| Экспорт                                | Назначение                                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@uo3/config/tsconfig/base.json`       | Базовый строгий профиль TypeScript (ESM, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `declaration`, `declarationMap`) |
| `@uo3/config/tsconfig/isomorphic.json` | Изоморфный профиль без `DOM` и `@types/node` (`packages/domain`, `rules`, `protocol`, `uo-formats`, `content`)                                                                              |
| `@uo3/config/tsconfig/node.json`       | Серверный/CLI профиль для Node.js 22 (`packages/db`, `apps/asset-tool`, `apps/bot-client`)                                                                                                  |
| `@uo3/config/tsconfig/nestjs.json`     | Профиль NestJS 11 с `experimentalDecorators` и `emitDecoratorMetadata` (`apps/api`, `apps/game-server`)                                                                                     |
| `@uo3/config/tsconfig/react.json`      | Браузерный профиль React 19 + Vite (`jsx: "react-jsx"`, `moduleResolution: "Bundler"`, `DOM`)                                                                                               |
| `@uo3/config/eslint/base`              | Базовый flat-конфиг ESLint 9: строгий TS, запрет `any` и CommonJS (`require`/`module.exports`)                                                                                              |
| `@uo3/config/eslint/browser`           | Браузерный профиль безопасности и изоляции: запрет `eval`/`new Function`/строкового `setTimeout`, `@uo3/db`, `node:*`                                                                       |
| `@uo3/config/eslint/server`            | Серверный профиль изоляции: запрет `@uo3/ui-kit`, `react`, `three`                                                                                                                          |
| `@uo3/config/eslint/boundaries`        | Правила архитектурных слоёв `eslint-plugin-boundaries`, запрет `@uo3/test-kit` в production-коде и изоляция изоморфного ядра                                                                |
| `@uo3/config/prettier`                 | Общая конфигурация Prettier 3                                                                                                                                                               |
| `@uo3/config/vitest/node`              | Пресет Vitest 3 (`environment: "node"`, `@vitest/coverage-v8`, JUnit/JSON/LCOV, послойные пороги покрытия)                                                                                  |
| `@uo3/config/vitest/browser`           | Пресет Vitest 3 (`environment: "jsdom"`, `@vitest/coverage-v8`, JUnit/JSON/LCOV, послойные пороги покрытия)                                                                                 |
| `@uo3/config/env/shared`               | Общие примитивы конфигурации, коды ошибок `ConfigErrorCode`, `deepFreeze`, `redactConfig`, `redactUri`                                                                                      |
| `@uo3/config/env/server`               | Серверный загрузчик `.env*` / `*_FILE`, production-гарды, fail-fast (`exit 78`) и схемы приложений                                                                                          |
| `@uo3/config/env/client`               | Браузерный загрузчик `VITE_*` без `node:*` с запретом секретов (`CONFIG_CLIENT_SECRET_FORBIDDEN`)                                                                                           |

## Подключение в новом пакете

1. Добавьте `"@uo3/config": "workspace:*"` в `devDependencies` (или `dependencies`, если используется `@uo3/config/env/*`).
2. Унаследуйте подходящий профиль в `tsconfig.json`:
   ```json
   {
     "extends": "@uo3/config/tsconfig/isomorphic.json",
     "compilerOptions": { "rootDir": "src", "outDir": "dist" },
     "include": ["src/**/*.ts"]
   }
   ```
3. Подключите пресет Vitest в `vitest.config.ts`:
   ```ts
   import { defineConfig } from "vitest/config";
   import { createNodeVitestConfig } from "@uo3/config/vitest/node";

   export default defineConfig(createNodeVitestConfig({ layer: "standard" }));
   ```
4. Корневые `eslint.config.mjs` и `.prettierrc` применяются автоматически ко всему монорепозиторию.
