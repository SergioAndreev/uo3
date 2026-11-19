# Реестр опкодов протокола и кодов закрытия WebSocket (`@uo3/protocol`)

> Авторитетный единый справочник выделения числовых диапазонов `uint16`-опкодов (`0x0001..0x0FFF`) и кодов закрытия WebSocket (`4000..4099`) между всеми 37 фазами UO3.
> При реализации фаз в `packages/protocol` следует использовать диапазоны из этого реестра (если черновые примеры в отдельных `design.md` пересекались, приоритет имеет данная таблица).

## 1. Диапазоны опкодов `@uo3/protocol` (`uint16`)

Каждый домен получает фиксированный блок размером 16 или 32 опкода без пересечений:

| Диапазон | Фаза | Подсистема |
|---|---|---|
| `0x0001..0x001F` | P07 | Системные и сетевые сообщения (Handshake, ProtocolVersion, ClockSync Ping/Pong, ErrorEnvelope, Resync) |
| `0x0020..0x003F` | P06 | Сессии и ShardHubRoom (SessionReady, SafeLogout, SystemBroadcast, Presence) |
| `0x0100..0x011F` | P12 | Движение и навигация (WalkRequest, WalkAck, WalkDeny, TeleportSync, PartitionHandoffTicket, ClientGeometryReady, AutoPath) |
| `0x0120..0x014F` | P13 | Предметы, контейнеры, Drag-and-Drop, экипировка (PickUp, Drop, Equip, OpenContainer, SingleClick, DoubleClick, BounceBack) |
| `0x0150..0x017F` | P14 | Интерфейс гампов, таргетинг, пейпердолл, базовая речь (OpenGump, CloseGump, GumpReply, TargetRequest/Response, Paperdoll, MacroSync) |
| `0x0180..0x019F` | P15 | Статы, виталы и навыки (StatLockChange, SkillUse, SkillLockChange, SkillDelta, VitalUpdate) |
| `0x01A0..0x01CF` | P16 | Бой, урон, лечение, яды, смерть и воскрешение (WarModeToggle, AttackRequest, SwingEvent, DamageNumber, BandageUse, ResurrectOffer/Reply) |
| `0x01D0..0x01EF` | P17 | Нотореити, PvP, преступления, убийства, стража (MurderReportGump, CriminalFlag, GuardCall, LootPermission) |
| `0x01F0..0x021F` | P18 | Магия (CastSpell, CastScroll, SpellbookState, RunebookAction, FieldEffect, ReflectEvent) |
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
| `0x0380..0x038F` | P30 | Контент-пайплайн и локализация (ContentManifestVersion, ContentHotReloadNotice, LocalizationPatch) |
| `0x0390..0x039F` | P31 | Безопасность и античит (SecurityChallenge, RateLimitWarning, QuarantineNotice) |
| `0x03A0..0x03BF` | P32 | Масштабирование и межпартиционный handoff (PartitionTopologyHint, PrewarmHandoff, HandoffPrepare/Commit/Rollback, GhostResync) |
| `0x03C0..0x03CF` | P33 | Наблюдаемость и эксплуатация (OpsBannerState, MaintenanceCountdown, GracefulDrainRedirect) |
| `0x03D0..0x03DF` | P34 | Качество клиента (ClientCapabilitiesHello, VersionCompatibilityNotice, ClientLocaleUpdate/Ack, LocalizedSystemMessage, ClientPlatformTelemetry) |
| `0x03E0..0x03FF` | P36 | Бета, запуск и LiveOps (LoginQueuePosition, BetaInviteRedeem, LegalConsentRequired, LiveEventKillSwitch, PatchNotesBanner) |
| `0x0400..0x0FFF` | Резерв | Будущие расширения (эпохи LBR/AOS, WebTransport и пользовательские шарды) |

## 2. Коды закрытия WebSocket (`4000..4099`)

Все пользовательские коды закрытия Colyseus/WebSocket стандартизированы:

| Код | Константа | Фаза | Назначение |
|---|---|---|---|
| `4000` | `WS_CLOSE_PROTOCOL_ERROR` | P06/P07 | Некорректный формат кадра, неизвестный опкод или нарушение схемы |
| `4001` | `WS_CLOSE_INVALID_TICKET` | P05/P06 | Просроченный, отозванный или уже использованный game ticket |
| `4002` | `WS_CLOSE_UNAUTHORIZED` | P04/P06 | Невалидная сессия, отозванный JWT или недостаточный `AccessLevel` |
| `4003` | `WS_CLOSE_BANNED` | P04/P29 | Аккаунт или персонаж заблокирован (мгновенный кик) |
| `4004` | `WS_CLOSE_DUPLICATE_SESSION` | P06 | Вход того же персонажа/аккаунта из новой сессии |
| `4005` | `WS_CLOSE_CHARACTER_NOT_FOUND` | P05/P06 | Персонаж не найден, удалён или заблокирован |
| `4006` | `WS_CLOSE_PARTITION_FULL` | P05/P06 | Достигнут лимит игроков комнаты/шарда |
| `4007` | `WS_CLOSE_WORLD_DATA_MISMATCH` | P03/P07 | Несовместимая версия статических данных мира |
| `4008` | `WS_CLOSE_RATE_LIMIT_EXCEEDED` | P07/P31 | Превышен лимит сообщений / флуд-контроль |
| `4009` | `WS_CLOSE_IDLE_TIMEOUT` | P06/P07 | Истёк таймаут неактивности или потери heartbeat |
| `4010` | `WS_CLOSE_SECURITY_QUARANTINE` | P07/P31 | Разрыв из-за критичного нарушения античита / инвариантов |
| `4011` | `WS_CLOSE_PROTOCOL_VERSION_MISMATCH` | P07 | Несовместимая semver-версия протокола |
| `4012` | `WS_CLOSE_SERVER_SHUTDOWN_DRAIN` | P06/P33/P36 | Плановый рестарт, дренаж или переход шарда в `MAINTENANCE` |
| `4013` | `WS_CLOSE_INTERNAL_ERROR` | P06 | Невосстановимая внутренняя ошибка комнаты |
| `4014` | `WS_CLOSE_HANDOFF_COMPLETE` | P06/P32 | Нормальное завершение подключения после бесшовного handoff |
| `4015` | `WS_CLOSE_HANDOFF_FAILED` | P32 | Откат или таймаут межпартиционного handoff (требуется переподключение) |
| `4016` | `WS_CLOSE_PARTITION_DRAINING` | P32 | Партиция в режиме drain — клиент перенаправляется на новый узел |
| `4017` | `WS_CLOSE_EPOCH_FENCED` | P32 | Разделённый узел утратил `partition_epoch` lease |
| `4018` | `WS_CLOSE_SPLIT_MERGE_RECONNECT` | P32 | Горячий split/merge партиции требует переподключения |
| `4019` | `WS_CLOSE_STATE_DESYNC` | P06/P07 | Неустранимая рассинхронизация состояния клиента |
| `4020` | `WS_CLOSE_CLIENT_UPDATE_REQUIRED` | P34 | Версия веб-клиента ниже минимально допустимой (`client_release_policies`) |
| `4021` | `WS_CLOSE_LEGAL_CONSENT_REQUIRED` | P36 | Требуется принятие обновлённых ToS / Privacy Policy перед входом |
| `4022..4099` | Резерв | — | Для будущих подсистем |
