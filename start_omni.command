#!/bin/sh
set -u
cd "$(dirname "$0")"

if [ ! -x ".venv/bin/python" ] || ! .venv/bin/python verify_local_environment.py >/dev/null 2>&1; then
  echo
  echo "[SETUP] Complete local environment is not ready."
  echo "[SETUP] Running one-click dependency installer now..."
  echo
  bash install_system_tools.command
fi

PYTHON=".venv/bin/python"
echo
echo "=========================================="
echo "  OmniConverter Local Engine"
echo "=========================================="
echo
echo "[OK] Complete local environment verified."
echo "[OK] Starting Local Engine on http://127.0.0.1:8765/"
echo
"$PYTHON" -u omni_local_server.py
RC=$?

echo
if [ "$RC" -ne 0 ]; then
  echo "[ERROR] OmniConverter stopped with exit code $RC."
  read -r -p "Press Enter to close..." _
fi
exit "$RC"
