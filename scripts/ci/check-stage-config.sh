#!/usr/bin/env bash
set -euo pipefail

: "${STAGE:?STAGE is required}"

required=(
  AUTH_JWT_PRIVATE_JWK
  AUTH_JWT_PUBLIC_JWK
  AUTH_REFRESH_TOKEN_PEPPER
  AUTH_EPHEMERAL_PEPPER
  GOOGLE_OAUTH_CLIENT_ID
  GOOGLE_OAUTH_CLIENT_SECRET
)
if [ "${STAGE}" = "dev" ]; then
  required+=(NEON_API_KEY AUTH_BASE_URL)
else
  required+=(PRODUCTION_DOMAIN VITE_API_URL VITE_AUTH_URL)
fi

missing=0
for name in "${required[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "::error::${name} is empty for stage '${STAGE}'."
    missing=1
  fi
done

echo "AUTH_TRUSTED_ORIGINS=${AUTH_TRUSTED_ORIGINS:-<unset>}"
echo "ELECTRON_PROTOCOL=${ELECTRON_PROTOCOL:-<unset, default com.tabaaq.desktop>}"
echo "MOBILE_PROTOCOL=${MOBILE_PROTOCOL:-<unset, default com.tabaaq.mobile>}"
echo "PRODUCTION_DOMAIN=${PRODUCTION_DOMAIN:-<unset>}"
echo "VITE_API_URL=${VITE_API_URL:-<unset>}"
echo "VITE_AUTH_URL=${VITE_AUTH_URL:-<unset>}"
echo "VITE_SENTRY_DSN=${VITE_SENTRY_DSN:+set}"

exit "${missing}"
