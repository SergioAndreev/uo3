#!/usr/bin/env sh
set -eu

NODE_VER=$(node -v 2>/dev/null || true)
case "$NODE_VER" in
  v22.*) ;;
  *)
    echo "ERROR: Node.js 22 LTS (>=22.0.0 <23.0.0) is required; found '${NODE_VER:-none}'." >&2
    exit 1
    ;;
esac

if command -v corepack >/dev/null 2>&1; then
  corepack enable pnpm >/dev/null 2>&1 || true
fi

PNPM_VER=$(pnpm -v 2>/dev/null || true)
case "$PNPM_VER" in
  9.*) ;;
  *)
    echo "ERROR: pnpm 9.x is required; found '${PNPM_VER:-none}'." >&2
    exit 1
    ;;
esac

pnpm install --frozen-lockfile
exec pnpm exec tsx scripts/bootstrap.ts "$@"
