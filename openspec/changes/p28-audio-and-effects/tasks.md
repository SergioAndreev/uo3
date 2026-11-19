# Tasks: P28 Звук и эффекты

## 1. Доменные модели, константы и коды ошибок (packages/domain)

- [ ] 1.1 Определить типы и границы `SoundId` (`0..4095`), `SoundCategory`, `SoundPriority` и `SurfaceMaterial` (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/domain test`
- [ ] 1.2 Добавить формулы расчёта пространственного затухания, изометрической панорамы и рейтинга вытеснения голосов в доменный модуль без зависимостей от браузера (req: audio/sound-effects / Пространственное затухание и изометрическое панорамирование) — проверка: `pnpm --filter @uo3/domain test`
- [ ] 1.3 Определить типы музыкальных контекстов, шкалу приоритетов (`100..10`), режимы директив (`region|override|stinger|stop`) и формулу equal-power crossfade (req: audio/music / Приоритетная матрица музыкальных контекстов) — проверка: `pnpm --filter @uo3/domain test`
- [ ] 1.4 Определить типы графических эффектов `GraphicalEffectKind` (`0..4`), `EffectRenderMode`, `EffectQuality` и бюджеты `64/128/256` и `200/800/2000` (req: effects/graphical-effects / Поддержка канонических типов графических эффектов UO) — проверка: `pnpm --filter @uo3/domain test`
- [ ] 1.5 Добавить константы кодов ошибок `ERR_AUDIO_*`, `ERR_EFFECT_*` и `ERR_MUSIC_DIRECTIVE_UNAUTHORIZED` в `@uo3/domain` (req: effects/graphical-effects / Валидация параметров и защита протокола от переполнения) — проверка: `pnpm --filter @uo3/domain typecheck`
- [ ] 1.6 Написать unit-тесты на граничные значения формул затухания, панорамы, задержки грома и рейтингов вытеснения (req: audio/sound-effects / Эмбиент окружения и акустическая задержка грома) — проверка: `pnpm --filter @uo3/domain test`
- [ ] 1.7 Написать unit-тесты на валидаторы спецификаций эффектов (`durationMs`, `speed`, `scale`, `hue`, `particleCount`) (req: effects/graphical-effects / Валидация параметров и защита протокола от переполнения) — проверка: `pnpm --filter @uo3/domain test`
- [ ] 1.8 Обновить JSDoc-документацию экспортируемых доменных типов P28 в `packages/domain` (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/domain lint`

## 2. Контент-реестры, YAML-схемы и таблицы маппинга UO:R (packages/content)

- [ ] 2.1 Создать JSON Schema и каталог `sounds.yaml` с категориями, звуками шагов по 7 материалам, заклинаниями, крафтом и UI-событиями (req: audio/sound-effects / Звуки игровых взаимодействий, крафта и интерфейса) — проверка: `pnpm --filter @uo3/content validate`
- [ ] 2.2 Добавить в `sounds.yaml` профили детерминированного CC0-синтеза для всех категорий звуков (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/content validate`
- [ ] 2.3 Создать JSON Schema и каталог `music.yaml` с треками (`trackId`, `uoFilename`, `loop`, `tags`, `cc0FallbackProfile`) (req: audio/music / Каталог музыкальных треков и привязка к регионам) — проверка: `pnpm --filter @uo3/content validate`
- [ ] 2.4 Создать `region-music.yaml` с привязкой регионов P25 (`dayTracks`, `nightTracks`, `interiorTracks`, `defaultWilderness`) и ситуационных пулов (`combat`, `death`, `sailing`, `login`) (req: audio/music / Варианты музыки для времени суток и интерьеров) — проверка: `pnpm --filter @uo3/content validate`
- [ ] 2.5 Создать JSON Schema и реестр `effects.yaml` и `particles.yaml` для канонических эффектов UO (`artId`, кадры, `renderMode`, свет, пресет частиц, CC0-силуэт) (req: effects/graphical-effects / Анимация спрайтов, палитры Hue и режимы смешивания) — проверка: `pnpm --filter @uo3/content validate`
- [ ] 2.6 Добавить проверку ссылочной целостности между `region-music.yaml` -> `music.yaml` и заклинаниями/регионами P18/P25 (req: audio/music / Каталог музыкальных треков и привязка к регионам) — проверка: `pnpm --filter @uo3/content test`
- [ ] 2.7 Прогнать CI-проверку отсутствия проприетарных бинарных ассетов UO в `packages/content` (req: effects/graphical-effects / CC0-заглушки эффектов, headless-совместимость и телеметрия) — проверка: `pnpm --filter @uo3/content check:no-proprietary`
- [ ] 2.8 Задокументировать схему добавления новых звуков, треков и эффектов в README `packages/content` (req: audio/music / Каталог музыкальных треков и привязка к регионам) — проверка: `pnpm --filter @uo3/content lint`

## 3. Парсеры метаданных аудио и анимации эффектов (packages/uo-formats)

- [ ] 3.1 Реализовать парсер `Sound.def` для разрешения псевдонимов и ремаппинга `soundId` в `@uo3/uo-formats` (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/uo-formats test`
- [ ] 3.2 Реализовать парсер `Music/Digital/Config.txt` с извлечением пути трека и флага `,loop` без зависимости от регистра (req: audio/music / Поддержка цифровых треков UO, MIDI и CC0-синтеза) — проверка: `pnpm --filter @uo3/uo-formats test`
- [ ] 3.3 Уточнить/расширить ридер `animdata.mul` (массив 64 кадров, `frameCount`, `frameInterval`, `startOffset`) для покадровых эффектов (req: effects/graphical-effects / Анимация спрайтов, палитры Hue и режимы смешивания) — проверка: `pnpm --filter @uo3/uo-formats test`
- [ ] 3.4 Обеспечить валидацию заголовков 22050 Гц 16-bit mono PCM и защиту от обрыва повреждённых записей в `SoundReader` (req: audio/sound-effects / LRU-кэш декодированных аудиобуферов и лимит памяти) — проверка: `pnpm --filter @uo3/uo-formats test`
- [ ] 3.5 Написать unit-тесты на синтетических фикстурах для `Sound.def`, `Digital/Config.txt` и повреждённых PCM-буферов (req: audio/music / Поддержка цифровых треков UO, MIDI и CC0-синтеза) — проверка: `pnpm --filter @uo3/uo-formats test`
- [ ] 3.6 Проверить изоморфную сборку `@uo3/uo-formats` для Node 22 и Web Worker без Node-специфичных модулей (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/uo-formats build`
- [ ] 3.7 Обновить документацию API парсеров `Sound.def` и `Digital/Config.txt` (req: audio/music / Поддержка цифровых треков UO, MIDI и CC0-синтеза) — проверка: `pnpm --filter @uo3/uo-formats lint`

## 4. Сетевой протокол `0x0340..0x0347` и настройки клиента (packages/protocol, apps/api)

- [ ] 4.1 Зарегистрировать uint16-опкоды `0x0340..0x0347` и TypeBox-схемы сообщений (`S2C_PLAY_SOUND`, `S2C_PLAY_MUSIC`, `S2C_GRAPHICAL_EFFECT`, `S2C_EFFECT_BATCH`, `S2C_WEATHER_THUNDER`, `S2C_SCREEN_FLASH`, `S2C_STOP_ATTACHED_EFFECT`, `S2C_AMBIENT_EMITTER_SYNC`) (req: audio/sound-effects / Серверная рассылка позиционных звуков по AOI и стелсу) — проверка: `pnpm --filter @uo3/protocol test`
- [ ] 4.2 Включить строгие ограничения полей в TypeBox-схемах (`soundId` 0..4095, `durationMs` 50..15000, `speed` 1..255, `scale` 0.25..4.0, `hue` 0..3000, `particleCount` 0..64) (req: effects/graphical-effects / Валидация параметров и защита протокола от переполнения) — проверка: `pnpm --filter @uo3/protocol test`
- [ ] 4.3 Расширить `ClientSettingsV1Schema` полями `AudioAndEffectsSettingsSchema` с обратно-совместимыми дефолтами (req: audio/music / Пользовательские настройки музыки и сохранение профиля) — проверка: `pnpm --filter @uo3/protocol test`
- [ ] 4.4 Обновить бинарный/compact кодек батчинга эффектов и звуков для минимизации накладных расходов на тик (req: effects/graphical-effects / Серверные капы рассылки, AOI и защита стелса) — проверка: `pnpm --filter @uo3/protocol test`
- [ ] 4.5 Обновить endpoint настроек профиля в `apps/api` для валидации новых полей `ClientSettingsV1` с возвратом `ERR_AUDIO_SETTINGS_OUT_OF_RANGE` (req: audio/sound-effects / Настройки громкости, приглушение и разблокировка аудио) — проверка: `pnpm --filter @uo3/api test`
- [ ] 4.6 Добавить контрактные тесты гидратации старых JSONB-профилей `account_client_profiles` из PG17 значениями по умолчанию P28 (req: audio/music / Пользовательские настройки музыки и сохранение профиля) — проверка: `pnpm --filter @uo3/api test:integration`
- [ ] 4.7 Обновить спецификацию OpenAPI `/api/v1/*` и сгенерировать клиентские типы (req: audio/music / Пользовательские настройки музыки и сохранение профиля) — проверка: `pnpm --filter @uo3/api openapi:check`
- [ ] 4.8 Добавить unit-тесты на сериализацию/отклонение невалидных значений `0x0340..0x0347` и `ERR_EFFECT_UNKNOWN_KIND` (req: effects/graphical-effects / Поддержка канонических типов графических эффектов UO) — проверка: `pnpm --filter @uo3/protocol test`

## 5. Серверный диспетчер звука и квотирование AOI/Stealth (apps/game-server)

- [ ] 5.1 Реализовать `AudioEffectsDispatcher` в `WorldPartitionRoom` с фильтрацией получателей по фасету и дистанции `<= 22` тайлов (req: audio/sound-effects / Серверная рассылка позиционных звуков по AOI и стелсу) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 5.2 Интегрировать проверку видимости через `VisibilityEntitySource` (P07/P22), скрывающую звуки невидимых/скрытых сущностей от наблюдателей без доступа (req: audio/sound-effects / Серверная рассылка позиционных звуков по AOI и стелсу) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 5.3 Реализовать per-connection очередь тика с лимитом `64` звуковых событий за `50` мс тик и приоритетным сбросом далёкого эмбиента (req: audio/sound-effects / Коалесцирование всплесков и серверное квотирование) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 5.4 Добавить конфигурационные env-флаги квот и выключателей рассылки в `@uo3/config` и `AudioEffectsModule` (req: audio/sound-effects / Диагностика и телеметрия звуковой подсистемы) — проверка: `pnpm --filter @uo3/config test`
- [ ] 5.5 Подключить серверные звуки взаимодействий: двери, открытие/взлом сундуков, ловушки, ресурсы P20 (рубка, руда, рыбалка, кузня) и голосовые звуки NPC P19 (req: audio/sound-effects / Звуки игровых взаимодействий, крафта и интерфейса) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 5.6 Подключить серверные звуки боя P16 (взмах, удар, парирование, промах, лечение/яд) и срыва/успеха магии P18 (`fizzle`) (req: audio/sound-effects / Звуки игровых взаимодействий, крафта и интерфейса) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 5.7 Написать интеграционные тесты симуляции 20 Гц на проверку AOI-радиуса, стелса и сброса сверх `64` звуков за тик (req: audio/sound-effects / Коалесцирование всплесков и серверное квотирование) — проверка: `pnpm --filter @uo3/game-server test:integration`
- [ ] 5.8 Задокументировать API публикации серверных звуков и правила приоритетов в `apps/game-server` (req: audio/sound-effects / Серверная рассылка позиционных звуков по AOI и стелсу) — проверка: `pnpm --filter @uo3/game-server lint`

## 6. Серверный диспетчер графических эффектов и хуки P16/P18/P19/P20/P25 (apps/game-server)

- [ ] 6.1 Реализовать рассылку `0x0342`/`0x0343` в `AudioEffectsDispatcher` с ограничением радиуса `<= 24` тайла по тому же фасету и изоляцией стелса (req: effects/graphical-effects / Серверные капы рассылки, AOI и защита стелса) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 6.2 Реализовать per-connection квоту `48` графических эффектов за тик с приоритетным сохранением собственных и боевых эффектов (req: effects/graphical-effects / Серверные капы рассылки, AOI и защита стелса) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 6.3 Интегрировать все 64 заклинания P18 со спецификациями `FIXED_XYZ`, `FOLLOW_ENTITY`, `MOVING`, `LIGHTNING` и `fizzle`-событиями (req: effects/graphical-effects / Поддержка канонических типов графических эффектов UO) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 6.4 Добавить отправку `0x0346 S2C_STOP_ATTACHED_EFFECT` при снятии баффа, прерывании или развеивании поля Dispel (req: effects/graphical-effects / Постоянные визуальные циклы полей и мунгейтов) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 6.5 Интегрировать постоянные эмбиент-излучатели (`0x0347`) для горнов, порталов/мунгейтов P25 и стационарных очагов (req: audio/sound-effects / Эмбиент окружения и акустическая задержка грома) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 6.6 Реализовать серверную проверку параметров эффектов перед отправкой с отклонением невалидных спецификаций (`ERR_EFFECT_INVALID_SPEC`) (req: effects/graphical-effects / Валидация параметров и защита протокола от переполнения) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 6.7 Написать интеграционные тесты осады с >70 эффектами в тик и проверкой видимости в стелсе (req: effects/graphical-effects / Серверные капы рассылки, AOI и защита стелса) — проверка: `pnpm --filter @uo3/game-server test:integration`
- [ ] 6.8 Обновить документацию интеграции модулей P16/P18/P25 с `AudioEffectsDispatcher` (req: effects/graphical-effects / Поддержка канонических типов графических эффектов UO) — проверка: `pnpm --filter @uo3/game-server lint`

## 7. Серверные музыкальные директивы и погодно-грозовой синхронизатор (apps/game-server)

- [ ] 7.1 Реализовать `MusicDirectiveService` с отправкой `0x0341 S2C_PLAY_MUSIC` при логине и телепорте (`resetDebounce = true`), не дублируя `MusicTriggerPacket (0x02E1)` из P25, который остаётся единственным сигналом смены региональной музыки при обычном переходе границы региона (req: audio/music / Серверные директивы управления музыкой) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 7.2 Добавить контроль прав доступа (ACL) для `override`-директив с отклонением неавторизованных вызовов (`ERR_MUSIC_DIRECTIVE_UNAUTHORIZED`) (req: audio/music / Серверные директивы управления музыкой) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 7.3 Интегрировать генератор штормовых молний P25 с рассылкой `0x0344 S2C_WEATHER_THUNDER` в радиусе видимости (req: audio/sound-effects / Эмбиент окружения и акустическая задержка грома) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 7.4 Подключить серверные `stinger`-директивы для ключевых событий (воскрешение, вход на арену/событие) (req: audio/music / Фоновая пауза и приглушение при музыкальных акцентах) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 7.5 Обеспечить перенос контекста музыки и отмену временного `override` при межпартиционном переходе (P12/P32) (req: audio/music / Серверные директивы управления музыкой) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 7.6 Написать тесты на телепорт, ACL музыкальных директив и генерацию `S2C_WEATHER_THUNDER` (req: audio/music / Серверные директивы управления музыкой) — проверка: `pnpm --filter @uo3/game-server test:integration`
- [ ] 7.7 Задокументировать контракты `MusicDirectiveService` и `S2C_WEATHER_THUNDER` (req: audio/music / Серверные директивы управления музыкой) — проверка: `pnpm --filter @uo3/game-server lint`

## 8. Клиентский конвейер загрузки, декодирования и LRU-кэш SFX + CC0-синтез (apps/client)

- [ ] 8.1 Реализовать `SoundAssetLoader` с чтением `sound.mul`/`uop` из OPFS, разрешением псевдонимов `Sound.def` и валидацией `0..4095` (`ERR_AUDIO_INVALID_SOUND_ID`) (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.2 Реализовать `AudioBufferLruCache` с настраиваемым бюджетом `32..128` МиБ (по умолчанию `64` МиБ) и защитой активно играющих буферов от вытеснения (req: audio/sound-effects / LRU-кэш декодированных аудиобуферов и лимит памяти) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.3 Добавить сессионный чёрный список повреждённых сэмплов для автоматического однократного переключения на CC0-заглушку (req: audio/sound-effects / LRU-кэш декодированных аудиобуферов и лимит памяти) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.4 Реализовать детерминированный `ProceduralCC0Synth` для всех категорий звуков (шаги 7 поверхностей, удары, луки, заклинания, интерфейс, гром) при отсутствии импортированных архивов (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.5 Реализовать ленивую инициализацию и безопасную разблокировку `AudioContext` по первому жесту пользователя (`pointerdown`/`keydown`) без необработанных промисов (req: audio/sound-effects / Настройки громкости, приглушение и разблокировка аудио) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.6 Написать unit-тесты на вытеснение из LRU 64 МиБ при активных голосах и на работу CC0-синтеза без OPFS (req: audio/sound-effects / LRU-кэш декодированных аудиобуферов и лимит памяти) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.7 Написать unit-тесты на устойчивость к битым PCM-буферам без повторных циклов декодирования (req: audio/sound-effects / LRU-кэш декодированных аудиобуферов и лимит памяти) — проверка: `pnpm --filter @uo3/client test`
- [ ] 8.8 Обновить документацию клиентского аудио-хранилища и CC0-профилей в `apps/client` (req: audio/sound-effects / Загрузка звуковых ресурсов и CC0-фолбэк) — проверка: `pnpm --filter @uo3/client lint`

## 9. Пространственный аудиодвижок, пул голосов, коалесцирование и P11-шаги (apps/client)

- [ ] 9.1 Реализовать `SpatialAudioEngine` с иерархией `GainNode` по категориям (`sfx`, `ambient`, `ui`, `footsteps`), рамой `30` мс при mute и `150` мс при `muteOnBlur` (req: audio/sound-effects / Настройки громкости, приглушение и разблокировка аудио) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.2 Подключить 3D-затухание (`refDistance=2`, `maxDistance=22`) и изометрическое стереопанорамирование `(dx - dy) / 14` от `CameraTargetProvider` P10 (req: audio/sound-effects / Пространственное затухание и изометрическое панорамирование) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.3 Реализовать ежекадровое обновление позиции привязанных `sourceEntityId`-голосов и `100` мс fade-out при выходе сущности из AOI (req: audio/sound-effects / Сопровождение движущихся источников звука) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.4 Реализовать пул голосов (`8..64`, по умолчанию `32`), лимит `<= 4` голосов на `soundId` и вытеснение слабейших по рейтингу за `40` мс (req: audio/sound-effects / Лимит одновременных звуков и приоритетное вытеснение) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.5 Реализовать дедупликатор коалесцирования одинаковых `soundId` в окне `40` мс и дистанции `< 2` тайлов (req: audio/sound-effects / Коалесцирование всплесков и серверное квотирование) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.6 Подписать клиент на события P11 (`stepFootfall`, `attackImpact`, `castRelease`, `deathFinished`), определяя поверхность тайла (`grass|stone|sand|snow|water|wood|metal`) и питч-джиттер `±5%` (req: audio/sound-effects / Синхронизация звуков шагов и анимационных событий P11) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.7 Реализовать подсистему фонового эмбиента окружения (дождь с 60% ослаблением под крышей, очаги `0x0347`, `500` мс переходы) и таймер акустической задержки грома `clamp(d * 35, 0, 1500)` мс (req: audio/sound-effects / Эмбиент окружения и акустическая задержка грома) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.8 Подключить немедленные непозиционные UI-звуки (клики, гампы, drag-and-drop в рюкзаке, прицел) без ожидания сервера (req: audio/sound-effects / Звуки игровых взаимодействий, крафта и интерфейса) — проверка: `pnpm --filter @uo3/client test`
- [ ] 9.9 Написать unit-тесты на панораму, вытеснение голосов, 40 мс коалесцирование, затухание под крышей и P11-шаги (req: audio/sound-effects / Синхронизация звуков шагов и анимационных событий P11) — проверка: `pnpm --filter @uo3/client test`

## 10. Клиентский музыкальный контроллер: матрица контекстов, гистерезис и кроссфейды (apps/client)

- [ ] 10.1 Реализовать 4 Гц вычислитель контекстов приоритетов (`Login 100 > Death 90 > Combat 80 > Sailing 70 > Region 0..255 > Wilderness 10`) (req: audio/music / Приоритетная матрица музыкальных контекстов) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.2 Реализовать гистерезис смены регионов (`2000` мс debounce), удержание боевой музыки (`8000` мс) и учёт флага `combatMusicEnabled` (req: audio/music / Гистерезис и защита от дребезга на границах) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.3 Подключить выбор `dayTracks`, `nightTracks` (ночь `20:00..06:00` по `GameTime`) и `interiorTracks` с мягким `3000` мс переходом (req: audio/music / Варианты музыки для времени суток и интерьеров) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.4 Реализовать equal-power crossfade (`cos`/`sin`) на `500..5000` мс (по умолчанию `2000` мс), отсутствие рестарта при совпадении `trackId` и безопасную отмену незавершённого перехода (req: audio/music / Плавное перекрёстное затухание треков) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.5 Реализовать обработку серверных директив `0x0341` (`region`, `override` с TTL `<= 300` с, `stinger` с `-6` дБ ducking, `stop`, сброс debounce при телепорте) (req: audio/music / Серверные директивы управления музыкой) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.6 Реализовать логику плейлистов (бесшовный `loop`, пауза `3000` мс для однократных треков и исключение немедленного повтора при пуле `>= 2`) (req: audio/music / Логика плейлистов, пауз и запрет немедленного повтора) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.7 Написать комплексные тесты автомата состояний музыки на фейковых часах `@uo3/test-kit` (дребезг границ, бой 8с, день/ночь, кроссфейды) (req: audio/music / Гистерезис и защита от дребезга на границах) — проверка: `pnpm --filter @uo3/client test`
- [ ] 10.8 Задокументировать диаграмму состояний и правила приоритетов `MusicController` в `apps/client` (req: audio/music / Приоритетная матрица музыкальных контекстов) — проверка: `pnpm --filter @uo3/client lint`

## 11. Потоковые декодеры музыки (Digital/MIDI/CC0), плейлисты и фоновая пауза (apps/client)

- [ ] 11.1 Реализовать потоковый плеер цифровых треков из OPFS (`HTMLAudioElement` -> `MediaElementAudioSourceNode`) с лимитом не более 2 потоков и `<= 16` МиБ памяти (req: audio/music / Потоковое воспроизведение и жёсткий бюджет памяти) — проверка: `pnpm --filter @uo3/client test`
- [ ] 11.2 Реализовать лёгкий клиентский MIDI-проигрыватель и детерминированный CC0-генератор фоновой музыки по тегам региона (req: audio/music / Поддержка цифровых треков UO, MIDI и CC0-синтеза) — проверка: `pnpm --filter @uo3/client test`
- [ ] 11.3 Реализовать переключение на состояние `pending_unlock` при блокировке автозапуска браузером и старт по первому взаимодействию (req: audio/music / Устойчивость к блокировке автозапуска и битым трекам) — проверка: `pnpm --filter @uo3/client test`
- [ ] 11.4 Добавить изоляцию повреждённых музыкальных файлов в сессионный чёрный список без зацикленных перезапусков (req: audio/music / Устойчивость к блокировке автозапуска и битым трекам) — проверка: `pnpm --filter @uo3/client test`
- [ ] 11.5 Реализовать реакцию на `VisibilityChange` (`playMusicInBackground=false` -> `250` мс затухание и пауза с точным сохранением позиции) и моментальную остановку декодера при `musicEnabled=false` (req: audio/music / Фоновая пауза и приглушение при музыкальных акцентах) — проверка: `pnpm --filter @uo3/client test`
- [ ] 11.6 Написать тесты на потребление памяти (`<= 16` МиБ при 10 сменах регионов), `pending_unlock` и отказ всех файлов пула (req: audio/music / Потоковое воспроизведение и жёсткий бюджет памяти) — проверка: `pnpm --filter @uo3/client test`
- [ ] 11.7 Задокументировать форматы поддерживаемой музыки и фолбэков для пользователей клиента (req: audio/music / Поддержка цифровых треков UO, MIDI и CC0-синтеза) — проверка: `pnpm --filter @uo3/client lint`

## 12. Клиентский рендерер графических эффектов UO, Hue LUT и DynamicLightRegistry (apps/client)

- [ ] 12.1 Реализовать `GraphicalEffectsEngine` с поддержкой типов `FIXED_XYZ`, `FOLLOW_ENTITY`, `MOVING`, `LIGHTNING` и `SCREEN_FLASH` (req: effects/graphical-effects / Поддержка канонических типов графических эффектов UO) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.2 Реализовать покадровое отслеживание цели для `MOVING`-снарядов, поворот вдоль вектора `(dx, dy)` при `fixedDirection=false` и локальный взрыв `explodeOnImpact` (req: effects/graphical-effects / Интерполяция движущихся снарядов и синхронизация удара) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.3 Реализовать процедурный многосегментный рендерер молний (`z + 40` -> `z`, длительность `350` мс) с подавлением экранного оверлея при `reduceFlashes=true` (req: effects/graphical-effects / Рендеринг молний и защита от фоточувствительности) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.4 Подключить шейдер спрайтовых эффектов с покадровой анимацией, текстурой LUT `32×3001` (`hue`, `partialHue`), режимами смешивания (`0,2,3,4,5`) и Z-сортировкой сцены P10 (req: effects/graphical-effects / Анимация спрайтов, палитры Hue и режимы смешивания) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.5 Интегрировать эффекты с `DynamicLightRegistry` (P10): перемещение огня за снарядами, `300` мс угасание и жёсткий лимит `maxEffectLights = 24` с вытеснением дальних (req: effects/graphical-effects / Связь с подсистемой динамического освещения) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.6 Реализовать синхронизацию визуальных циклов полей P18 и мунгейтов P25 с паузой частиц вне фрустума `+4` тайла и очисткой по `0x0346` (req: effects/graphical-effects / Постоянные визуальные циклы полей и мунгейтов) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.7 Реализовать процедурные CC0-спрайты и геометрические шейдеры для канонических эффектов при отсутствии `art.mul` (req: effects/graphical-effects / CC0-заглушки эффектов, headless-совместимость и телеметрия) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.8 Написать unit-тесты на траекторию снарядов, вытеснение 25-го источника света и `reduceFlashes` (req: effects/graphical-effects / Связь с подсистемой динамического освещения) — проверка: `pnpm --filter @uo3/client test`
- [ ] 12.9 Обновить документацию шейдеров, `renderMode` и контрактов `DynamicLightRegistry` в `apps/client` (req: effects/graphical-effects / Анимация спрайтов, палитры Hue и режимы смешивания) — проверка: `pnpm --filter @uo3/client lint`

## 13. Пулируемая система частиц, бюджеты качества, доступность и UI-настройки (apps/client, packages/ui-kit)

- [ ] 13.1 Реализовать `ParticlePool` на SoA `Float32Array` буферах и `InstancedMesh` с нулевыми аллокациями в стационарном цикле кадра (req: effects/graphical-effects / Пулируемая система частиц и нулевые аллокации в кадре) — проверка: `pnpm --filter @uo3/client test`
- [ ] 13.2 Добавить эмиттеры для дыма срыва магии, брызг крови, искр парирования, лечения, яда, угольков, порталов и осадков (req: effects/graphical-effects / Пулируемая система частиц и нулевые аллокации в кадре) — проверка: `pnpm --filter @uo3/client test`
- [ ] 13.3 Подписать систему частиц на боевые события урона/парирования P11 с учётом флагов `showBloodEffects` и `showSpellParticles` (req: effects/graphical-effects / Синхронизация боевых всплесков с событиями урона P11) — проверка: `pnpm --filter @uo3/client test`
- [ ] 13.4 Реализовать бюджеты `effectQuality` (`low: 64/200`, `medium: 128/800`, `high: 256/2000`) с приоритетным вытеснением дальних декоративных эффектов (req: effects/graphical-effects / Клиентские бюджеты качества эффектов) — проверка: `pnpm --filter @uo3/client test`
- [ ] 13.5 Добавить клиентскую санитизацию входящих спецификаций (`scale`, `durationMs`, `particleCount <= 64`) и отсев `ERR_EFFECT_INVALID_SPEC` (req: effects/graphical-effects / Валидация параметров и защита протокола от переполнения) — проверка: `pnpm --filter @uo3/client test`
- [ ] 13.6 Расширить панель настроек клиента в `@uo3/ui-kit` и `apps/client` (ползунки громкости по категориям, `combatMusicEnabled`, `musicCrossfadeMs`, `maxConcurrentSfx`, `effectQuality`, `reduceFlashes`, `muteOnBlur`, индикатор разблокировки звука) (req: audio/music / Пользовательские настройки музыки и сохранение профиля) — проверка: `pnpm --filter @uo3/ui-kit test`
- [ ] 13.7 Написать тесты нулевой утечки слотов пула частиц после 100 000+ циклов спауна и соблюдения порогов `low/medium/high` (req: effects/graphical-effects / Пулируемая система частиц и нулевые аллокации в кадре) — проверка: `pnpm --filter @uo3/client test`
- [ ] 13.8 Написать компонентные тесты UI панели настроек звука и доступности (req: effects/graphical-effects / Рендеринг молний и защита от фоточувствительности) — проверка: `pnpm --filter @uo3/client test`

## 14. Телеметрия, диагностический оверлей и адаптер bot-client (apps/client, apps/game-server, apps/bot-client)

- [ ] 14.1 Добавить в клиентский store телеметрию SFX и эффектов (активные/вытесненные голоса, коалесцирование, hit rate и байты LRU-кэша, активные эффекты/частицы/огни, отбросы по бюджету) (req: audio/sound-effects / Диагностика и телеметрия звуковой подсистемы) — проверка: `pnpm --filter @uo3/client test`
- [ ] 14.2 Вывести метрики аудио и эффектов в диагностический dev-оверлей клиента без влияния на время кадра (req: effects/graphical-effects / CC0-заглушки эффектов, headless-совместимость и телеметрия) — проверка: `pnpm --filter @uo3/client test`
- [ ] 14.3 Экспортировать Prometheus-счётчики отправленных и сброшенных по квоте звуков/эффектов и задержек тика из `apps/game-server` (req: audio/sound-effects / Диагностика и телеметрия звуковой подсистемы) — проверка: `pnpm --filter @uo3/game-server test`
- [ ] 14.4 Реализовать `NoopAudioEffectsSink` и подписчики протокола `0x0340..0x0347` в `apps/bot-client` для headless нагрузочного тестирования (req: effects/graphical-effects / CC0-заглушки эффектов, headless-совместимость и телеметрия) — проверка: `pnpm --filter @uo3/bot-client test`
- [ ] 14.5 Добавить нагрузочный сценарий для `bot-client`, проверяющий стабильный приём шквала эффектов/звуков при массовом касте (req: effects/graphical-effects / Серверные капы рассылки, AOI и защита стелса) — проверка: `pnpm --filter @uo3/bot-client test`
- [ ] 14.6 Написать unit-тесты на корректный учёт счётчиков телеметрии на клиенте и сервере (req: audio/sound-effects / Диагностика и телеметрия звуковой подсистемы) — проверка: `pnpm --filter @uo3/client test`
- [ ] 14.7 Обновить дашборд Grafana/метрики и документацию диагностики P28 (req: audio/sound-effects / Диагностика и телеметрия звуковой подсистемы) — проверка: `pnpm lint`

## 15. Сквозная интеграционная верификация фазы, нагрузочное тестирование и документация

- [ ] 15.1 Провести сквозной E2E-тест на синтетическом мире (фасет 200): вход в мир -> музыка региона -> шаг по разным поверхностям (P11) -> схватка с монстром (переход музыки в бой и возврат через 8 с) -> каст Fireball и Lightning (свет + парабола/прямая снаряда + задержка грома + частицы) (req: audio/music / Гистерезис и защита от дребезга на границах) — проверка: `pnpm test:e2e --grep "P28 audio and effects"`
- [ ] 15.2 Провести сквозной E2E-тест безопасности и доступности: скрытый персонаж не производит звуков/эффектов для наблюдателя, а `reduceFlashes=true` блокирует экранные вспышки при молнии и `0x0345` (req: effects/graphical-effects / Рендеринг молний и защита от фоточувствительности) — проверка: `pnpm test:e2e --grep "P28 stealth and accessibility"`
- [ ] 15.3 Провести нагрузочный тест осады (`bot-client` + `game-server`, 50 ботов в одном секторе): проверить удержание квот 64/48 на тик, время тика `<= 50` мс и память клиента в рамках бюджетов 64 MiB SFX + 16 MiB Music (req: audio/sound-effects / Коалесцирование всплесков и серверное квотирование) — проверка: `pnpm test:load:p28`
- [ ] 15.4 Запустить полный цикл проверки качества монорепо (`typecheck`, `lint`, `test`, проверка запрета проприетарных ассетов UO) (req: effects/graphical-effects / CC0-заглушки эффектов, headless-совместимость и телеметрия) — проверка: `pnpm turbo typecheck lint test && pnpm check:no-proprietary`
- [ ] 15.5 Обновить пользовательскую и архитектурную документацию (гайд по настройкам звука/доступности и таблицу опкодов P28) (req: audio/sound-effects / Настройки громкости, приглушение и разблокировка аудио) — проверка: `pnpm docs:check`
- [ ] 15.6 Выполнить финальную строгую валидацию OpenSpec-артефактов фазы P28 (req: audio/music / Каталог музыкальных треков и привязка к регионам) — проверка: `openspec validate p28-audio-and-effects --strict`

## Workflow follow-up

- Запустить `openspec validate p28-audio-and-effects --strict` и убедиться в отсутствии замечаний.
- Заархивировать изменение командой `/opsx-archive p28-audio-and-effects` после завершения всех задач и код-ревью.
