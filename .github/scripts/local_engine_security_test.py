#!/usr/bin/env python3
"""Exercise Local Engine HTTP security boundaries with a temporary server."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib import error, request


ROOT = Path(__file__).resolve().parents[2]


def http_call(base: str, path: str, method: str = "GET", *, origin: str | None = None,
              token: str | None = None, body: bytes | None = None):
    headers = {}
    if origin is not None:
        headers["Origin"] = origin
    if token is not None:
        headers["X-Omni-Token"] = token
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = request.Request(base + path, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=15) as response:
            return response.status, response.read(), dict(response.headers)
    except error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


def main() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    token = "omni-ci-security-token"
    base = f"http://127.0.0.1:{port}"
    env = os.environ.copy()
    env.update({
        "OMNI_HOST": "127.0.0.1",
        "OMNI_PORT": str(port),
        "OMNI_TOKEN": token,
        "OMNI_UI_ROOT": str(ROOT),
    })
    server = subprocess.Popen(
        [sys.executable, str(ROOT / "omni_local_server.py")],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        ready = False
        for _ in range(60):
            if server.poll() is not None:
                raise RuntimeError("Local Engine exited during startup: " + (server.stdout.read() or ""))
            try:
                status, _, _ = http_call(base, "/healthz")
                if status == 200:
                    ready = True
                    break
            except OSError:
                time.sleep(0.2)
        assert ready, "Local Engine health endpoint did not become ready"

        status, raw, _ = http_call(base, "/healthz")
        healthz = json.loads(raw)
        assert status == 200 and healthz.get("ok") and "token" not in healthz

        local_origin = base
        status, raw, _ = http_call(base, "/api/health", origin=local_origin)
        health = json.loads(raw)
        assert status == 200 and health.get("ok")
        assert "token" not in health and token not in raw.decode("utf-8", "replace")

        status, _, _ = http_call(base, "/api/health", origin="https://attacker.example")
        assert status == 403, f"remote-origin health request returned {status}"
        status, _, _ = http_call(base, "/api/health")
        assert status == 403, f"originless health request returned {status}"

        status, _, _ = http_call(base, "/omni_local_server.py")
        assert status == 404, f"Python source was served with status {status}"
        status, _, _ = http_call(base, "/%2e%2e/pyproject.toml")
        assert status in (403, 404), f"path traversal request returned {status}"

        for operation in ("code_execute", "archive_extract"):
            payload = json.dumps({"op": operation}).encode("utf-8")
            status, _, _ = http_call(
                base, "/api/process", "POST", token=token, body=payload
            )
            assert status == 503, f"{operation} should be disabled, got {status}"

        status, _, headers = http_call(
            base, "/api/process", "OPTIONS", origin="https://attacker.example"
        )
        assert status == 204 and "Access-Control-Allow-Origin" not in headers

        status, _, _ = http_call(
            base, "/api/process", "POST", token="invalid", body=b'{"op":"health"}'
        )
        assert status == 401, f"invalid local-engine token returned {status}"
        print("Local Engine security integration checks passed.")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
