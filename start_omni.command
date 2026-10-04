#!/bin/sh
set -u
cd "$(dirname "$0")"

echo
echo "=========================================="
echo "  OmniConverter Local Engine"
echo "=========================================="
echo

PYTHON=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON="python"
else
  echo "[ERROR] Python 3 was not found."
  echo "Install Python 3.11+ and run this launcher again."
  read -r -p "Press Enter to close..." _
  exit 1
fi

if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
  echo "[OK] Using OmniConverter virtual environment."
else
  echo "[WARN] .venv not found; using system Python."
fi
echo "[OK] Python: $PYTHON"
echo "[OK] Starting Local Engine on http://127.0.0.1:8765/"
echo

"$PYTHON" omni_local_server.py
RC=$?

echo
if [ "$RC" -ne 0 ]; then
  echo "[ERROR] OmniConverter stopped with exit code $RC."
  read -r -p "Press Enter to close..." _
else
  echo "OmniConverter Local Engine stopped."
fi
exit "$RC"
