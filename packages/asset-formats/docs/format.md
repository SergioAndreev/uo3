# Пакет ассетов и чанки мира

Изоморфный пакет `@duskmarch/asset-formats` (браузер и Node.js). Подпути: `/pack`, `/chunk`, `/world`, `/palette`, `/glb`, `/synthetic`.

## Пакет ассетов

Каталог с `pack.json` и файлами. Каждая запись: ключ контента, вид, путь, SHA-256, размер, лицензия, источник (для `CC-BY-4.0` — `attribution`).

| Вид | Расширения | Лимит |
| --- | --- | --- |
| `model` | `.glb` | 8 МиБ |
| `texture` | `.ktx2`, `.png`, `.webp` | 8 МиБ |
| `audio` | `.ogg` | 8 МиБ |
| `palette`, `world-index` | `.json` | 1 МиБ |
| `chunk` | `.dmck` | 64 КиБ |

- `validateManifest` — схема, безопасные пути, уникальность, лицензии, лимиты.
- `verifyContents(manifest, read, listed)` — сверка SHA-256 и размеров; лишние файлы — предупреждение `ASSET_UNLISTED`.
- `packFingerprint` — SHA-256 канонического JSON из id, версии и записей по ключу.
- `PackLoader` — байты по ключу после сверки хэша; чтение внедряется (файлы в Node.js, `fetch` в браузере).

## Чанк `DMCK` версии 1

32×32 клетки, little-endian, без сжатия. Заголовок 24 байта: магия, версия, флаги, план, `cx`, `cy`, число ключей и объектов, CRC-32 тела. Тело: 1 024 клетки по 8 байт (поверхность, оттенок, высота, флаги), таблица ключей контента, объекты по 10 байт. Полная раскладка — в design.md фазы P02 (`openspec/changes/archive/*-p02-asset-pack-and-world-chunks/design.md`).

Кодирование каноническое: объекты сортируются по `(ly, lx, h, key)`, ключи — по первому появлению, неиспользуемых ключей нет. `decodeChunk` бросает `ChunkFormatError` с кодом (`CHUNK_MAGIC`, `CHUNK_VERSION`, `CHUNK_TRUNCATED`, `CHUNK_CRC`, `CHUNK_VALUE`) и смещением.

## Индекс мира

`world.json`: план, размер в клетках (кратен 32), чанки с ключами и хэшами, необязательные ориентиры `landmarks`. Ключ чанка — `chunk.<план>.x<cx>.y<cy>`, путь — `chunks/<план>/<cx>_<cy>.dmck`.

## Палитра

256 оттенков: 0 — естественный цвет; `1 + tone × 17 + shade`, тон 0–14 (угол 35°–245°, янтарь → индиго), ступень 0–16 (яркость 12–92 %), насыщенность 70 %. Вычисляется целочисленно, эталон — `src/palette/palette.vectors.json`.

## Синтетический мир

`generateSyntheticPack(preset, seed)` возвращает манифест, файлы и индекс мира; одинаковые параметры дают одинаковые байты.

- `proving` — план 64×64 со стендами: `spawn`, `stairs`, `low-ceiling`, `wall-window`, `wall-opening`, `door`, `shallow-water`, `deep-water`, `shelter`, `hazard`.
- `field` — план `dawn` 256×256: шум значений, вода, песок, трава с деревьями, камень, снег; перепад соседних клеток суши не больше 2 шагов.
- Модели-заглушки GLB: `model.test-crate`, `model.test-column`, `model.test-wall`, `model.test-tree`, `model.test-dummy`.
