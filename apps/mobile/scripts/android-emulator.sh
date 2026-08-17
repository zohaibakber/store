#!/usr/bin/env bash

set -euo pipefail

android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/opt/android-sdk}}"
adb_bin="$android_sdk/platform-tools/adb"
emulator_bin="$android_sdk/emulator/emulator"
avd_name="${ANDROID_AVD_NAME:-pixel_34_arm}"
emulator_log="${TMPDIR:-/tmp}/tabaaq-android-emulator.log"
boot_wait_seconds="${ANDROID_BOOT_WAIT_SECONDS:-600}"

if [[ ! -x "$adb_bin" ]]; then
  echo "Android adb was not found at $adb_bin" >&2
  exit 1
fi

if [[ ! -x "$emulator_bin" ]]; then
  echo "Android emulator was not found at $emulator_bin" >&2
  exit 1
fi

config_abi="$(
  python3 - "$HOME/.android/avd/${avd_name}.avd/config.ini" <<'PY'
import pathlib
import sys
path = pathlib.Path(sys.argv[1])
values = {}
for line in path.read_text().splitlines():
    if "=" in line:
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
print(values.get("abi.type") or values.get("hw.cpu.arch") or "")
PY
)"

if [[ "$config_abi" != *arm64* && "$config_abi" != *armeabi* ]]; then
  echo "Refusing to start $avd_name because it is not an ARM AVD (abi=$config_abi)." >&2
  echo "Use ANDROID_AVD_NAME=pixel_34_arm." >&2
  exit 1
fi

device_abi() {
  local serial="$1"
  "$adb_bin" -s "$serial" shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r'
}

emulator_serial=""
while read -r serial; do
  [[ -z "$serial" ]] && continue
  abi="$(device_abi "$serial")"
  if [[ "$abi" == arm64-v8a || "$abi" == armeabi-v7a ]]; then
    emulator_serial="$serial"
    break
  fi
  echo "Ignoring non-ARM emulator $serial (abi=$abi)"
done < <("$adb_bin" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1 }')

if [[ -z "$emulator_serial" ]]; then
  echo "Starting ARM Android emulator: $avd_name"
  "$emulator_bin" -avd "$avd_name" -no-snapshot-save >"$emulator_log" 2>&1 &

  for _ in $(seq 1 "$boot_wait_seconds"); do
    while read -r serial; do
      [[ -z "$serial" ]] && continue
      abi="$(device_abi "$serial")"
      if [[ "$abi" == arm64-v8a || "$abi" == armeabi-v7a ]]; then
        emulator_serial="$serial"
        break 2
      fi
    done < <("$adb_bin" devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1 }')
    sleep 1
  done

  if [[ -z "$emulator_serial" ]]; then
    echo "The ARM emulator did not connect. See $emulator_log" >&2
    exit 1
  fi
else
  echo "Using running ARM Android emulator: $emulator_serial"
fi

echo "Waiting for ARM Android to finish booting on $emulator_serial"
for _ in $(seq 1 "$boot_wait_seconds"); do
  if [[ "$($adb_bin -s "$emulator_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    break
  fi
  sleep 1
done

if [[ "$($adb_bin -s "$emulator_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  echo "ARM Android did not finish booting. See $emulator_log" >&2
  exit 1
fi

abi="$(device_abi "$emulator_serial")"
if [[ "$abi" != arm64-v8a && "$abi" != armeabi-v7a ]]; then
  echo "Refusing to launch on non-ARM device $emulator_serial (abi=$abi)." >&2
  exit 1
fi

echo "Starting Metro and opening Tabaaq on ARM emulator $emulator_serial ($abi)"
exec bunx expo start --android
