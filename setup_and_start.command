#!/bin/sh
set -u
cd "$(dirname "$0")"

echo
echo "=========================================="
echo "  OmniConverter macOS/Linux Setup"
echo "=========================================="
echo

if ! command -v bash >/dev/null 2>&1; then
  echo "[ERROR] bash was not found."
  read -r -p "Press Enter to close..." _
  exit 1
fi

bash install_system_tools.command
RC=$?
if [ "$RC" -ne 0 ]; then
  echo
  echo "[ERROR] Native dependency setup failed."
  read -r -p "Press Enter to close..." _
  exit "$RC"
fi

echo
echo "[OK] Setup completed. Launching OmniConverter..."
echo
bash start_omni.command
exit $?
