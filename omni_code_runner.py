#!/usr/bin/env python3
"""Local, user-invoked programming-language runner for OmniConverter.

This is intentionally local-only and never exposes a shell command directly.
It uses an allow-list of language launchers, a temporary working directory,
a short timeout, and a sanitized environment. It is an execution convenience,
not a security sandbox: only run code you trust.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


LANGUAGE_ALIASES = {
    "python": "python",
    "javascript": "javascript",
    "typescript": "typescript",
    "bash": "bash",
    "ruby": "ruby",
    "php": "php",
    "c": "c",
    "cpp": "cpp",
    "c++": "cpp",
    "java": "java",
    "go": "go",
    "rust": "rust",
    "swift": "swift",
    "kotlin": "kotlin",
}


def _which(*names: str) -> str | None:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def available_languages() -> dict[str, dict]:
    checks = {
        "python": _which(sys.executable) or sys.executable,
        "javascript": _which("node", "nodejs"),
        "typescript": _which("node", "nodejs"),
        "bash": _which("bash"),
        "ruby": _which("ruby"),
        "php": _which("php"),
        "c": _which("gcc", "clang"),
        "cpp": _which("g++", "clang++"),
        "java": _which("javac"),
        "go": _which("go"),
        "rust": _which("rustc"),
        "swift": _which("swiftc"),
        "kotlin": _which("kotlinc"),
    }
    return {k: {"available": bool(v), "path": v} for k, v in checks.items()}


def _env(workdir: Path) -> dict[str, str]:
    env = dict(os.environ)
    env["HOME"] = str(workdir)
    env["TMPDIR"] = str(workdir)
    env["TEMP"] = str(workdir)
    env["TMP"] = str(workdir)
    # Avoid inheriting proxy configuration into user programs by default.
    for key in list(env):
        if key.upper().endswith("_PROXY") or key.upper() == "NO_PROXY":
            env.pop(key, None)
    return env


def execute(language: str, source: str, stdin: str = "", timeout: int = 8) -> dict:
    lang = LANGUAGE_ALIASES.get(str(language or "").strip().lower())
    if not lang:
        raise ValueError("Unsupported local language")

    source = str(source or "")
    if not source.strip():
        raise ValueError("Source code is empty")

    timeout = max(1, min(int(timeout or 8), 20))
    work = Path(tempfile.mkdtemp(prefix="omni_code_"))
    env = _env(work)
    command: list[str]
    source_file: Path

    try:
        if lang == "python":
            source_file = work / "main.py"
            command = [sys.executable, str(source_file)]
        elif lang == "javascript":
            node = _which("node", "nodejs")
            if not node:
                raise RuntimeError("Node.js is not installed on this machine.")
            source_file = work / "main.js"
            command = [node, str(source_file)]
        elif lang == "typescript":
            node = _which("node", "nodejs")
            if not node:
                raise RuntimeError("Node.js is not installed on this machine.")
            tsc = _which("tsc")
            source_file = work / "main.ts"
            if tsc:
                js_file = work / "main.js"
                source_file.write_text(source, encoding="utf-8")
                cp = subprocess.run(
                    [tsc, "--target", "ES2022", "--module", "commonjs",
                     "--skipLibCheck", "--outDir", str(work / "out"), str(source_file)],
                    cwd=work, env=env, capture_output=True, text=True, timeout=timeout,
                )
                if cp.returncode:
                    return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
                command = [node, str(work / "out" / "main.js")]
            else:
                raise RuntimeError("TypeScript compiler (tsc) is not installed. Use the browser TypeScript runner instead.")
        elif lang == "bash":
            source_file = work / "main.sh"
            command = [_which("bash") or "bash", str(source_file)]
        elif lang == "ruby":
            source_file = work / "main.rb"
            command = [_which("ruby") or "ruby", str(source_file)]
        elif lang == "php":
            source_file = work / "main.php"
            command = [_which("php") or "php", str(source_file)]
        elif lang == "c":
            compiler = _which("gcc", "clang")
            if not compiler:
                raise RuntimeError("No C compiler (gcc/clang) is installed.")
            source_file = work / "main.c"
            binary = work / ("main.exe" if os.name == "nt" else "main")
            command = [compiler, str(source_file), "-O0", "-o", str(binary)]
            source_file.write_text(source, encoding="utf-8")
            cp = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            if cp.returncode:
                return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
            command = [str(binary)]
        elif lang == "cpp":
            compiler = _which("g++", "clang++")
            if not compiler:
                raise RuntimeError("No C++ compiler (g++/clang++) is installed.")
            source_file = work / "main.cpp"
            binary = work / ("main.exe" if os.name == "nt" else "main")
            command = [compiler, "-std=c++17", str(source_file), "-O0", "-o", str(binary)]
            source_file.write_text(source, encoding="utf-8")
            cp = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            if cp.returncode:
                return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
            command = [str(binary)]
        elif lang == "java":
            javac = _which("javac")
            java = _which("java")
            if not javac or not java:
                raise RuntimeError("JDK (javac/java) is not installed.")
            source_file = work / "Main.java"
            command = [javac, str(source_file)]
            source_file.write_text(source, encoding="utf-8")
            cp = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            if cp.returncode:
                return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
            command = [java, "-cp", str(work), "Main"]
        elif lang == "go":
            go = _which("go")
            if not go:
                raise RuntimeError("Go is not installed.")
            source_file = work / "main.go"
            command = [go, "run", str(source_file)]
        elif lang == "rust":
            rustc = _which("rustc")
            if not rustc:
                raise RuntimeError("Rust compiler (rustc) is not installed.")
            source_file = work / "main.rs"
            binary = work / ("main.exe" if os.name == "nt" else "main")
            command = [rustc, str(source_file), "-O", "-o", str(binary)]
            source_file.write_text(source, encoding="utf-8")
            cp = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            if cp.returncode:
                return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
            command = [str(binary)]
        elif lang == "swift":
            swiftc = _which("swiftc")
            if not swiftc:
                raise RuntimeError("Swift compiler (swiftc) is not installed.")
            source_file = work / "main.swift"
            binary = work / ("main.exe" if os.name == "nt" else "main")
            command = [swiftc, str(source_file), "-o", str(binary)]
            source_file.write_text(source, encoding="utf-8")
            cp = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            if cp.returncode:
                return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
            command = [str(binary)]
        elif lang == "kotlin":
            kotlinc = _which("kotlinc")
            if not kotlinc:
                raise RuntimeError("Kotlin compiler (kotlinc) is not installed.")
            source_file = work / "Main.kt"
            jar = work / "main.jar"
            command = [kotlinc, str(source_file), "-include-runtime", "-d", str(jar)]
            source_file.write_text(source, encoding="utf-8")
            cp = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
            if cp.returncode:
                return {"ok": False, "stdout": cp.stdout, "stderr": cp.stderr, "exit_code": cp.returncode, "language": lang}
            java = _which("java")
            if not java:
                raise RuntimeError("Java runtime is required to run Kotlin output.")
            command = [java, "-jar", str(jar)]
        else:
            raise RuntimeError("Language is not implemented")

        if lang not in {"typescript", "c", "cpp", "java", "rust", "swift", "kotlin"}:
            source_file.write_text(source, encoding="utf-8")

        cp = subprocess.run(
            command, cwd=work, env=env, input=stdin, capture_output=True,
            text=True, timeout=timeout,
        )
        return {
            "ok": cp.returncode == 0,
            "stdout": cp.stdout,
            "stderr": cp.stderr,
            "exit_code": cp.returncode,
            "language": lang,
            "command": command[0],
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "stdout": exc.stdout or "",
            "stderr": (exc.stderr or "") + f"\nExecution timed out after {timeout}s.",
            "exit_code": 124,
            "language": lang,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
