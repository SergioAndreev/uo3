# Identity: аккаунты, сессии, 2FA, права персонала

Модуль `apps/api/src/identity` (фаза P04). Контракт — спецификации `openspec/specs/identity/*`, решения — `design.md` фазы.

## Устройство

| Каталог | Содержимое |
|---|---|
| `core/` | Сервисы: `RegistrationService`, `AuthService`, `TwoFactorService`, `SecurityService`, `StaffService`, `OAuthService`; ошибки, лимиты, outbox |
| `crypto/` | argon2id, JWT EdDSA и JWKS, TOTP (RFC 6238), AES-256-GCM, резервные коды, UUIDv7 |
| `ports.ts` | `IdentityStore`, `KeyValue`, `MailTransport`, `EventPublisher` |
| `memory/` | Реализации портов в памяти для unit-тестов |
| `infra/` | PostgreSQL (Drizzle), Valkey, NATS |
| `mail/` | Журнальный транспорт (разработка) и собственный SMTP-клиент (STARTTLS, `smtps://`, AUTH PLAIN) |
| `http/` | Контроллеры NestJS, охранник `IdentityGuard`, фильтр ошибок, cookie |
| `runtime.ts` | Сборка из конфигурации `IDENTITY_*`, `MAIL_*`, `OAUTH_*` |

Права персонала — чистые функции `@duskmarch/domain` (`evaluateAccess`, `canActOn`, `canAssign`), их же использует игровой сервер. Таблица разрешений — [packages/domain/docs/access.md](../../../packages/domain/docs/access.md).

## Вход

1. `POST /api/v1/auth/login` → `authenticated` (Access JWT в теле, refresh — cookie `dm_refresh`), `mfa_required` (`mfaChallengeToken` на 5 минут) или `staff_2fa_setup_required` (ограниченный токен: только `/account/2fa/setup`, `/account/2fa/confirm`, `/auth/logout`).
2. `POST /api/v1/auth/mfa/verify` — TOTP или резервный код.
3. `POST /api/v1/auth/refresh` — с доверенного `Origin`; каждый вызов ротирует refresh. Повтор использованного токена отзывает сессию.

Защищённые запросы передают `Authorization: Bearer <Access JWT>`. Охранник проверяет подпись и срок, затем одним запросом к Valkey — список отзыва сессий и бан.

## Ошибки

`{ "error": { "code": "AUTH_SESSION_REVOKED", "message": "…", "details": { … } } }`. Коды и HTTP-статусы — `IDENTITY_ERRORS` в `@duskmarch/protocol`; при ограничении частоты добавляется `Retry-After`.

## События NATS

Через outbox публикуются `identity.account.banned`, `unbanned`, `sessions_revoked`, `access_level_changed`, `effective_level_changed` (схемы — `IDENTITY_EVENTS`). Игровой сервер по ним закрывает соединение кодами `4103` и `4123` из реестра протокола.

## Первый владелец

```sh
# зарегистрируйтесь и подтвердите адрес, затем:
pnpm --filter @duskmarch/api identity:bootstrap-owner --email you@example.com
```

Команда отказывает, если владелец уже есть. Остальные уровни назначает владелец или администратор через `POST /api/v1/staff/accounts/:id/access-level`.

## Разработка

- Без `IDENTITY_JWT_SIGNING_KEYS_JSON`, `IDENTITY_TOTP_KEYS_JSON`, `IDENTITY_BACKUP_CODE_PEPPER` ключи создаются при старте (в журнале предупреждение); в production старт с пустыми ключами невозможен.
- `MAIL_TRANSPORT=log` печатает письма в журнал — ссылки подтверждения видны в консоли. В production разрешён только `smtp`.
- Ключ Ed25519: `node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}))"`.
- Ключ TOTP: `openssl rand -base64 32`.

## Тесты

- `pnpm --filter @duskmarch/api test` — сценарии спецификаций на хранилище в памяти и e2e через HTTP.
- `pnpm --filter @duskmarch/api test:integration` — контракт хранилища на PostgreSQL и Valkey, публикация в NATS, полный цикл HTTP на локальном стеке.
