#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

region="global"
if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then
  region="$1"
  shift
fi

case "$region" in
  cn|global|dev) ;;
  *)
    printf '用法: %s [global|cn|dev] [--local|--endpoints-cdn|--isolated-auth]\n' "$0" >&2
    exit 2
    ;;
esac

if ! command -v pnpm >/dev/null 2>&1; then
  printf '未找到 pnpm，请先安装 pnpm。\n' >&2
  exit 1
fi

cd "$ROOT_DIR"
exec pnpm dsh:dev -- "--region=${region}" "$@"
