#!/bin/sh
set -u
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON="python"
else
  echo "[ERROR] Python 3.11+ was not found."
  echo "Install Python, then run Omni.command again."
  read -r -p "Press Enter to close..." _
  exit 1
fi

if [ -x ".venv/bin/python" ]; then PYTHON=".venv/bin/python"; fi
echo "Starting OmniConverter Local Engine..."
"$PYTHON" -u omni_local_server.py
RC=$?
if [ "$RC" -ne 0 ]; then
  echo
  echo "[ERROR] Local Engine exited with code $RC."
  read -r -p "Press Enter to close..." _
fi
exit "$RC"
