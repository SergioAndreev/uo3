# AGENTS.md — правила для ИИ-агентов

Этот репозиторий — **техническое задание** (spec-driven, OpenSpec) на веб-MMORPG в духе Ultima Online. Код реализации появляется только через цикл OpenSpec.

## Перед началом работы
1. Прочитай [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (ADR и константы), [docs/ROADMAP.md](docs/ROADMAP.md) (фазы и реестр capability), [docs/GLOSSARY.md](docs/GLOSSARY.md) и [docs/PROTOCOL_REGISTRY.md](docs/PROTOCOL_REGISTRY.md) (единый реестр опкодов и WS-кодов).
2. Работай строго по одной фазе: `openspec/changes/pNN-*`. Не начинай фазу, пока не заархивированы её зависимости из ROADMAP.
3. Сверься со статусом: `openspec list`, `openspec status --change <id>`.

## Цикл реализации фазы
1. `/opsx-apply <change-id>` (или `openspec instructions apply --change <id>`).
2. Выполняй задачи из `tasks.md` по порядку; каждая задача содержит критерий проверки — задача закрыта (`- [x]`) только когда проверка пройдена.
3. Требования в `specs/**/spec.md` — контракт поведения; сценарии WHEN/THEN превращаются в тесты.
4. Технические решения — в `design.md`; отклонение от них требует обновления design.md в том же PR.
5. После выполнения всех задач: `openspec validate <id> --strict`, затем `/opsx-archive <id>` — дельты переносятся в `openspec/specs/`.

## Жёсткие правила
- Сервер авторитарен; клиент только отправляет намерения.
- Никаких проприетарных ассетов UO в репозитории и тестах — только синтетический мир и CC0-заглушки.
- Общие формулы — только в `packages/rules`; общие типы — в `packages/domain`; протокол — в `packages/protocol`.
- Тесты и документация пишутся в той же группе задач, что и код.
- Язык артефактов — русский; ключевые слова OpenSpec (SHALL/MUST, WHEN/THEN, заголовки) — английские.
