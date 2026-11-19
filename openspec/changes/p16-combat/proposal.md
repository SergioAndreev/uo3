# Proposal: P16 Бой

## Why

Фаза P15 ввела фундаментальную модель из 49 навыков, триггеры их прокачки, расчёт первичных и вторичных характеристик (`STR`/`DEX`/`INT`, `Hits`/`Stam`/`Mana`), пассивную регенерацию и окно статуса персонажа. Однако без авторитарной боевой подсистемы навыки `Swordsmanship`, `Mace Fighting`, `Fencing`, `Archery`, `Wrestling`, `Tactics`, `Anatomy`, `Parrying`, `Lumberjacking`, `Healing`, `Veterinary` и `Poisoning`, а также экипировка оружия и доспехов из P13–P14 остаются пассивными атрибутами и не формируют игровой цикл риска, противостояния и утраты трофеев.

Фаза **P16 (`p16-combat`)** реализует каноническую боевую механику эпохи **Ultima Online: Renaissance (UO:R)** на серверном тике 20 Гц (50 мс): переключение режима `War/Peace`, авторитарное удержание цели (`Combatant`), таймер замаха (`Swing Timer`) с учётом текущей `Stam`, формулы попадания и урона (`Tactics`, `Anatomy`, `STR`, `Lumberjacking`), специальные удары двуручного оружия (`Concussion Blow`, `Crushing Blow`, `Paralyzing Blow`), стрельбу с задержкой после остановки и расходом боеприпасов, зональное поглощение урона бронёй (`AR`) и парирование (`Parrying`), износ экипировки, перевязку бинтами (`Bandages`), систему из 5 уровней яда (`Lesser`..`Lethal`) и полный цикл смерти, превращения в призрака (`0x0192`/`0x0193`), контейнера трупа (`Corpse`, `0x2006`) и воскрешения.

## What Changes

- **Режим боя и прицеливание (`combat/war-mode-and-targeting`):**
  - Авторитарное переключение `WarMode` (`true`/`false`), сброс мирных состояний и блокировка опасных действий в режиме `Peace`.
  - Выбор активной цели (`Combatant`), проверка дистанции видимости (`AOI` ≤ 18 тайлов), геометрического 3D DDA Line-of-Sight (P03) и валидности мобиля.
  - Матрица боевой вовлечённости (`AggressorEntry` / `CombatEngagement`, базовый TTL 120 с) как источник данных для криминального статуса и охраны в P17.
  - Автоматический запуск и продолжение автоатаки при сближении на дистанцию оружия и правила сброса цели при смерти, телепортации или выходе за радиус 24 тайлов.
- **Ближний и дальний бой (`combat/melee-and-ranged`):**
  - Тиковый `SwingTimer` на базе скорости оружия и текущей выносливости `Stam`: `SwingDelayTicks = max(25, ceil(300000 / ((Stam + 100) * WeaponSpeed)))` — каноническая формула UO:R `15000 / ((Stam + 100) * WeaponSpeed)` секунд в тиках по 50 мс, минимум 1.25 с (25 тиков).
  - Формула вероятности попадания `HitChance = floor(((AtkSkill + 50.0) * 100) / ((DefSkill + 50.0) * 2))` с порогом минимум 2 % и проверкой через детерминированный ГСЧ.
  - Бой без оружия (`Wrestling`, базовый урон `1d8`, скорость 30–50 от `DEX`) и учёт всех боевых навыков (`Swordsmanship`, `Mace Fighting`, `Fencing`, `Archery`, `Wrestling`).
  - Стрельба (`Archery`): обязательная пауза `StandingDelay` 0.5 с (10 тиков) после завершения шага перед выстрелом, проверка дистанции 1..10 тайлов и 3D LOS, списание стрел/болтов (`Arrows`/`Bolts`) и шанс 50 % сохранения пролетевшего снаряда на земле или в паке цели.
  - Специальные удары двуручного оружия UO:R с шансом `floor(Anatomy / 4) %`: `Concussion Blow` (дробящие топоры/алебарды — временное уполовинивание `INT`/`Mana` на 30 с), `Crushing Blow` (двуручное дробящее при `Stam >= 60` — `+50 %` урона за 10 `Stam`), `Paralyzing Blow` (двуручные копья — паралич на 4 с игрокам и 8 с NPC).
- **Урон, броня, парирование и износ (`combat/damage-and-armor`):**
  - Многоступенчатый конвейер физического урона в `@uo3/rules`: базовый кубик `XdY + Z`, модификатор `Tactics` (`(Tactics + 50) %`), бонус `STR` (`floor(STR * 0.2) %`), бонус `Anatomy` (`floor(Anatomy * 0.2) %`, `+30 %` при GM 100.0) и бонус `Lumberjacking` для топоров (`floor(Lumberjacking * 0.2) %`, `+30 %` при GM 100.0).
  - Парирование (`Parrying`): со щитом шанс `floor(Parrying / 2) %` и поглощение `floor(ShieldAR * (50 + Parrying / 2) / 100)` (в дальнем бою `/ 2`); с двуручным оружием шанс `floor(Parrying / 4) %`.
  - Взвешенная таблица зон попадания (`Body` 44 %, `Arms` 14 %, `Head` 14 %, `Legs` 14 %, `Neck` 7 %, `Hands` 7 %), расчёт локального и суммарного `Armor Rating (AR)`, поглощение `Absorbed = random(floor(ZoneAR / 2), ZoneAR)` и уполовинивание остатка.
  - Сжигание `Stam` у цели (особенно от `Mace Fighting`), сбивание заклинаний/перевязки и деградация прочности (`HP`/`MaxHP`) оружия, щитов и брони (4 % шанс потери 1 ед. прочности при ударе/попадании).
