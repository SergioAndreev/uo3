# @duskmarch/admin

Веб-консоль персонала (Vite, React). Переменные — только `VITE_*`, см. `.env.example`.

- `pnpm --filter @duskmarch/admin dev` — <http://localhost:5274>;
- `pnpm --filter @duskmarch/admin build` — сборка и `dist/bundle-stats.json`. Сборка прерывается, если в бандле есть серверный секрет или модуль Node.js.
