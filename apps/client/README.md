# `@uo3/client`

Игровой браузерный клиент UO3 (**React 19 + Vite 6**). В фазе P00 содержит валидацию публичной клиентской конфигурации (`ClientEnvSchema`), изоморфные импорты без Node-полифиллов, Vite-плагин защиты от утечки серверных секретов в бандл и генерацию `dist/bundle-stats.json`.

## Команды

```bash
pnpm --filter @uo3/client dev
pnpm --filter @uo3/client build
pnpm --filter @uo3/client test:coverage
```
