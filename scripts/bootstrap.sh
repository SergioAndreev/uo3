#!/bin/sh
# Префлайт: Node.js 22, pnpm 9, зависимости; дальше работает scripts/bootstrap.ts.
set -eu
cd "$(dirname "$0")/.."
command -v node >/dev/null 2>&1 || { echo 'Установите Node.js 22' >&2; exit 1; }
case "$(node -v)" in
  v22.*) ;;
  *) echo "Требуется Node.js 22.x, обнаружена $(node -v)" >&2; exit 1 ;;
esac
command -v pnpm >/dev/null 2>&1 || { echo 'Нет pnpm 9. Выполните: corepack enable' >&2; exit 1; }
case "$(pnpm -v)" in
  9.*) ;;
  *) echo "Требуется pnpm 9, обнаружен $(pnpm -v). Выполните: corepack enable" >&2; exit 1 ;;
esac
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@duskmarch/db --concurrency=2
exec pnpm exec tsx scripts/bootstrap.ts
