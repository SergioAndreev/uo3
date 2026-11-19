# `@uo3/bot-client`

Headless Node 22 клиент для нагрузочного и сценарного тестирования UO3 (P35). Изолирован от `@uo3/db` (взаимодействие только по HTTP/WebSocket протоколу).

## Команды

```bash
pnpm --filter @uo3/bot-client build
node apps/bot-client/dist/index.js --version
node apps/bot-client/dist/index.js ping-health
pnpm --filter @uo3/bot-client test:coverage
```
