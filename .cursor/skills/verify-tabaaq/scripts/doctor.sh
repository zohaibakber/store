#!/usr/bin/env bash
set -euo pipefail

URL="${TABAQ_VERIFY_URL:-http://127.0.0.1:5174}"
STATE_DIR="${TABAQ_VERIFY_STATE_DIR:-/tmp/tabaaq-verify}"
PIDFILE="${STATE_DIR}/vite.pid"
API="${TABAQ_VERIFY_API:-http://127.0.0.1:8787/api/health}"

html="$(curl -fsS --max-time 5 "$URL")" || {
  echo "doctor: $URL is not answering" >&2
  exit 1
}

if ! printf '%s' "$html" | grep -q '<title>Tabaaq</title>'; then
  echo "doctor: $URL did not return the Tabaaq document title" >&2
  exit 1
fi

if [[ -f "$PIDFILE" ]]; then
  pid="$(cat "$PIDFILE")"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "doctor: pidfile $PIDFILE exists but pid $pid is not running" >&2
    exit 1
  fi
  echo "doctor: spa ok title=Tabaaq url=$URL pid=$pid"
else
  echo "doctor: spa ok title=Tabaaq url=$URL pid=unknown (this run did not start the instance)"
  echo "doctor: do not drive this instance unless the operator named it as the verification target" >&2
fi

if curl -fsS --max-time 3 "$API" >/dev/null 2>&1; then
  echo "doctor: api ok $API"
else
  echo "doctor: api down $API (browser sign-in and inventory mutations will fail; sign-in shell still driveable)"
fi
