# Реестр опкодов протокола и кодов закрытия WebSocket (`@uo3/protocol`)

> Авторитетный единый справочник выделения числовых диапазонов `uint16`-опкодов (`0x0001..0x0FFF`) и кодов закрытия WebSocket (`4100..4199`) между всеми 37 фазами UO3.
> **Реестр нормативен.** Числовые значения опкодов и кодов закрытия в `specs/**/spec.md` и `design.md` любой фазы MUST совпадать с этой таблицей. При расхождении приоритет имеет реестр, а расхождение считается дефектом спецификации фазы и исправляется в том же PR. Новые опкоды/коды добавляются сначала сюда.

## 1. Диапазоны опкодов `@duskmarch/protocol` (`uint16`)

Каждый домен получает фиксированный непересекающийся блок (16, 32 или 48 опкодов). Фаза определяет новые опкоды **только** в своём блоке; ссылаясь на опкод другой фазы, она использует его номер и имя из блока фазы-владельца. Фазы P00–P05 и P08–P11 собственных WS-опкодов не вводят (REST API, персистентность и чисто клиентские подсистемы).

| Диапазон | Фаза | Подсистема |
|---|---|---|
| `0x0001..0x001F` | P07 | Системные и сетевые сообщения (Handshake, ProtocolVersion, ClockSync Ping/Pong, ErrorEnvelope, Resync) |
| `0x0020..0x003F` | P06 | Сессии и ShardHubRoom (SessionReady, SafeLogout, SystemBroadcast, Presence) |
| `0x0040..0x00FF` | Резерв | Резерв системного уровня (расширения P06/P07 только через обновление реестра) |
| `0x0100..0x011F` | P12 | Движение и навигация (WalkRequest, WalkAck, WalkDeny, TeleportSync, PartitionHandoffTicket, ClientGeometryReady, MovementResyncRequest) |
| `0x0120..0x014F` | P13 | Предметы, контейнеры, Drag-and-Drop, экипировка (PickUp, Drop, Equip, OpenContainer, SingleClick, DoubleClick, BounceBack) |
| `0x0150..0x017F` | P14 | Интерфейс гампов, таргетинг, пейпердолл, базовая речь (OpenGump, CloseGump, GumpReply, TargetRequest/Response, Paperdoll, MacroSync) |
| `0x0180..0x019F` | P15 | Статы, виталы и навыки (StatLockChange, SkillUse, SkillLockChange, SkillDelta, VitalUpdate) |
| `0x01A0..0x01CF` | P16 | Бой, урон, лечение, яды, смерть и воскрешение (WarModeToggle, AttackRequest, SwingEvent, DamageNumber, BandageUse, ResurrectOffer/Reply) |
| `0x01D0..0x01EF` | P17 | Нотореити, PvP, преступления, убийства, стража (MurderReportGump, CriminalFlag, GuardCall, LootPermission) |
| `0x01F0..0x021F` | P18 | Магия (CastSpell, CastScroll, SpellbookContentEvent, RunebookAction, FieldEffect, ReflectEvent) |
| `0x0220..0x023F` | P19 | NPC, питомцы и сервисы (PetCommand, PetRename, PetRelease, StableList, TrainerOffer, EscortAccept) |
| `0x0240..0x025F` | P20 | Сбор ресурсов, крафт и ремонт (HarvestAction, CraftRequest, CraftResult, SmeltRequest, RepairRequest) |
| `0x0260..0x028F` | P21 | Экономика, банк, Secure Trade, NPC и Player Vendors (TradeInit/Update/Accept/Cancel, VendorBuy/Sell, PlayerVendorManage) |
| `0x0290..0x02AF` | P22 | Утилитарные навыки (Hide/Stealth, DetectHidden, TrackArrow, Snoop/Steal, BardPlay/Provoke/Peace/Discord, LoreResult, CampSite) |
| `0x02B0..0x02CF` | P23 | Дома и мульти-объекты (HousePlacementPreview/Confirm, HouseSignAction, HouseAccessUpdate, Lockdown/Secure, Demolish/Transfer) |
| `0x02D0..0x02DF` | P24 | Корабли и море (BoatLaunch, BoatMoveSync, BoatTurnSync, BoatCommand, DryDock, DeepFishing/SOS) |
| `0x02E0..0x02EF` | P25 | Регионы, мунгейты, погода и декорации (RegionChange, MoongateGump/Travel, WeatherUpdate, SeasonUpdate, DoorToggle) |
| `0x02F0..0x031F` | P26 | Социальные системы (SpeechChannel, PartyInvite/Accept/LootFlag/Kick, GuildAction/War/Alliance, Friend/Ignore, ChatReport) |
| `0x0320..0x033F` | P27 | Квесты и мировые события (TreasureMapDecode/Dig, EscortStatus, GmEventBanner, SeasonalEventProgress) |
| `0x0340..0x035F` | P28 | Звук, музыка и графические эффекты (PlaySound3D, MusicTrackChange, MovingEffect, FixedEffect, BoltEffect, ParticleBurst) |
| `0x0360..0x037F` | P29 | Инструменты персонала (GmCommand, PropsInspect/Patch, HelpPageSubmit/Update, StaffTeleport, StaffHiddenToggle) |
| `0x0380..0x038F` | P30 | Контент-пайплайн и локализация (LocalizedSystemMessage, LocalizedEntitySpeech, ContentVersionHandshake, ContentUpdateNotify, ClientLocaleSwitchIntent/Ack) |
| `0x0390..0x039F` | P31 | Безопасность и античит (SecurityViolationNotice, BotChallengePrompt/Response, ClientIntegrityTelemetry, MacroPolicyNotice, SecurityQuarantineState) |
| `0x03A0..0x03BF` | P32 | Масштабирование и межпартиционный handoff (HandoffPrepareNotice, HandoffAckClient, HandoffResumeRequest, HandoffCompleteSync, HandoffRollbackNotice, GhostBorderStateHint, ClusterTopologyNotice, PartitionTelemetryEvent) |
| `0x03C0..0x03CF` | P33 | Наблюдаемость и эксплуатация (ServerShutdownNotice, ServerShutdownCancelled, ShardMaintenanceState, ClientTelemetryReport, SessionDrainDisconnect, OpsNoticeBroadcast) |
| `0x03D0..0x03DF` | P34 | Качество клиента (ClientCapabilitiesHello, VersionCompatibilityNotice, ClientPlatformTelemetry; локализованные сообщения и смена локали — опкоды P30 с обратно совместимыми расширениями) |
| `0x03E0..0x03FF` | P36 | Бета, запуск и LiveOps (BetaFeedbackSubmit/Ack, LaunchPhaseNotice, LegalReconsentRequired, ServiceDegradationBanner, SupportTicketCreate/Status, LiveOpsScheduleSync) |
| `0x0400..0x0FFF` | Резерв | Будущие расширения (эпохи LBR/AOS, WebTransport и пользовательские шарды) |


