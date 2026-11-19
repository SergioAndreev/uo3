# Proposal: P18 Магия

## Why

После завершения систем характеристик и навыков (P15) и боевой системы ближнего/дальнего боя (P16) игровой процесс нуждается в полноценной системе классической магии эпохи **Ultima Online: Renaissance (UO:R)**. В UO:R магия (`Magery`, `Evaluating Intelligence`, `Resisting Spells`, `Inscription`, `Meditation`) составляет фундаментальную половину как PvP-, так и PvE-боя, а также обеспечивает ключевую пространственную мобильность мира (`Teleport`, `Mark`, `Recall`, `Gate Travel`), контроль территории через магические поля (`Wall of Stone`, `Fire/Poison/Paralyze/Energy Field`) и тактический призыв существ (`Blade Spirits`, `Energy Vortex`, элементали, демон).

Без детерминированного серверно-авторитарного конвейера чтения заклинаний, каталога всех 64 заклинаний 8 кругов, механики книг заклинаний (`Spellbook`), свитков (`SpellScroll`), рун (`RecallRune`) и рунбук (`Runebook`), а также системы сопротивления и отражения магии невозможно реализовать ни сбалансированный бой (прерывание каста уроном, комбо `Explosion -> Energy Bolt`, снятие паралича через `Magic Trap`), ни полноценный ИИ монстров-магов (P19), ни ремесло начертания свитков `Inscription` (P20), ни защиту домов от телепортации (P23).

## What Changes

- **Авторитарный конвейер чтения заклинаний (`magic/spellcasting`)**:
  - Вводится конечный автомат каста на тиковой симуляции 20 Гц (50 мс): `Idle -> Casting -> AwaitingTarget -> Resolving -> Recovery -> Idle`.
  - Фиксируются канонические тайминги UO:R по кругам `1..8`: длительность чтения `CastDelay = 500 + 250 * circle` мс (`750..2500` мс для обычных заклинаний, `4000..5000` мс для призывов), пауза восстановления `CastRecovery = 1250` мс (25 тиков), окно ожидания курсора цели до `30 000` мс.
  - Реализуется заморозка движения во время фазы `Casting` (отклонение шагов с `ERR_CASTING_FROZEN`) и разрешение свободного перемещения после завершения чтения в фазе `AwaitingTarget`.
  - Реализуется автоэкипировка рук при старте каста: снятие любого оружия и щитов из слотов `0x01`/`0x02` в рюкзак (кроме `Spellbook` и посохов с флагом `SpellChanneling`).
  - Вводятся формулы шанса успеха `Magery` по кругам (с бонусом `-250` десятых порога сложности при касте со свитка), правила физзла (`Fizzle` со списанием 100% реагентов книги и 50% маны без потери свитка) и прерывания каста при получении любого урона `FinalDamage >= 1` или паралича.
- **Каталог 64 заклинаний 8 кругов (`magic/spell-catalog`)**:
  - Декларативный типизированный реестр всех 64 заклинаний (`spellId 1..64`) в `@uo3/content` и изоморфные резолверы эффектов в `@uo3/rules`.
  - Точные формулы урона прямых боевых заклинаний (`Magic Arrow`, `Harm`, `Fireball`, `Lightning`, `Mind Blast`, `Energy Bolt`, `Explosion` с отложенной детонацией `2000` мс, `Flame Strike`) и массовых AoE (`Chain Lightning`, `Meteor Swarm`, `Earthquake`) с модификатором `Evaluating Intelligence`.
  - Механики исцеления и поддержки (`Heal`, `Greater Heal` с блокировкой при отравлении цели, `Cure`, `Arch Cure`, `Resurrection`), баффов/дебаффов статов и брони (`Clumsy`, `Feeblemind`, `Weaken`, `Curse`, `Agility`, `Cunning`, `Strength`, `Bless`, `Reactive Armor`, `Protection`, `Arch Protection`, `Polymorph`), контроля (`Poison`, `Paralyze`, `Mana Drain`, `Mana Vampire`), утилит (`Night Sight`, `Invisibility`, `Reveal`, `Magic Trap`, `Magic Untrap`, `Magic Lock`, `Magic Unlock`, `Telekinesis`, `Incognito`) и перемещения (`Teleport`, `Mark`, `Recall`, `Gate Travel`).
