# @duskmarch/config

| Экспорт        | Назначение                                                                 |
| -------------- | -------------------------------------------------------------------------- |
| `./tsconfig/*` | `base`, `isomorphic` (без DOM и Node), `node`, `nestjs`, `react` (`.json`) |
| `./eslint/*`   | flat-конфиги `base`, `browser`, `server`, `boundaries`                     |
| `./prettier`   | общий формат                                                               |
| `./vitest/*`   | `nodePreset`, `browserPreset`, пороги `core` 85/80 и `default` 70/65       |
| `./env/*`      | загрузка конфигурации: `shared`, `server`, `client`                        |

## Подключение

Добавьте `"@duskmarch/config": "workspace:*"` в `devDependencies`, затем унаследуйте
`@duskmarch/config/tsconfig/<профиль>.json` и создайте `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { nodePreset } from '@duskmarch/config/vitest/node';

export default defineConfig(nodePreset('core'));
```
