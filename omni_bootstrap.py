#!/usr/bin/env python3
"""OmniConverter one-command local bootstrap and stale-engine guard."""
from __future__ import annotations
import json
import os
import platform
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8765
REQUIRED_ENGINE_API = 4

def pyexe() -> Path:
    if os.name == "nt":
        return ROOT / ".venv" / "Scripts" / "python.exe"
    return ROOT / ".venv" / "bin" / "python"

def run_setup() -> None:
    if os.name == "nt":
        cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "install_windows.ps1")]
    else:
        cmd = ["bash", str(ROOT / "install_system_tools.command")]
    print("[SETUP]", " ".join(cmd), flush=True)
    cp = subprocess.run(cmd, cwd=ROOT)
    if cp.returncode:
        raise SystemExit(cp.returncode)

def verify() -> bool:
    """Verify only the launch-critical runtime, not optional studio capabilities."""
    p = pyexe()
    if not p.is_file():
        return False
    cp = subprocess.run(
        [str(p), "-c", "import omni_local_server, omni_data_engine, omni_platform"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if cp.returncode != 0:
        print("[ERROR] Core Local Engine import check failed:", flush=True)
        print((cp.stderr or cp.stdout or "unknown Python import error").strip(), flush=True)
        return False
    return True

def health():
    try:
        with urllib.request.urlopen("http://127.0.0.1:8765/api/health", timeout=1.5) as r:
            if r.status != 200:
                return None
            return json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError):
        return None

def process_command(pid: int) -> str:
    if os.name == "nt":
        cp = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"],
            capture_output=True, text=True
        )
        return (cp.stdout or "").strip()
    cp = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True)
    return (cp.stdout or "").strip()

def port_pids():
    if os.name == "nt":
        cp = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess)"],
            capture_output=True, text=True
        )
        return [int(x) for x in cp.stdout.split() if x.isdigit()]
    cp = subprocess.run(["sh", "-lc", "lsof -tiTCP:8765 -sTCP:LISTEN 2>/dev/null"], capture_output=True, text=True)
    return [int(x) for x in cp.stdout.split() if x.isdigit()]

def stop_stale_engine() -> None:
    for pid in port_pids():
        cmd = process_command(pid)
        if "omni_local_server.py" not in cmd:
            raise RuntimeError(f"Port 8765 is already owned by another process (PID {pid}). Close it before launching OmniConverter.")
        print(f"[SETUP] Stopping stale Omni Local Engine process {pid}...", flush=True)
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False)
            else:
                os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
    time.sleep(1)

def main() -> int:
    print("=== OmniConverter Local Bootstrap ===")
    print(f"Platform: {platform.platform()}")

    if not verify():
        print("[SETUP] Launch runtime is not ready. Running the complete installer...")
        try:
            run_setup()
        except Exception as exc:
            print(f"[ERROR] Installer failed: {exc}", flush=True)
            return 1
        if not verify():
            print("[ERROR] Core Local Engine still cannot start after setup.")
            return 1

    existing = health()
    if existing:
        version = int(existing.get("engine_api_version") or 0)
        if version >= REQUIRED_ENGINE_API:
            print("[OK] A current Omni Local Engine is already running.")
            webbrowser.open("http://127.0.0.1:8765/")
            return 0
        print(f"[SETUP] Outdated Omni Local Engine detected (API {version}); replacing it.")
        stop_stale_engine()

    elif port_pids():
        stop_stale_engine()

    p = pyexe()
    print("[OK] Starting current Local Engine...")
    try:
        return subprocess.call([str(p), "-u", str(ROOT / "omni_local_server.py")], cwd=ROOT)
    except OSError as exc:
        print(f"[ERROR] Could not launch Python engine: {exc}", flush=True)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