- **Книги заклинаний, свитки, руны и рунбуки (`magic/spellbooks-and-scrolls`)**:
  - Модель `Spellbook` с 64-битной маской `spellsBitmask` (`uint64`), вписывание свитков Drag-and-Drop, гамп книги заклинаний и быстрый запуск каста по `spellId`.
  - Модель `SpellScroll` (`spellId 1..64`), каст со свитка без реагентов и без книги со снижением порога `Magery` на 2 круга.
  - Модель `RecallRune` (`facetId, x, y, z, isMarked, description`), запись точки через `Mark`, переименование, проверка блокировки целевого тайла при прыжке.
  - Модель `Runebook` (до 16 рун, `defaultSlot`, заряды `charges / maxCharges`, подзарядка свитками `Recall`, прыжок за заряд и через заклинания) и статус `Blessed / Newbied` для `Spellbook` и `Runebook` при смерти.
- **Магические поля, порталы и призыв существ (`magic/fields-and-summons`)**:
  - Геометрия размещения полей `5×1` перпендикулярно вектору взгляда с индивидуальной проверкой 3D LOS каждого тайла.
  - Интеграция непроходимых барьеров (`Wall of Stone`, `Energy Field`) в `DynamicTileProvider` (P03/P12) и тиковая обработка проходимых полей (`Fire Field`, `Poison Field`, `Paralyze Field`) каждые `1000` мс и при входе на тайл.
  - Двусторонние межпартиционные порталы `Gate Travel` (`Moongate`) длительностью `30 000` мс.
  - Система призыва контролируемых существ (`Summon Creature`, `Summon Daemon`, элементали) с лимитом `5` слотов контроля (`controlSlots`) и автономных духов (`Blade Spirits`, `Energy Vortex`) с эвристикой выбора целей, а также развеивание через `Dispel`, `Dispel Field` и `Mass Dispel`.
- **Сопротивление магии и отражение (`magic/spell-resistance`)**:
  - Формулы проверки навыка `Resisting Spells` (`skillId 26`) в зависимости от круга заклинания `1..8`, `Magery` кастера и `Resisting Spells` цели.
  - Полная нейтрализация заклинаний контроля (`Paralyze`, `Poison`, `Mana Drain/Vampire`) и снижение входящего прямого магического урона на `50%` при успешном резисте.
  - Щит `Magic Reflection` (`spellId 36`) с одноразовым отражением направленного враждебного заклинания обратно в кастера, защитой от бесконечного пинг-понга (`isReflected = true`) и кулдауном `30 000` мс.

## Capabilities

### New Capabilities
- `magic/spellcasting`: серверно-авторитарный жизненный цикл чтения заклинаний, тайминги кругов, автоэкипировка рук, проверка маны и реагентов, расчёт шанса Magery, физзл, прерывание уроном и пауза восстановления.
- `magic/spell-catalog`: декларативный реестр и детерминированные резолверы всех 64 канонических заклинаний 8 кругов UO:R (боевые, AoE, исцеление, баффы/дебаффы, контроль, утилиты и телепортация).
- `magic/spellbooks-and-scrolls`: механика книг заклинаний (64-битная маска), вписывания и использования свитков, маркировки и переименования рун, а также управления рунбуками на 16 слотов с зарядами.
- `magic/fields-and-summons`: создание и тиковая симуляция магических полей 5×1, двусторонних порталов Gate Travel, контролируемых и автономных призванных существ со слотами контроля и механиками развеивания Dispel.
- `magic/spell-resistance`: расчёт шанса и эффектов навыка Resisting Spells против урона и контроля, одноразовый щит отражения Magic Reflection с защитой от рекурсивного отражения и взаимодействие с защитными баффами.

### Modified Capabilities

## Impact