### Опкоды P06 (`RUNTIME_OPCODES`)

| Опкод | Сообщение | Направление | Назначение |
| --- | --- | --- | --- |
| `0x0020` | `session:ready` | сервер → клиент | Герой в мире: сессия, `EntityId`, план, позиция |
| `0x0021` | `session:logout_request` | клиент → сервер | Запрос выхода |
| `0x0022` | `session:logout_pending` | сервер → клиент | Мгновенный выход запрещён политикой, идёт задержка выхода |
| `0x0023` | `session:heartbeat` | клиент → сервер | Активность игрока (сброс отсчёта бездействия) |
| `0x0024` | `session:reconnect_token` | сервер → клиент | Токен переподключения для окна 30 с |
| `0x0028` | `hub:motd` | сервер → клиент | Сообщение дня шарда |
| `0x0029` | `hub:announcement` | сервер → клиент | Системное объявление |
| `0x002A` | `hub:presence_summary` | сервер → клиент | Счётчик онлайна (не чаще раза в секунду) |
| `0x002B` | `hub:announce_request` | клиент → сервер | Ручное объявление персонала (`game-master` и выше) |

## 2. Коды закрытия WebSocket (`4100..4199`)

Диапазон `4000..4099` **не используется**: Colyseus 0.16 резервирует в нём и рядом собственные коды (`4000` `WS_CLOSE_CONSENTED`, `4002` `WS_CLOSE_WITH_ERROR`, `4010` `WS_CLOSE_DEVMODE_RESTART` — клиентский SDK на нём автоматически переподключается, `4201` `WS_SERVER_DISCONNECT`, `4202` `WS_TOO_MANY_CLIENTS`). Прикладные коды UO3 выделены в `4100..4199`; диапазон `42xx` также запрещён.

Колонка «Реконнект» — нормативное поведение клиента: `да` — автоматическое переподключение с экспоненциальной задержкой (новый game ticket запрашивается автоматически), `нет` — переход на экран входа/выбора персонажа с понятным сообщением, `перенаправление` — переподключение по выданному сервером адресу/тикету без показа экрана ошибки.

