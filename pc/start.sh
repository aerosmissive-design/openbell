#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "[오류] pc/.env 가 없습니다. env.example 을 복사해 .env 로 만드세요."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${OPENBELL_URL:-}" || -z "${NAS_WORKER_TOKEN:-}" ]]; then
  echo "[오류] OPENBELL_URL, NAS_WORKER_TOKEN 을 .env 에 넣으세요."
  exit 1
fi

export PLAYWRIGHT_STATE_DIR="${PLAYWRIGHT_STATE_DIR:-$(pwd)/../nas/worker/data}"
export HEADLESS="${HEADLESS:-1}"
export POLL_SECONDS="${POLL_SECONDS:-15}"

cd ../nas/worker
if [[ ! -d node_modules ]]; then
  echo "[설치] npm install..."
  npm install
fi
mkdir -p data

echo "[PC 도우미] 시작 — Ctrl+C 로 종료"
exec node index.mjs
