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
ICON_ROOT="${HOME}/.local/share/icons/hicolor"
ICON_NAME="store-electron"

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
curl -fL --progress-bar "${asset_url}" -o "${INSTALL_DIR}/${APP_NAME}.AppImage"
chmod +x "${INSTALL_DIR}/${APP_NAME}.AppImage"

ln -sf "${INSTALL_DIR}/${APP_NAME}.AppImage" "${BIN_DIR}/tabaaq"

extract_dir=$(mktemp -d)
cleanup() {
  rm -r "${extract_dir}"
}
trap cleanup EXIT

(
  cd "${extract_dir}"
  "${INSTALL_DIR}/${APP_NAME}.AppImage" \
    --appimage-extract usr/share/icons/hicolor >/dev/null
)

for source_icon in \
  "${extract_dir}"/squashfs-root/usr/share/icons/hicolor/*/apps/"${ICON_NAME}.png"; do
  [ -f "${source_icon}" ] || continue
  size=$(basename "$(dirname "$(dirname "${source_icon}")")")
  install -Dm644 "${source_icon}" "${ICON_ROOT}/${size}/apps/${ICON_NAME}.png"
done

cat > "${DESKTOP_DIR}/tabaaq.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Tabaaq inventory desktop app
Exec=${INSTALL_DIR}/${APP_NAME}.AppImage --no-sandbox %U
Icon=${ICON_NAME}
StartupWMClass=Tabaaq
Terminal=false
Categories=Office;
MimeType=x-scheme-handler/com.tabaaq.desktop;
EOF

if command -v update-desktop-database >/dev/null; then
  update-desktop-database "${DESKTOP_DIR}"
fi
if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache -f -t "${ICON_ROOT}" >/dev/null 2>&1 || true
fi
if command -v kbuildsycoca6 >/dev/null; then
  kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null; then
  kbuildsycoca5 >/dev/null 2>&1 || true
fi

echo "Installed ${APP_NAME} to ${INSTALL_DIR}."
echo "Launch it with 'tabaaq' (add ${BIN_DIR} to PATH if needed) or from your application menu."
