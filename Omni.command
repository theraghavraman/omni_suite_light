#!/bin/sh
set -u
cd "$(dirname "$0")"

SCRIPT_DIR="$(pwd)"
START="$SCRIPT_DIR/start_omni.command"

if [ ! -f "$START" ]; then
  echo "[ERROR] start_omni.command is missing from the OmniConverter folder."
  echo "Please re-download the repository or run the installer script directly."
  exit 1
fi

exec /bin/sh "$START"
