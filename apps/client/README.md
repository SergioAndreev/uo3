# @duskmarch/client

Игровой клиент (Vite, React). Переменные — только `VITE_*`, см. `.env.example`.

- `pnpm --filter @duskmarch/client dev` — <http://localhost:5273>;
- `pnpm --filter @duskmarch/client build` — сборка и `dist/bundle-stats.json`. Сборка прерывается, если в бандле есть серверный секрет или модуль Node.js.
