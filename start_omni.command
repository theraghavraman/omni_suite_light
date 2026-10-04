#!/bin/sh
set -u
cd "$(dirname "$0")"

ROOT="$(pwd)"
BOOTSTRAP="$ROOT/omni_bootstrap.py"
INSTALLER="$ROOT/install_system_tools.command"

echo ""
echo "=========================================="
echo "  OmniConverter Local Bootstrap"
echo "=========================================="
echo ""

if [ ! -f "$BOOTSTRAP" ]; then
  echo "[ERROR] omni_bootstrap.py was not found in:"
  echo "        $ROOT"
  exit 1
fi

# Prefer an already-installed supported virtual environment.
if [ -x "$ROOT/.venv/bin/python" ]; then
  exec "$ROOT/.venv/bin/python" -u "$BOOTSTRAP"
fi

# Otherwise use system Python; the bootstrap will run the full installer
# automatically when the local environment is incomplete.
if command -v python3 >/dev/null 2>&1; then
  exec python3 -u "$BOOTSTRAP"
fi

# If Python is missing entirely, the bootstrap itself cannot run. Install it
# first using the platform installer, then launch the supported venv.
if [ -f "$INSTALLER" ]; then
  echo "[SETUP] Python 3 was not found. Running the complete local installer..."
  /bin/sh "$INSTALLER"
  if [ -x "$ROOT/.venv/bin/python" ]; then
    exec "$ROOT/.venv/bin/python" -u "$BOOTSTRAP"
  fi
fi

echo "[ERROR] Python 3 could not be installed or found."
echo "Run install_system_tools.command manually, then launch Omni.command again."
exit 1
