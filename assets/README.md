# Правовая политика ассетов UO3 (ADR-002)

Репозиторий **не содержит и не распространяет** проприетарные файлы клиента Ultima Online (EA / Broadsword Online Games). Клиент работает по модели **BYOC (Bring Your Own Client)**, а для разработки и CI используются синтетические и CC0-ассеты (начиная с фазы P02).

## Автоматическая проверка (`pnpm check:assets`)

Скрипт `scripts/check-assets.ts` выполняется в `.husky/pre-commit` (`--staged`) и в CI `quality-gates` (`--all`) и отклоняет коммиты со следующими кодами ошибок:

| Код ошибки                 | Причина                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PROPRIETARY_UO_ASSET` | Расширение UO (`.mul`, `.uop`, `.idx`, `.def`, `.enu`), имя файла клиента UO (кроме исходников/документации `.ts`/`.tsx`/`.js`/`.mjs`/`.json`/`.md`/`.yaml`) или бинарная сигнатура `MYP\0` |
| `ERR_BINARY_SIZE_LIMIT`    | Бинарный файл превышает лимит `512` КиБ (`524288` байт)                                                                                                                                     |
| `ERR_UNDECLARED_ASSET`     | Бинарный медиа/ассет не зарегистрирован в `assets/ASSET_MANIFEST.json`, имеет недопустимую лицензию или несовпадающий SHA-256                                                               |
| `ERR_INVALID_MANIFEST`     | Нарушена структура `assets/ASSET_MANIFEST.json` относительно `assets/asset-manifest.schema.json`                                                                                            |

## Добавление нового CC0 / synthetic ассета (для фазы P02 и далее)

1. Убедитесь, что файл создан вами/процедурно (`synthetic-generated`) либо распространяется под `CC0-1.0`, и его размер ≤ `512` КиБ.
2. Посчитайте SHA-256: `node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('assets/path.png')).digest('hex'))"`.
3. Добавьте запись в `assets/ASSET_MANIFEST.json`:
   ```json
   {
     "path": "assets/placeholders/tile.png",
     "sha256": "<64-hex>",
     "license": "CC0-1.0",
     "source": "Procedural CC0 placeholder generator",
     "addedInPhase": "P02"
   }
   ```
4. Запустите `pnpm check:assets` и убедитесь в коде возврата `0`.