- **Затрагиваемые пакеты и приложения**:
  - `packages/domain`: типы `SpellId` (`1..64`), `SpellCircle` (`1..8`), `ReagentId` (8 видов), `SpellTargetType`, `CastSourceType`, `FieldType`, `SummonArchetypeId`, флаги заклинаний и коды ошибок `ERR_SPELL_*`.
  - `packages/content`: декларативный каталог `spells.yaml` (64 заклинания), рецепты реагентов, таблицы параметров полей и архетипов призываемых существ + JSON Schema валидация.
  - `packages/rules`: чистые детерминированные функции `magic/*` (конечный автомат каста, формулы `Magery`/`EvalInt`/`Resist`, геометрия полей 5×1, резолверы всех 64 заклинаний, тиковые обработчики полей и саммонов).
  - `packages/protocol`: uint16 опкоды `0x01F0..0x021F` (каст из книги/свитка/макроса, события старта каста, физзла, эффекта/снаряда, обновления `Spellbook`/`Runebook`, действия с рунбукой и переименование руны).
  - `packages/db`: таблицы/колонки сохранения свойств `Spellbook` (`spells_bitmask`), `RecallRune` (`marked_facet_id`, `marked_x/y/z`, `rune_description`), `Runebook` (`entries_jsonb`, `charges`, `max_charges`, `default_slot`) в `world_items`.
  - `apps/game-server`: интеграция `MagicSystem` в 20 Гц цикл `WorldPartitionRoom`, связь с `CombatSystem` (прерывание каста при уроне), `DynamicTileProvider` (поля и порталы), `TargetCursorManager` (P14) и межпартиционным `TeleportSync`/`PartitionHandoffTicket` (P12/P32).
  - `apps/client` и `packages/ui-kit`: гампы `SpellbookGump`, `RunebookGump`, выносные иконки заклинаний, рендер летящих снарядов (`Fireball`, `Energy Bolt`), молний, полей 5×1 и порталов `Moongate`.
- **Зависимости от предыдущих фаз**: опирается на P03 (`DynamicTileProvider` и 3D DDA LOS), P06 (тик 20 Гц и таймеры), P07 (`IntentHandlerRegistry`), P11 (анимации каста и `castRelease`), P12 (`checkMovement`, `TeleportSync`), P13 (инвентарь, стаки реагентов и свитков, слои `0x01`/`0x02`), P14 (`TargetCursorManager`, `SpeechRouter`, гамп книги заклинаний), P15 (статы, мана, пайплайн `SkillCheck`/`SkillGain` для `Magery`, `Evaluating Intelligence`, `Resisting Spells`) и P16 (хук прерывания каста при `FinalDamage >= 1`, `ICombatLegalityPolicy`, `AggressorRecord`).
- **Зависимость от P17**: криминальная атрибуция `Harmful`/`Beneficial` действий магии, полей и призывов выполняется через порт `ICombatLegalityPolicy` (P16), реализация которого поставляется уже завершённой фазой P17.
- **Разблокируемые фазы**: P19 (NPC и ИИ — кастующие монстры и ИИ саммонов), P20 (Крафт — навык `Inscription` для крафта свитков, книг и рунбук), P23 (Дома — запрет `Mark`/`Recall`/`Gate`/`Teleport` в приватные дома), P28 (Аудио и VFX — звуки и партиклы 64 заклинаний).

### Вне скоупа
- Полная матрица репутации, флагования `Criminal`/`Murderer`, гвардов города и кармы/славы (реализована в предшествующей фазе **P17** и подключается через порт `ICombatLegalityPolicy`).
- Полноценный BTree-интеллект диких монстров и приручение животных `Animal Taming` (реализуется в **P19**; в P18 реализуется базовый контроллер призванных существ и духов `Blade Spirits` / `Energy Vortex`).
- Ремесленное создание пустых свитков, написание свитков и рунбук навыком `Inscription` и варка зелий `Alchemy` (реализуется в **P20**).
- Правила владения домами, бан-листы домов и блокировка телепортации на крыши/внутрь кастомных домов (расширяется в **P23** через порт `IRegionSpellPolicy`).
- Продвинутые шейдерные партиклы и позиционный 3D WebAudio-микшер звуков заклинаний (реализуется в **P28**; в P18 передаются канонические `effectId` и `soundId`).
