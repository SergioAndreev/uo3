# Локальная инфраструктура разработки UO3 (`infra/local`)

Стенд управляется через корневой `docker-compose.yml` с двумя профилями:

- **`core`** (базовый, < 512 МБ ОЗУ): PostgreSQL 17 (`uo3_dev` + `uo3_test`), Valkey 8, NATS 2.10+ с JetStream.
- **`observability`** (опциональный): OpenTelemetry Collector, Prometheus, Loki, Tempo, Grafana с автопровижинингом источников данных и дашборда `uo3-local-health`.

## Карта портов и переменных переопределения

| Сервис           | Профиль         | Переменная          | Порт по умолчанию | Назначение / URL                                     |
| ---------------- | --------------- | ------------------- | ----------------- | ---------------------------------------------------- |
| `postgres`       | `core`          | `PG_PORT`           | `5432`            | PostgreSQL 17 (`uo3_dev`, `uo3_test`)                |
| `valkey`         | `core`          | `VALKEY_PORT`       | `6379`            | Valkey 8 (presence / сессии / rate-limit)            |
| `nats`           | `core`          | `NATS_PORT`         | `4222`            | Клиентский порт NATS JetStream                       |
| `nats`           | `core`          | `NATS_MONITOR_PORT` | `8222`            | HTTP мониторинг: `http://localhost:8222/jsz`         |
| `otel-collector` | `observability` | `OTEL_GRPC_PORT`    | `4317`            | OTLP gRPC                                            |
| `otel-collector` | `observability` | `OTEL_HTTP_PORT`    | `4318`            | OTLP HTTP                                            |
| `prometheus`     | `observability` | `PROMETHEUS_PORT`   | `9090`            | `http://localhost:9090`                              |
| `loki`           | `observability` | `LOKI_PORT`         | `3100`            | `http://localhost:3100`                              |
| `tempo`          | `observability` | `TEMPO_PORT`        | `3200`            | `http://localhost:3200`                              |
| `grafana`        | `observability` | `GRAFANA_PORT`      | `3000`            | `http://localhost:3000` (дашборд `uo3-local-health`) |

## Команды запуска

```bash
# Базовый стек (PostgreSQL, Valkey, NATS JetStream)
docker compose --profile core up -d --wait

# Базовый стек + наблюдаемость (OTel, Prometheus, Loki, Tempo, Grafana)
docker compose --profile core --profile observability up -d --wait

# Остановка (данные сохраняются в именованных томах)
docker compose --profile core --profile observability down
```

## Параллельные git worktrees без конфликтов портов

Переопределите порты и имя проекта Compose:

```bash
PG_PORT=15432 VALKEY_PORT=16379 NATS_PORT=14222 NATS_MONITOR_PORT=18222 \
  docker compose -p uo3-wt2 --profile core up -d --wait
```
