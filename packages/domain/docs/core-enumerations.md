# `domain/core-enumerations` — Канонические перечисления и TileData (UO:R)

Модуль `@uo3/domain/enums` содержит все базовые коды и флаги мира Ultima Online: Renaissance.

## Слои экипировки (`Layer`, `0x00..0x1D`)

- Оружие (взаимоисключающие): `0x01 OneHanded`, `0x02 TwoHanded`.
- Экипировка: `0x03 Shoes`, `0x04 Pants`, `0x05 Shirt`, `0x06 Helm`, `0x07 Gloves`, `0x08 Ring`, `0x09 Talisman`, `0x0A Neck`, `0x0C Waist`, `0x0D InnerTorso`, `0x0E Bracelet`, `0x11 MiddleTorso`, `0x12 Earrings`, `0x13 Arms`, `0x14 Cloak`, `0x16 OuterTorso`, `0x17 OuterLegs`, `0x18 InnerLegs`.
- Внешность (неперетаскиваемые): `0x0B Hair`, `0x0F Face`, `0x10 FacialHair`.
- Системные (неперетаскиваемые): `0x15 Backpack`, `0x19 Mount`, `0x1A ShopBuy`, `0x1B ShopResale`, `0x1C ShopSell`, `0x1D Bank`.
- Порядок отрисовки: `LAYER_DRAW_ORDER` (от `Shoes`/`Pants`/`Shirt` к `InnerTorso` → `MiddleTorso` → `OuterTorso` → `Cloak`).

## Тела (`BodyId`), расы (`Race`), пол (`Gender`) и оттенки (`Hue`)

- `BodyId` (`0..65535`): `0 Empty`, `400 Human Male`, `401 Human Female`, `402 Human Male Ghost`, `403 Human Female Ghost`, `987 Staff Robe`.
- `Race`: `0 Human` (единственная активная в `uor`), `1 Elf`, `2 Gargoyle` (зарезервированы под будущие эпохи; в `uor` → `ERR_RACE_DISABLED_IN_ERA`).
- `Gender`: `0 Male`, `1 Female` (`ERR_INVALID_GENDER`).
- `Hue` (`uint16`, 2 байта BE): индекс `0x3FFF`, `Translucent = 0x4000`, `PartialHue = 0x8000`. Кожа: `1002..1058`, волосы: `1102..1149` (`ERR_HUE_OUT_OF_ALLOWED_RANGE`).

## Репутация (`Notoriety`, `1..7`) и права доступа (`AccessLevel`, `0..6`)

| `Notoriety` | Код | Токен цвета | `isCriminalToAttack` | `canReceiveDamage` |
| --- | --- | --- | --- | --- |
| `Innocent` | `1` | `blue` | `true` | `true` |
| `Ally` | `2` | `green` | `false` | `true` |
| `CanBeAttacked` | `3` | `gray` | `false` | `true` |
| `Criminal` | `4` | `gray` | `false` | `true` |
| `Enemy` | `5` | `orange` | `false` | `true` |
| `Murderer` | `6` | `red` | `false` | `true` |
| `Invulnerable` | `7` | `yellow` | `false` | `false` |

`AccessLevel`: `0 Player`, `1 Counselor`, `2 GameMaster`, `3 Seer`, `4 Administrator`, `5 Developer`, `6 Owner`. Персонал: `>= Counselor`. Субординация `canStaffTarget(actor, target)`: `actor === Owner || actor > target`.

## 49 навыков UO:Renaissance (`SkillId`, `0..48`), статы и блокировки

- Статы (`StatId`): `0 Strength`, `1 Dexterity`, `2 Intelligence`.
- Блокировки (`LockState`): `0 Up`, `1 Down`, `2 Locked`.
- Точность навыка (`SkillTenths`): целое `0..1000` (десятые доли `0.0..100.0`).
- Навыки: `0 Alchemy`, `1 Anatomy`, `2 AnimalLore`, `3 ItemId`, `4 ArmsLore`, `5 Parry`, `6 Begging`, `7 Blacksmithy`, `8 Fletching`, `9 Peacemaking`, `10 Camping`, `11 Carpentry`, `12 Cartography`, `13 Cooking`, `14 DetectHidden`, `15 Discordance`, `16 EvalInt`, `17 Healing`, `18 Fishing`, `19 Forensics`, `20 Herding`, `21 Hiding`, `22 Provocation`, `23 Inscribe`, `24 Lockpicking`, `25 Magery`, `26 MagicResist`, `27 Tactics`, `28 Snooping`, `29 Musicianship`, `30 Poisoning`, `31 Archery`, `32 SpiritSpeak`, `33 Stealing`, `34 Tailoring`, `35 AnimalTaming`, `36 TasteID`, `37 Tinkering`, `38 Tracking`, `39 Veterinary`, `40 Swords`, `41 Macing`, `42 Fencing`, `43 Wrestling`, `44 Lumberjacking`, `45 Mining`, `46 Meditation`, `47 Stealth`, `48 RemoveTrap`.

## Типы тайлов, 64-битные `TileFlag` (0..63) и `TileData`

- Графика: `LandId` (`0..0x3FFF`, `NoDraw = 0x0002`), `ItemId` (`0..0xFFFF`, `NoDraw = 0x0001`), `MultiId` (`0..0x3FFF`).
- Младшие биты `0..31`: `0 Background`, `1 Weapon`, `2 Transparent`, `3 Translucent`, `4 Wall`, `5 Damaging`, `6 Impassable`, `7 Wet`, `8 Unknown1`, `9 Surface`, `10 Bridge`, `11 Generic`, `12 Window`, `13 NoShoot`, `14 ArticleA`, `15 ArticleAn`, `16 Internal`, `17 Foliage`, `18 PartialHue`, `19 NoHouse`, `20 Map`, `21 Container`, `22 Wearable`, `23 LightSource`, `24 Animation`, `25 HoverOver`, `26 NoDiagonal`, `27 Armor`, `28 Roof`, `29 Door`, `30 StairBack`, `31 StairRight`.
- Старшие биты High Seas `32..63`: `32 AlphaBlend`, `33 UseNewArt`, `34 ArtUsed`, `35 NoShadow`, `36 PixelBleed`, `37 PlayAnimOnce`, `38 Unknown2`, `39 Unknown3`, `40 MultiMovable`, биты `41..63` сохраняются без потерь в `bigint`, `"0x..."` hex и 8-байтовых BE/LE буферах.
- Производные правила: `calcTileHeight(item)` делит `height` пополам (`Math.floor(height / 2)`) при флаге `Bridge`; `doesTileBlockLos(tile)` возвращает `false` при флаге `Window`, иначе `true` при `NoShoot` или `Impassable`.
