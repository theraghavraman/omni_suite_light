#!/bin/sh
set -eu
cd "$(dirname "$0")"
bash install_system_tools.command
bash start_omni.command
