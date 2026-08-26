#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${TABAQ_VERIFY_STATE_DIR:-/tmp/tabaaq-verify}"
PIDFILE="${STATE_DIR}/vite.pid"

if [[ ! -f "$PIDFILE" ]]; then
  echo "cleanup: no pidfile at $PIDFILE; nothing this run started"
  exit 0
fi

pid="$(cat "$PIDFILE")"
if kill -0 "$pid" 2>/dev/null; then
  kill -- "-$pid" 2>/dev/null || kill "$pid" || true
  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.25
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" || true
  fi
  echo "cleanup: stopped pid $pid"
else
  echo "cleanup: pid $pid already gone"
fi
rm -f "$PIDFILE"
echo "cleanup: left evidence in .cursor/skills/verify-tabaaq/artifacts/"
