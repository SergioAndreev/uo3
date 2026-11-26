# @duskmarch/asset-tool

CLI для пакетов ассетов и чанков мира Duskmarch. Коды возврата: `0` — успех, `1` — ошибки данных, `2` — ошибка вызова. `--json` выводит один JSON-объект.

```sh
pnpm --filter @duskmarch/asset-tool exec tsx src/index.ts generate-world --preset proving --seed 42 --out ../../local-assets/proving
pnpm --filter @duskmarch/asset-tool exec tsx src/index.ts validate-pack ../../local-assets/proving
pnpm --filter @duskmarch/asset-tool exec tsx src/index.ts inspect-chunk ../../local-assets/proving/chunks/proving/0_0.dmck
pnpm --filter @duskmarch/asset-tool exec tsx src/index.ts radar ../../local-assets/proving --out ../../local-assets/proving.png
pnpm --filter @duskmarch/asset-tool exec tsx src/index.ts fingerprint ../../local-assets/proving --json
```

| Команда                                                                       | Назначение                                                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `validate-pack <каталог>`                                                     | манифест, хэши, размеры, чанки и индекс мира                            |
| `inspect-chunk <файл>`                                                        | заголовок, поверхности, флаги, высоты, объекты                          |
| `generate-world --preset proving\|field --seed <n> --out <каталог> [--force]` | синтетический пакет; непустой каталог без `--force` не перезаписывается |
| `radar <каталог> --out <файл.png>`                                            | PNG-превью плана, пиксель на клетку                                     |
| `fingerprint <каталог>`                                                       | отпечаток пакета                                                        |
| `check-env`                                                                   | проверка переменных окружения                                           |

Собранный бинарник: `pnpm --filter @duskmarch/asset-tool build && node apps/asset-tool/dist/index.js --version`. Переменные окружения — в `.env.example`; некорректное окружение завершает процесс с кодом `78`.

Каталог `local-assets/` исключён из git: сгенерированные пакеты не коммитятся.
