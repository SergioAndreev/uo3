# Локальный стенд

`docker compose --profile core up -d --wait` — база; добавьте `--profile observability` для метрик,
логов и трейсов. Порты доступны только на `127.0.0.1`; у сервисов заданы лимиты памяти.

| Сервис           | Профиль       | Переменная          | Порт |
| ---------------- | ------------- | ------------------- | ---- |
| PostgreSQL 17    | core          | `PG_PORT`           | 5432 |
| Valkey 8         | core          | `VALKEY_PORT`       | 6379 |
| NATS             | core          | `NATS_PORT`         | 4222 |
| NATS, мониторинг | core          | `NATS_MONITOR_PORT` | 8222 |
| OTLP gRPC        | observability | `OTEL_GRPC_PORT`    | 4317 |
| OTLP HTTP        | observability | `OTEL_HTTP_PORT`    | 4318 |
| Prometheus       | observability | `PROMETHEUS_PORT`   | 9090 |
| Loki             | observability | `LOKI_PORT`         | 3100 |
| Tempo            | observability | `TEMPO_PORT`        | 3200 |
| Grafana          | observability | `GRAFANA_PORT`      | 3000 |

Grafana: <http://localhost:3000> (вход не нужен), Prometheus: <http://localhost:9090>,
NATS: <http://localhost:8222/jsz>. Источники данных и дашборд `duskmarch-local-health` подключаются
автоматически.

## Несколько рабочих копий

В `.env` каждой копии задайте свои порты и при необходимости `COMPOSE_PROJECT_NAME`; обновите
адреса в `DATABASE_URL` и файлах `.env` приложений. Пароль PostgreSQL применяется только при
создании тома.
