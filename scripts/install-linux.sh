#!/usr/bin/env bash
# Downloads and installs the latest Tabaaq Linux AppImage release.
#
#   curl -fsSL https://raw.githubusercontent.com/zohaibakber/store/main/scripts/install-linux.sh | bash
set -euo pipefail

REPO="zohaibakber/store"
APP_NAME="Tabaaq"
INSTALL_DIR="${HOME}/.local/opt/tabaaq"
BIN_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"

command -v curl >/dev/null || { echo "curl is required to install ${APP_NAME}." >&2; exit 1; }

asset_url=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*Linux[^"]*\.AppImage"' \
  | head -n1 \
  | sed -E 's/.*"(https[^"]+)"/\1/')

if [ -z "${asset_url}" ]; then
  echo "Could not find a Linux AppImage in the latest ${REPO} release." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}" "${BIN_DIR}" "${DESKTOP_DIR}"

echo "Downloading ${asset_url}"
curl -fsSL "${asset_url}" -o "${INSTALL_DIR}/${APP_NAME}.AppImage"
chmod +x "${INSTALL_DIR}/${APP_NAME}.AppImage"

ln -sf "${INSTALL_DIR}/${APP_NAME}.AppImage" "${BIN_DIR}/tabaaq"

cat > "${DESKTOP_DIR}/tabaaq.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${INSTALL_DIR}/${APP_NAME}.AppImage
Terminal=false
Categories=Office;
EOF

echo "Installed ${APP_NAME} to ${INSTALL_DIR}."
echo "Launch it with 'tabaaq' (add ${BIN_DIR} to PATH if needed) or from your application menu."
