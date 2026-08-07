#!/usr/bin/env bash

set -euo pipefail

android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/opt/android-sdk}}"
adb_bin="$android_sdk/platform-tools/adb"
emulator_bin="$android_sdk/emulator/emulator"
avd_name="${ANDROID_AVD_NAME:-pixel_34}"
emulator_log="${TMPDIR:-/tmp}/tabaaq-android-emulator.log"

if [[ ! -x "$adb_bin" ]]; then
  echo "Android adb was not found at $adb_bin" >&2
  exit 1
fi

if [[ ! -x "$emulator_bin" ]]; then
  echo "Android emulator was not found at $emulator_bin" >&2
  exit 1
fi

emulator_serial="$($adb_bin devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"

if [[ -z "$emulator_serial" ]]; then
  echo "Starting Android emulator: $avd_name"
  "$emulator_bin" -avd "$avd_name" -no-snapshot-save >"$emulator_log" 2>&1 &

  for _ in {1..120}; do
    emulator_serial="$($adb_bin devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')"
    [[ -n "$emulator_serial" ]] && break
    sleep 1
  done

  if [[ -z "$emulator_serial" ]]; then
    echo "The emulator did not connect. See $emulator_log" >&2
    exit 1
  fi
else
  echo "Using running Android emulator: $emulator_serial"
fi

echo "Waiting for Android to finish booting"
for _ in {1..120}; do
  if [[ "$($adb_bin -s "$emulator_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    break
  fi
  sleep 1
done

if [[ "$($adb_bin -s "$emulator_serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  echo "Android did not finish booting. See $emulator_log" >&2
  exit 1
fi

echo "Starting Metro and opening Tabaaq on $emulator_serial"
exec bunx expo start --android
