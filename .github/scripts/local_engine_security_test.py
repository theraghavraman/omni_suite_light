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
              token: str | None = None, body: bytes | None = None,
              extra_headers: dict | None = None):
    headers = {}
    if origin is not None:
        headers["Origin"] = origin
    if token is not None:
        headers["X-Omni-Token"] = token
    if body is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
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
        # The detailed API health route runs native-tool diagnostics that can
        # take much longer on Windows CI, where many native tools are present.
        # Keep the fast token-free probe cross-platform; exercise API health elsewhere.
        if os.name != "nt":
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

        # --- Forgeable same-origin headers must not bypass the token ---------
        # Any local non-browser client can set Origin: http://127.0.0.1:<port>
        # (or no Origin plus Sec-Fetch-Site: same-origin). Those headers used to
        # grant full access; a privileged call that lacks the per-launch token
        # must now be refused regardless.
        forged = b'{"op":"health"}'
        status, _, _ = http_call(base, "/api/process", "POST", origin=local_origin, body=forged)
        assert status == 401, f"forged same-origin POST without token returned {status}"

        status, _, _ = http_call(
            base, "/api/process", "POST", body=forged,
            extra_headers={"Sec-Fetch-Site": "same-origin"},
        )
        assert status == 401, f"forged Sec-Fetch-Site POST without token returned {status}"

        for path in ("/api/upload", "/api/transfer/status", "/api/etl/hop/run"):
            status, _, _ = http_call(base, path, "POST", origin=local_origin, body=b"{}")
            assert status == 401, f"forged same-origin {path} without token returned {status}"

        # The genuine UI path — local origin plus the per-launch token — still
        # reaches the operation end to end.
        status, raw, _ = http_call(
            base, "/api/process", "POST", origin=local_origin, token=token, body=forged
        )
        assert status == 200, f"authorised same-origin POST returned {status}"
        assert json.loads(raw).get("ok"), "authorised health op did not report ok"

        # Remote origins stay refused with 403 even when a valid token is sent:
        # the loopback-only trust boundary is not weakened.
        status, _, _ = http_call(
            base, "/api/process", "POST", origin="https://attacker.example",
            token=token, body=forged,
        )
        assert status == 403, f"remote-origin POST with valid token returned {status}"

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