- **Лечение бинтами и яды (`combat/healing-and-poison`):**
  - Перевязка бинтами (`Bandages` → `Bloody Bandages`): длительность на себя `max(4.0, 11.0 - floor(DEX / 20))` с, на союзника `max(2.0, 4.0 - floor(DEX / 60))` с (при воскрешении фикс. 5.0 с / 10.0 с), штраф «соскользнувших пальцев» (`Slip`) от входящих ударов по +0.5 с..+1.0 с (до 3 раз перед срывом), объём лечения от `Healing`/`Veterinary` + `Anatomy`.
  - Снятие яда бинтами (при `Healing >= 60.0` и `Anatomy >= 60.0`) и воскрешение призрака бинтами (при `Healing >= 80.0` и `Anatomy >= 80.0`, расход 5–10 бинтов).
  - Подсистема 5 уровней яда (`Lesser`, `Regular`, `Greater`, `Deadly`, `Lethal`): периодические тики урона в процентах от текущих/максимальных `Hits`, блокировка пассивной регенерации `Hits`, нанесение яда с отравленного клинка (`Corrosion`/`Charges`, шанс `floor(Poisoning / 4) %`) и учёт в триггерах прокачки P15.
- **Смерть, призрак, труп и воскрешение (`combat/death-and-resurrection`):**
  - Атомарный переход при `Hits <= 0`: смена тела на призрака (`0x0192` муж., `0x0193` жен.), экипировка савана (`Death Shroud`), сброс ядов, боевых таймеров и активного прицела.
  - Создание контейнера трупа (`Corpse`, `ItemID 0x2006`) с внешним видом погибшего, перенос необлагословлённой экипировки и содержимого рюкзака, удержание `Blessed`/`Newbied` предметов в паке призрака.
  - Двухфазный распад трупа: 7 минут (420 с) в виде тела → 7 минут (420 с) в виде костей (`Bones`) с сохранением лута → удаление по истечении 840 с.
  - Режим призрака: чёрно-белый шейдер клиента, фильтрация речи в `oOoOOooOO` для живых игроков без `Spirit Speak`, невидимость призрака в режиме `Peace`, прохождение сквозь живых мобилей, запрет на взаимодействие с предметами и открытие дверей только при приближении.
  - Контракт воскрешения (алтари/анкхи `Ankh`, бинты, странствующие целители и API для заклинания `Resurrection` в P18): гамп подтверждения у призрака (`ResurrectConfirmGump`), восстановление `Hits`/`Stam` (10 % от максимума при бинтах/анкхе) и аудит через `item_ledger` (P08).

## Capabilities

### New Capabilities
- `combat/war-mode-and-targeting`: Авторитарное переключение боевого режима `War/Peace`, выбор и валидация боевой цели (`Combatant`), матрица боевой вовлечённости и агрессоров, правила автоатаки при сближении и сброса цели.
- `combat/melee-and-ranged`: Расчёт таймера замаха (`Swing Timer`) от скорости оружия и выносливости, проверка шанса попадания по боевым навыкам, рукопашный бой (`Wrestling`), стрельба из луков и арбалетов с задержкой после остановки и расходом боеприпасов, специальные удары двуручного оружия UO:R.
- `combat/damage-and-armor`: Полный конвейер расчёта физического урона с модификаторами `Tactics`, `Anatomy`, `STR` и `Lumberjacking`, механика парирования (`Parrying`), зональный выбор брони и поглощение по `Armor Rating (AR)`, потеря выносливости и износ прочности экипировки.
- `combat/healing-and-poison`: Перевязка бинтами (`Bandages`) себя, союзников и питомцев (`Healing`/`Veterinary`), сбивание и штрафы пальцев (`Slip`) от входящего урона, снятие яда и воскрешение бинтами, а также система 5 уровней яда, отравленного оружия и периодических тиков.
- `combat/death-and-resurrection`: Обработка смерти при `Hits <= 0`, состояние и ограничения призрака (`Ghost`), создание и двухфазный распад контейнера трупа (`Corpse` → `Bones`), удержание `Blessed`/`Newbied` предметов и процесс воскрешения через алтари, бинты и диалог подтверждения.

### Modified Capabilities

## Impact

