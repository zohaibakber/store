#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
URL="${TABAQ_VERIFY_URL:-http://127.0.0.1:5174}"
HOST="${TABAQ_VERIFY_HOST:-127.0.0.1}"
PORT="${TABAQ_VERIFY_PORT:-5174}"
STATE_DIR="${TABAQ_VERIFY_STATE_DIR:-/tmp/tabaaq-verify}"
LOG="${STATE_DIR}/vite.log"
PIDFILE="${STATE_DIR}/vite.pid"

mkdir -p "$STATE_DIR"

if curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; then
  echo "launch: $URL already answers. Refuse to attach. Stop the foreign instance or skip verification." >&2
  exit 1
fi

cd "$ROOT/apps/web"
setsid vp dev >"$LOG" 2>&1 &
echo $! >"$PIDFILE"

for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; then
    echo "launch: ready $URL pid=$(cat "$PIDFILE") log=$LOG"
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "launch: vp dev exited before $URL answered. See $LOG" >&2
    exit 1
  fi
  sleep 0.5
done

echo "launch: timed out waiting for $URL. See $LOG" >&2
exit 1