| Код | Константа | Фаза | Реконнект | Назначение |
|---|---|---|---|---|
| `4100` | `WS_CLOSE_PROTOCOL_ERROR` | P06/P07 | нет | Некорректный формат кадра, неизвестный опкод, нарушение схемы или превышение порога битых кадров |
| `4101` | `WS_CLOSE_INVALID_TICKET` | P05/P06 | да | Просроченный, отозванный или уже использованный game ticket |
| `4102` | `WS_CLOSE_UNAUTHORIZED` | P04/P06 | нет | Невалидная сессия, отозванный JWT или недостаточный `AccessLevel` |
| `4103` | `WS_CLOSE_BANNED` | P04/P29/P31 | нет | Аккаунт заблокирован (мгновенный кик) |
| `4104` | `WS_CLOSE_DUPLICATE_SESSION` | P06 | нет | Старое подключение вытеснено входом того же персонажа из новой сессии |
| `4105` | `WS_CLOSE_CHARACTER_NOT_FOUND` | P05/P06 | нет | Персонаж не найден или удалён |
| `4106` | `WS_CLOSE_PARTITION_FULL` | P05/P06 | да | Достигнут лимит игроков комнаты/шарда (`hardCapacity`) |
| `4107` | `WS_CLOSE_WORLD_DATA_MISMATCH` | P03/P07 | нет | Несовместимая версия статических данных мира |
| `4108` | `WS_CLOSE_RATE_LIMIT_EXCEEDED` | P07/P31 | да | Превышен лимит сообщений / флуд-контроль |
| `4109` | `WS_CLOSE_IDLE_TIMEOUT` | P06 | нет | Истёк таймаут неактивности игрока (AFK); клиент показывает экран «Отключено за бездействие» с кнопкой ручного входа |
| `4110` | `WS_CLOSE_SECURITY_QUARANTINE` | P07/P31 | нет | Разрыв из-за критичного нарушения античита / инвариантов |
| `4111` | `WS_CLOSE_PROTOCOL_VERSION_MISMATCH` | P07 | нет | Несовместимая semver-версия протокола |
| `4112` | `WS_CLOSE_SERVER_SHUTDOWN` | P06/P33/P36 | да | Плановый рестарт или остановка игрового процесса |
| `4113` | `WS_CLOSE_INTERNAL_ERROR` | P06 | да | Невосстановимая внутренняя ошибка комнаты |
| `4114` | `WS_CLOSE_HANDOFF_COMPLETE` | P06/P32 | перенаправление | Нормальное завершение подключения после бесшовного handoff |
| `4115` | `WS_CLOSE_HANDOFF_FAILED` | P32 | да | Откат или таймаут межпартиционного handoff |
| `4116` | `WS_CLOSE_PARTITION_DRAINING` | P06/P32 | перенаправление | Узел или партиция в режиме drain: активная сессия перенаправляется на новый узел; новый вход на drain-узел отклоняется этим же кодом, и клиент запрашивает у API новый game ticket (API маршрутизирует на живой узел) |
| `4117` | `WS_CLOSE_EPOCH_FENCED` | P08/P32 | да | Разделённый узел утратил `partition_epoch` lease |
| `4118` | `WS_CLOSE_SPLIT_MERGE_RECONNECT` | P32 | да | Горячий split/merge партиции требует переподключения |
| `4119` | `WS_CLOSE_STATE_DESYNC` | P06/P07 | да | Неустранимая рассинхронизация состояния клиента |
| `4120` | `WS_CLOSE_CLIENT_UPDATE_REQUIRED` | P34 | нет | Версия веб-клиента ниже минимально допустимой (`client_release_policies`) |
| `4121` | `WS_CLOSE_LEGAL_CONSENT_REQUIRED` | P36 | нет | Требуется принятие обновлённых ToS / Privacy Policy перед входом |
| `4122` | `WS_CLOSE_LOGOUT_COMPLETE` | P06 | нет | Штатный выход игрока (мгновенный или после задержки выхода) |
| `4123` | `WS_CLOSE_SESSION_REVOKED` | P04/P06 | нет | Сессии аккаунта отозваны (смена пароля, выход со всех устройств) |
| `4124` | `WS_CLOSE_ACCOUNT_ALREADY_IN_WORLD` | P06 | нет | Отклонён вход: в мире уже находится другой персонаж этого аккаунта |
| `4125` | `WS_CLOSE_CHARACTER_LOCKED` | P06/P29 | нет | Персонаж заблокирован персоналом |
| `4126` | `WS_CLOSE_CHARACTER_FORCE_RENAME` | P06/P29 | нет | Персонаж переведён в состояние обязательного переименования |
| `4127` | `WS_CLOSE_SHARD_MAINTENANCE` | P06/P33 | нет | Шард переведён в `MAINTENANCE`; вход доступен только персоналу |
| `4128` | `WS_CLOSE_PARTITION_NOT_READY` | P06 | да | Комната партиции ещё не завершила загрузку |
| `4129` | `WS_CLOSE_HANDSHAKE_TIMEOUT` | P07 | да | Клиент не прислал приветственное сообщение сессии за отведённое время |
| `4130` | `WS_CLOSE_SLOW_CONSUMER` | P07 | да | Переполнение исходящего буфера отправки (медленный потребитель) |
| `4131` | `WS_CLOSE_HEARTBEAT_TIMEOUT` | P07 | да | Сервер не получал от клиента сообщений/пингов дольше сетевого таймаута («полуоткрытое» соединение) |
| `4132..4199` | Резерв | — | — | Для будущих подсистем |

**Доставка адреса перенаправления.** Причина закрытия WebSocket ограничена 123 байтами и не переносит тикет. Для `4114` сервер до закрытия отправляет сообщение handoff с новым тикетом (`PartitionHandoffTicket` P12 / `HandoffCommit` P32); для `4116` — то же сообщение, если целевая комната известна, иначе клиент запрашивает новый game ticket у API. Константы кодов живут в едином модуле `packages/protocol` (`src/errors/ws-close-codes.ts`), который вводит P06 и используют все последующие фазы.
