# Дельта: domain/ruleset-profile

## MODIFIED Requirements

### Requirement: Встроенный профиль duskmarch
Пакет `@duskmarch/rules` MUST предоставлять глубоко замороженный профиль `duskmarch` версии `2`, значения которого совпадают с таблицей констант ARCHITECTURE §5 и таблицей профиля в design.md. Изменение любого значения по умолчанию MUST повышать версию профиля.

#### Scenario: Чтение констант
- **WHEN** запрашивается профиль `duskmarch`
- **THEN** `movement.walkMs = 360`, `movement.runMs = 220`, `skills.totalCapTenths = 6 000`, `stats.totalCap = 240`

#### Scenario: Неизменяемость
- **WHEN** код пытается изменить `stats.totalCap` профиля в строгом режиме
- **THEN** возникает `TypeError`

## ADDED Requirements

### Requirement: Параметры создания героя
Профиль правил SHALL содержать блок `creation`: `statPool`, `statMin`, `statMax`, `skillPoolTenths`, `skillMinTenths`, `skillMaxTenths`, `maxStartSkills` и требования навыков к флагам функций `skillFeatures`. Добавление блока повышает версию профиля `duskmarch` до `2`. Инварианты MUST проверять, что `3 × statMin ≤ statPool ≤ 3 × statMax`, `statMax ≤ stats.max` и `skillMinTenths ≤ skillMaxTenths ≤ skills.maxTenths`.

#### Scenario: Пресет standard
- **WHEN** читается `creation` пресета `standard`
- **THEN** `statPool = 90`, `statMin = 10`, `statMax = 60`, `skillPoolTenths = 1000`, `skillMaxTenths = 500`, `maxStartSkills = 3`

#### Scenario: Пресет proving
- **WHEN** читается `creation` пресета `proving`
- **THEN** `skillPoolTenths = 2000` и `skillMaxTenths = 1000`, остальные пределы как у `standard`

#### Scenario: Нарушение инварианта
- **WHEN** переопределение задаёт `statPool = 200` при `statMax = 60`
- **THEN** сборка профиля отклоняется с ошибкой `ERR_RULESET_INVARIANT` и путём `creation.statPool`

#### Scenario: Навык зависит от флага
- **WHEN** у шарда выключен флаг `seafaring`
- **THEN** функция доступности стартовых навыков исключает `sailing`
