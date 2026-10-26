#!/usr/bin/env bash
set -euo pipefail

: "${STAGE:?STAGE is required}"

if [ -z "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  echo "::error::GOOGLE_OAUTH_CLIENT_SECRET is empty for stage '${STAGE}'."
  exit 1
fi