- **Затрагиваемые пакеты и приложения:**
  - `packages/domain`: перечисления `CombatState`, `WeaponSkillType`, `HitLocationZone`, `SpecialMoveType`, `PoisonLevel`, `DeathReason`, `ResurrectionSource`, `CombatErrorCode`, структуры `WeaponStatsDef`, `ArmorZoneDef`, `AggressorRecord`, `CorpseMetadata`.
  - `packages/rules`: чистые детерминированные модули `src/combat/swing-timer.ts`, `src/combat/hit-chance.ts`, `src/combat/damage-pipeline.ts`, `src/combat/armor-zones.ts`, `src/combat/parrying.ts`, `src/combat/special-moves.ts`, `src/combat/durability.ts`, `src/combat/bandages.ts`, `src/combat/poison.ts`, `src/combat/death-loot.ts`.
  - `packages/content`: расширение YAML-каталогов оружия (`speed`, `damageDice`, `skill`, `range`, `ammoType`, `twoHanded`, `specialMove`), брони (`ar`, `hitZone`, `dexPenalty`, `maxHp`) и расходников (`bandage`, `clean_bandage`, `bloody_bandage`, `arrow`, `bolt`, `poison_potion`) с JSON Schema валидацией.
  - `packages/protocol`: опкоды `0x01A0..0x01CF` (`ToggleWarModeIntent`, `AttackRequestIntent`, `UseBandageIntent`, `ResurrectResponseIntent`, `CombatSwingEvent`, `CombatDamageEvent`, `SpecialMoveEvent`, `PoisonStateEvent`, `BandageProgressEvent`, `MobileDeathEvent`, `ResurrectOfferEvent`), поля `@colyseus/schema` (`warMode`, `combatantSerial`, `poisonLevel`, `isDead`, `armorRating`, `weaponDamageMin/Max`).
  - `packages/db`: миграция таблицы `world_corpses` и расширение `world_mobiles` (`is_dead`, `poison_level`, `poison_ticks_left`, `kills_short_term`, `kills_long_term` задел под P17) + записи в `item_ledger` при переносе вещей в труп.
  - `apps/game-server`: `CombatOrchestratorService`, `SwingScheduler`, `BandageSessionManager`, `PoisonTickProcessor`, `DeathAndCorpseService`, интеграция в тик 20 Гц `WorldPartitionRoom` (P06) и хуки прокачки навыков P15 (`SkillGainOrchestrator`).
  - `apps/client` и `packages/ui-kit`: переключение `War/Peace` (`Tab`), рамка цели и хитбар (`TargetHealthBarGump`), всплывающие числа урона и статусы (`[Parried]`, `[Poisoned]`, `Slip!`), пост-эффект десатурации экрана призрака, гамп `ResurrectConfirmGump` и отображение контейнера трупа.
  - `apps/bot-client` и `packages/test-kit`: боевые сценарии PvP/PvE для нагрузочных ботов и фикстуры детерминированных дуэлей в `SimulationTestHarness`.
- **Зависимости от предыдущих фаз:** P01 (ГСЧ `xoshiro128++`, часы), P03 (3D DDA LOS), P06 (тик 20 Гц, иерархическое колесо таймеров), P07 (AOI `StateView`, `IntentHandlerRegistry`), P08 (`item_ledger`, dirty-flush), P11 (анимации удара/смерти, `damageNumber`, `overheadSpeech`), P12 (движение и `Stam`), P13 (инвентарь, труп-контейнер, веса), P14 (слоты экипировки, `Paperdoll`), P15 (49 навыков, `SkillCheckResult`, статы `STR`/`DEX`/`INT`, регенерация).
- **Разблокируемые фазы:** P17 (Репутация, карма, флаги преступника/убийцы на базе `AggressorRecord` и лута трупов, городская стража), P18 (Магия — интеграция прерывания каста уроном, магического лечения/отравления и заклинания `Resurrection`), P19 (ИИ NPC и спавнеры — боевое поведение монстров и генерация лута в трупах), P20 (Крафт и ремонт изношенного оружия/брони), P22 (Приручение и бой питомцев + `Veterinary`), P26 (Гильдийные войны и фракции).

### Вне скоупа
- Расчёт репутации (`Notoriety`), криминального таймера при атаке синего игрока, счётчиков убийств и вмешательства городской стражи (`Guards`) — реализуется в **P17** (в P16 предоставляются хуки `ICombatLegalityPolicy` и журнал `AggressorRecord`).
- Боевые и лечащие заклинания (`Heal`, `Greater Heal`, `Cure`, `Poison`, `Explosion`, `Energy Bolt`, `Resurrection`), магический рефлект и расход реагентов — реализуются в **P18**.
- Автономный ИИ монстров, агро-таблицы NPC, спавнеры и таблицы генерации PVM-лута — реализуются в **P19**.
- Крафт оружия/доспехов, переплавка, ремонт на наковальне (`Blacksmithy`) и варка зелий яда/лечения (`Alchemy`) — реализуются в **P20**.
- Команды управления боевыми питомцами (`All Kill`, `All Guard`) и их мораль — реализуются в **P22** (в P16 закладывается поддержка навыка `Veterinary` при перевязке существ с флагом `isAnimalOrMonster`).
