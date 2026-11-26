# Профиль правил

`@duskmarch/rules` собирает профиль так: пресет → переопределение шарда → схема TypeBox → межполевые инварианты → глубокая заморозка.

```ts
import { buildProfile, fingerprint, publicProfile } from '@duskmarch/rules';
const profile = buildProfile('standard', { features: { playerBounties: false } });
```

- **Пресеты:** `standard` (значения ARCHITECTURE §5, `DUSKMARCH`) и `proving` (только план `proving`, время в 10 раз быстрее).
- **Переопределение:** объекты сливаются по ключам, массивы заменяются; `id` и `preset` не переопределяются. Неизвестный флаг — `ERR_UNKNOWN_FEATURE_FLAG`, нарушение схемы — `ERR_RULESET_SCHEMA`.
- **Инварианты:** бег быстрее ходьбы (и верхом), шаги не короче тика, `stats.min × 3 ≤ stats.totalCap ≤ stats.max × 3`, `skills.maxTenths ≤ skills.totalCapTenths`, радиусы и дальности речи по возрастанию, уникальные id планов, диапазон света у каждого плана. Все нарушения — одной ошибкой `ERR_RULESET_INVARIANT` с путями в `details.violations`.
- **Флаги функций:** `realmDusk`, `mounts`, `housing`, `seafaring`, `beaconTravel`, `playerBounties`.
- **Отпечаток:** `fingerprint(profile)` — SHA-256 канонического JSON, собственная изоморфная реализация.
- **Клиентский срез:** `publicProfile(profile)` без `reputation` и `limits`, с отпечатком.
- **Формулы:** здоровье `60 + floor(Мощь × 0,6)`, запал `40 + floor(Сноровка × 0,8)`, созвучие `40 + floor(Воля × 0,8)`, вес `50 + floor(Мощь × 1,5)` кг; `stepMs`, `checkStats`, `checkSkills`. Только целая арифметика.

## Шард

`game-server` читает `SHARD_RULESET_PRESET` (по умолчанию `standard`) и необязательный `SHARD_RULESET_FILE` (JSON или YAML), при ошибке завершается с кодом `78` и печатает пути полей. Пример файла:

```yaml
features:
  playerBounties: false
limits:
  groundDecayMs: 1800000
```
