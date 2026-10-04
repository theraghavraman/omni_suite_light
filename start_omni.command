#!/bin/sh
set -u
cd "$(dirname "$0")"
echo
echo "=========================================="
echo "  OmniConverter Local Bootstrap"
echo "=========================================="
echo
PYTHON="python3"
if [ -x ".venv/bin/python" ]; then PYTHON=".venv/bin/python"; fi
"$PYTHON" -u omni_bootstrap.py
RC=$?
if [ "$RC" -ne 0 ]; then
  echo
  echo "[ERROR] OmniConverter bootstrap failed with exit code $RC."
  read -r -p "Press Enter to close..." _
fi
exit "$RC"
