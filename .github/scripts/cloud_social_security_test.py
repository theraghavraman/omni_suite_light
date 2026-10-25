#!/usr/bin/env python3
"""Exercise cloud and social processing routes that must remain fail-closed."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[2]


def load_cloud_app():
    cloud_dir = ROOT / "omni-cloud-engine"
    sys.path.insert(0, str(cloud_dir))
    spec = importlib.util.spec_from_file_location("omni_cloud_test_app", cloud_dir / "app.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load Cloud Engine app")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cloud_checks() -> None:
    app = load_cloud_app()
    client = app.app.test_client()

    response = client.get("/api/health")
    assert response.status_code == 200, response.status_code
    assert "token" not in response.get_json()

    response = client.get("/api/capabilities")
    assert response.status_code == 200, response.status_code
    assert response.get_json()["operations"] == []

    requests = (
        ("POST", "/api/process", {}),
        ("GET", "/api/jobs/test", None),
        ("POST", "/api/ai/generate", {"question": "q", "context": "c"}),
    )
    for method, path, payload in requests:
        response = client.open(path, method=method, json=payload)
        assert response.status_code == 503, (path, response.status_code)


def get_status(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def post_json_status(url: str, payload: dict) -> int:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def social_checks() -> None:
    social_dir = ROOT / "social-resolver"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

    env = os.environ.copy()
    env["PYTHONPATH"] = str(social_dir)
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=social_dir,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 20
        while True:
            if server.poll() is not None:
                raise RuntimeError(f"Social Resolver exited with code {server.returncode}")
            try:
                if get_status(base + "/api/health") == 200:
                    break
            except (OSError, urllib.error.URLError):
                pass  # The process can be alive briefly before Uvicorn binds the socket.
            if time.monotonic() >= deadline:
                raise TimeoutError("Social Resolver health endpoint did not start")
            time.sleep(0.2)

        assert post_json_status(
            base + "/api/resolve",
            {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        ) == 503
        assert get_status(base + "/api/media-proxy?url=https%3A%2F%2Fcdninstagram.com%2Fx") == 503
        assert get_status(base + "/api/download?url=https%3A%2F%2Finstagram.com%2Fx") == 503
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)


if __name__ == "__main__":
    cloud_checks()
    social_checks()
    print("Cloud Engine and Social Resolver fail-closed runtime checks passed.")
