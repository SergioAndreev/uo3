# @duskmarch/bot-client

Headless-клиент для нагрузки; доступ к БД запрещён границами. Команды: `--version`, `ping-health`. Переменные — в `.env.example`.

Запуск: `pnpm --filter @duskmarch/bot-client build && node apps/bot-client/dist/index.js --version`. Некорректное окружение завершает процесс с кодом `78`.
