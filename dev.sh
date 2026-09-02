#!/usr/bin/env bash
# chaos-oss · development server
#
# Runs both halves of the app concurrently:
#   - Go backend on :5244 (serving /api, /d, /p)
#   - Vite dev server on :5173 with HMR, proxying API traffic to :5244
#
# Usage:
#   ./dev.sh            # run both
#   ./dev.sh backend    # Go only
#   ./dev.sh frontend   # Vite only (expects backend already running)
set -euo pipefail
cd "$(dirname "$0")"

BACKEND_ADDR="${OPENLIST_ADDR:-127.0.0.1}"
BACKEND_PORT="${OPENLIST_HTTP_PORT:-5244}"
FRONTEND_PORT=5173

run_backend() {
  echo "[dev] backend: go run . server (http://${BACKEND_ADDR}:${BACKEND_PORT})"
  OPENLIST_ADDR="$BACKEND_ADDR" OPENLIST_HTTP_PORT="$BACKEND_PORT" go run . server
}

run_frontend() {
  echo "[dev] frontend: vite (http://localhost:${FRONTEND_PORT})"
  cd frontend
  if [ ! -d node_modules ]; then
    pnpm install
  fi
  pnpm dev -- --port "$FRONTEND_PORT"
}

case "${1:-both}" in
  backend)
    run_backend
    ;;
  frontend)
    run_frontend
    ;;
  both)
    trap 'kill 0' EXIT INT TERM
    run_backend &
    BACKEND_PID=$!
    # small wait so the proxy target is up before vite starts
    for _ in $(seq 1 30); do
      curl -sf "http://127.0.0.1:${BACKEND_PORT}/ping" >/dev/null 2>&1 && break
      sleep 0.5
    done
    run_frontend &
    FRONTEND_PID=$!
    wait "$BACKEND_PID" "$FRONTEND_PID"
    ;;
  *)
    echo "usage: $0 [both|backend|frontend]" >&2
    exit 1
    ;;
esac
