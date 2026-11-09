#!/usr/bin/env python3
"""Clean-environment smoke test for an installed OmniConverter Studio desktop app.

The installer ships only the base app (Electron shell, Local Engine code, UI, offline browser
assets); optional components are downloaded by the app's Component Manager. Two modes run
against the *same* installation, each with a fresh user-data folder:

base   No components. The app must open in browser-only mode with all 41 offline assets
       verified, and report every native tool and the Local Engine as "not installed"
       (never as ready).
full   The app installs every component through its own Component Manager (download,
       SHA-256 verification against the catalog built into the app, extraction into the
       user-data folder) from --components-dir, served on a local HTTP server. It must then
       spawn the component Python engine, pass /healthz and /api/health, load the
       engine-served UI with OMNI_TOKEN, serve vendor assets, and its verifier must import
       every required Python package and execute every required tool from the installed
       components. Every installed component is audited for build-machine references, and
       every tool performs a real conversion (Ghostscript, Poppler, qpdf, Tesseract,
       ImageMagick, rsvg-convert, FFmpeg/FFprobe, Pandoc, 7-Zip, LibreOffice, Calibre, yt-dlp).

The app is launched with a scrubbed environment (fresh HOME/APPDATA, PATH = OS system
directories, no PYTHON* variables). On macOS, --hide PATH (repeatable) denies read access to
those paths (e.g. a Homebrew prefix) via sandbox-exec for the installed component verifier and
every functional conversion. The Electron app itself cannot run under sandbox-exec (Chromium
refuses nested sandboxes); in CI the Homebrew prefix is physically moved away instead.

Examples:
  python scripts/smoke_test_desktop.py --installer 'out/make/*.dmg' --hide /opt/homebrew
  python scripts/smoke_test_desktop.py --installer 'out/make/squirrel.windows/x64/*Setup.exe'
  python scripts/smoke_test_desktop.py --app /usr/lib/omni-converter-studio      # after apt/dnf install
"""
from __future__ import annotations

import argparse
import functools
import glob
import http.server
import threading
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(HERE))

import omni_environment  # noqa: E402
import stage_desktop_bundle as stager  # noqa: E402

EXECUTABLE = "omni-converter-studio"
APP_NAME = "OmniConverter Studio"

PS_DOCUMENT = """%!PS
/Helvetica-Bold findfont 64 scalefont setfont
72 600 moveto (OMNI SMOKE 42) show
showpage
"""
SVG_DOCUMENT = """<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">
<rect width="120" height="80" fill="#f60"/><circle cx="60" cy="40" r="25" fill="#036"/></svg>
"""


def log(msg: str) -> None:
    print(f"[smoke] {msg}", flush=True)


# --------------------------------------------------------------------------------------
# Locating / installing
# --------------------------------------------------------------------------------------

def install_from_dmg(dmg: Path, workdir: Path) -> Path:
    mount = workdir / "dmg-mount"
    mount.mkdir()
    subprocess.run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", str(mount), str(dmg)], check=True, capture_output=True)
    try:
        apps = list(mount.glob("*.app"))
        if len(apps) != 1:
            raise SystemExit(f"Expected one .app in {dmg}, found {apps}")
        target_dir = workdir / "Applications"
        target_dir.mkdir()
        target = target_dir / apps[0].name
        subprocess.run(["ditto", str(apps[0]), str(target)], check=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mount), "-force"], capture_output=True)
    log(f"installed {dmg.name} -> {target}")
    return target


def install_from_squirrel(setup: Path) -> Path:
    local = Path(os.environ["LOCALAPPDATA"])
    install_root = local / "OmniConverterStudio"
    log(f"running {setup.name} --silent")
    proc = subprocess.run([str(setup), "--silent"], timeout=3600)
    if proc.returncode != 0:
        raise SystemExit(f"Squirrel setup exited with {proc.returncode}")
    exe = None
    for _ in range(180):  # Squirrel keeps unpacking after the stub exits
        candidates = sorted(install_root.glob(f"app-*/{EXECUTABLE}.exe"))
        if candidates and (candidates[-1].parent / "resources" / "BUNDLE_MANIFEST.json").is_file():
            exe = candidates[-1]
            break
        time.sleep(5)
    if exe is None:
        raise SystemExit(f"Squirrel did not produce {install_root}\\app-*\\{EXECUTABLE}.exe")
    time.sleep(20)
    # Squirrel launches the app after installing; stop it so the smoke run owns the instance.
    subprocess.run(["taskkill", "/IM", f"{EXECUTABLE}.exe", "/F", "/T"], capture_output=True)
    time.sleep(5)
    log(f"installed -> {exe.parent}")
    return exe.parent


def resolve_app(app: Path) -> tuple[Path, Path, Path]:
    """Return (app_root, executable, resources_dir)."""
    app = app.resolve()
    if sys.platform == "darwin":
        if app.suffix != ".app":
            found = list(app.glob("*.app"))
            app = found[0] if found else app
        return app, app / "Contents" / "MacOS" / EXECUTABLE, app / "Contents" / "Resources"
    exe = app / (f"{EXECUTABLE}.exe" if os.name == "nt" else EXECUTABLE)
    return app, exe, app / "resources"


def default_components_dir() -> Path:
    return REPO_ROOT / "out" / "components" / omni_environment.platform_key()


def serve_directory(directory: Path):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *a, **k: None  # type: ignore[attr-defined]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    log(f"serving component archives from {directory} at {url}")
    return server, url


def default_packaged_app() -> Path:
    key = omni_environment.platform_key()
    plat, arch = key.split("-")
    folder = REPO_ROOT / "out" / f"{APP_NAME}-{plat}-{arch}"
    return folder / f"{APP_NAME}.app" if plat == "darwin" else folder


# --------------------------------------------------------------------------------------
# Environment
# --------------------------------------------------------------------------------------

def scrubbed_env(home: Path) -> dict:
    """What a fresh user session would provide: no package-manager PATH, no Python vars."""
    keep = {"DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "LANG", "LC_ALL", "TERM",
            "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "PATHEXT", "SystemDrive",
            "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "USERNAME", "USER", "LOGNAME"}
    env = {k: v for k, v in os.environ.items() if k in keep}
    home.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        root = env.get("SystemRoot", r"C:\Windows")
        env["PATH"] = os.pathsep.join([rf"{root}\System32", root, rf"{root}\System32\Wbem"])
        for key, sub in (("USERPROFILE", ""), ("APPDATA", "AppData/Roaming"), ("LOCALAPPDATA", "AppData/Local"), ("TEMP", "Temp"), ("TMP", "Temp")):
            path = home / sub if sub else home
            path.mkdir(parents=True, exist_ok=True)
            env[key] = str(path)
    else:
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        env["HOME"] = str(home)
        env["TMPDIR"] = str(home / "tmp")
        (home / "tmp").mkdir(exist_ok=True)
        env.setdefault("LANG", "en_US.UTF-8")
        if sys.platform.startswith("linux"):
            env["XDG_CONFIG_HOME"] = str(home / ".config")
            env["XDG_CACHE_HOME"] = str(home / ".cache")
    return env


def sandbox_prefix(hidden: list[str]) -> list[str]:
    if not hidden or sys.platform != "darwin":
        return []
    rules = " ".join(f'(subpath "{os.path.realpath(p)}")' for p in hidden if os.path.exists(p))
    if not rules:
        return []
    profile = f"(version 1)(allow default)(deny file-read* {rules})"
    return ["sandbox-exec", "-p", profile]


# --------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------

def inside(path: str | None, root: Path) -> bool:
    if not path:
        return False
    try:
        resolved = Path(path).resolve()
    except OSError:
        return False
    root = root.resolve()
    return resolved == root or root in resolved.parents


def launch_app(exe: Path, resources: Path, env: dict, report_path: Path, sandbox: list[str], extra_args: list[str], timeout: int, extra_env: dict | None = None) -> dict:
    run_env = dict(env)
    run_env.update(extra_env or {})
    run_env["OMNI_DESKTOP_SMOKE_REPORT"] = str(report_path)
    run_env["ELECTRON_ENABLE_LOGGING"] = "1"
    cmd = [*sandbox, str(exe), *extra_args]
    log(f"launching {' '.join(cmd[-1 - len(extra_args):])}")
    started = time.time()
    try:
        proc = subprocess.run(cmd, env=run_env, timeout=timeout, capture_output=True, text=True, errors="replace")
        exit_code, output = proc.returncode, (proc.stdout + proc.stderr)
    except subprocess.TimeoutExpired as exc:
        def _text(value):
            return value.decode("utf-8", "replace") if isinstance(value, bytes) else (value or "")
        exit_code, output = "timeout", _text(exc.stdout) + _text(exc.stderr)
    elapsed = round(time.time() - started, 1)
    report = {}
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    return {"exit_code": exit_code, "seconds": elapsed, "report": report, "output_tail": str(output)[-6000:]}


def evaluate_base(launch: dict) -> list[str]:
    report = launch["report"]
    if not report:
        return [f"app produced no smoke report (exit {launch['exit_code']}): {launch['output_tail'][-1500:]}"]
    if report.get("error"):
        return [f"app smoke mode crashed: {report['error'][:1500]}"]
    failures: list[str] = []
    readiness = report.get("readiness") or {}
    startup = report.get("startup") or {}
    if not startup.get("browserOnly"):
        failures.append(f"base install did not open in browser-only mode: {startup}")
    if (readiness.get("engine") or {}).get("installed") is not False:
        failures.append("base install claims a Local Engine is installed")
    offline = readiness.get("offlineAssets") or {}
    if not offline.get("ready") or offline.get("verifiedCount") != offline.get("totalCount"):
        failures.append(f"offline assets not verified: {offline.get('verifiedCount')}/{offline.get('totalCount')} missing={offline.get('missing')}")
    for tool in readiness.get("tools") or []:
        if tool.get("available") or tool.get("reason") != "Component not installed":
            failures.append(f"base install reports {tool.get('label')} as {tool.get('available')}/{tool.get('reason')}")
    renderer = report.get("renderer") or {}
    if not renderer.get("desktopBridge") or not renderer.get("hasUi"):
        failures.append(f"studio UI not rendered: {renderer}")
    if not report.get("ok") and not failures:
        failures.append("app reported ok=false")
    return failures


def evaluate_launch(launch: dict, resources: Path) -> list[str]:
    failures: list[str] = []
    report = launch["report"]
    if not report:
        return [f"app produced no smoke report (exit {launch['exit_code']}): {launch['output_tail'][-1500:]}"]
    if report.get("error"):
        failures.append(f"app smoke mode crashed: {report['error'][:1500]}")
    for comp_id, result in ((report.get("startup") or {}).get("componentInstall") or {}).items():
        if not result.get("ok"):
            failures.append(f"component {comp_id} did not install: {result.get('error')}")
    readiness = report.get("readiness") or {}
    engine = readiness.get("engine") or {}
    if not engine.get("online"):
        failures.append(f"local engine not healthy: {engine.get('error')}\n{report.get('engineLogTail', '')[-2000:]}")
    if not inside(engine.get("pythonExecutable"), resources):
        failures.append(f"engine python is not the installed component runtime: {engine.get('pythonExecutable')}")
    if (report.get("startup") or {}).get("usedFallbackUi"):
        failures.append("app fell back to the static UI")
    renderer = report.get("renderer") or {}
    if renderer.get("tokenType") != "string" or not str(renderer.get("href", "")).startswith("http://127.0.0.1:"):
        failures.append(f"engine UI not loaded with OMNI_TOKEN: {renderer}")
    vendor = report.get("vendorFetch") or {}
    if vendor.get("statusCode") != 200:
        failures.append(f"vendor asset not served by engine: {vendor}")
    offline = readiness.get("offlineAssets") or {}
    if not offline.get("ready") or offline.get("verifiedCount") != offline.get("totalCount"):
        failures.append(f"offline assets not verified: {offline.get('verifiedCount')}/{offline.get('totalCount')} missing={offline.get('missing')}")
    for tool in readiness.get("tools") or []:
        if tool.get("required") and not tool.get("available"):
            failures.append(f"required tool not ready: {tool.get('label')} ({tool.get('reason')}, {tool.get('path')})")
        elif tool.get("required") and not inside(tool.get("path"), resources):
            failures.append(f"required tool resolved outside the bundle: {tool.get('label')} -> {tool.get('path')}")
    verifier = (report.get("verifier") or {}).get("report") or {}
    if verifier.get("result") != "PASS":
        missing = verifier.get("missing") or {}
        detail = {k: v for k, v in missing.items() if v and not k.endswith("optional")}
        py_errors = {k: (verifier.get("python") or {}).get(k, {}).get("error") for k in missing.get("python", [])}
        failures.append(f"bundled verifier failed: {detail} {py_errors} pip_check={verifier.get('pip_check')}")
    if verifier and not inside(verifier.get("python_executable"), resources):
        failures.append(f"verifier ran outside the bundle: {verifier.get('python_executable')}")
    for label, info in (verifier.get("native") or {}).items():
        if info.get("ok") and label not in omni_environment.OPTIONAL_NATIVE_GROUPS and not inside(info.get("path"), resources):
            failures.append(f"verifier tool {label} resolved outside the bundle: {info.get('path')}")
    if not report.get("ok") and not failures:
        failures.append("app reported ok=false")
    return failures


def sandboxed_verifier(resources: Path, components_root: Path, base_env: dict, sandbox: list[str]) -> dict:
    """Run the installed component Python + verifier with host paths unreadable."""
    manifest = omni_environment.load_tools_manifest(components_root)
    env = omni_environment.bundled_tool_environment(components_root, manifest, base_env, sanitize_path=True)
    libs = json.loads((components_root / "python-libraries" / "component.json").read_text(encoding="utf-8"))
    env["PYTHONPATH"] = os.pathsep.join(str(components_root / "python-libraries" / rel) for rel in libs.get("python_path", []))
    py_manifest = json.loads((components_root / "python-runtime" / "component.json").read_text(encoding="utf-8"))
    python = components_root / "python-runtime" / py_manifest["python"]
    engine = resources / "omni-engine"
    proc = subprocess.run([*sandbox, str(python), "-s", str(engine / "verify_local_environment.py"), "--json"], cwd=str(engine),
                          env=env, capture_output=True, text=True, errors="replace", timeout=900)
    try:
        report = json.loads(proc.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        return {"result": "FAIL", "error": (proc.stdout + proc.stderr)[-2000:]}
    log(f"sandboxed verifier: {report.get('result')} {report.get('summary')}")
    return report


def functional_checks(root: Path, base_env: dict, sandbox: list[str], workdir: Path) -> dict:
    manifest = omni_environment.load_tools_manifest(root)
    env = omni_environment.bundled_tool_environment(root, manifest, base_env, sanitize_path=True)
    env["CALIBRE_CONFIG_DIRECTORY"] = str(workdir / "calibre-config")
    tools = manifest["tools"]

    def exe(*names: str) -> str:
        for name in names:
            if name in tools:
                return str(root / tools[name]["path"])
        raise KeyError(names)

    results: dict[str, dict] = {}

    def check(name: str, cmd: list[str], expect=None, timeout: int = 300) -> None:
        started = time.time()
        try:
            proc = subprocess.run([*sandbox, *cmd], env=env, cwd=str(workdir), capture_output=True, text=True,
                                  errors="replace", timeout=timeout, stdin=subprocess.DEVNULL)
            ok = proc.returncode == 0
            detail = (proc.stdout + proc.stderr).strip()[-1500:]
            if ok and expect is not None:
                ok, extra = expect()
                detail = extra if not ok else detail[-300:]
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        results[name] = {"ok": ok, "seconds": round(time.time() - started, 1), "detail": detail}
        log(f"{'PASS' if ok else 'FAIL'} {name} ({results[name]['seconds']}s)")

    def file_has(path: Path, needle: str | None = None, min_size: int = 1):
        def _check():
            if not path.is_file() or path.stat().st_size < min_size:
                return False, f"{path.name} not produced"
            if needle and needle.lower() not in path.read_text(encoding="utf-8", errors="replace").lower():
                return False, f"{path.name} does not contain {needle!r}: {path.read_text(encoding='utf-8', errors='replace')[:300]!r}"
            return True, ""
        return _check

    (workdir / "doc.ps").write_text(PS_DOCUMENT, encoding="ascii")
    (workdir / "shape.svg").write_text(SVG_DOCUMENT, encoding="ascii")
    (workdir / "note.md").write_text("# Omni Smoke\n\nBundled *pandoc* works.\n", encoding="utf-8")
    (workdir / "note.txt").write_text("OMNI SMOKE 42\n\nBundled office and ebook conversion.\n", encoding="utf-8")
    gs = exe("gs", "gswin64c")

    check("ghostscript ps->pdf", [gs, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", "-o", "doc.pdf", "doc.ps"], file_has(workdir / "doc.pdf", min_size=500))
    check("ghostscript ps->png", [gs, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m", "-r200", "-o", "doc.png", "doc.ps"], file_has(workdir / "doc.png", min_size=500))
    check("pdftotext", [exe("pdftotext"), "doc.pdf", "doc.txt"], file_has(workdir / "doc.txt", "OMNI SMOKE"))
    check("pdftoppm", [exe("pdftoppm"), "-r", "72", "-png", "doc.pdf", "page"], lambda: (bool(list(workdir.glob("page*.png"))), "no page png"))
    check("qpdf --check", [exe("qpdf"), "--check", "doc.pdf"])
    check("tesseract ocr (eng)", [exe("tesseract"), "doc.png", "ocr", "-l", "eng"], file_has(workdir / "ocr.txt", "SMOKE"))
    check("tesseract languages", [exe("tesseract"), "--list-langs"], lambda: (True, ""))
    check("imagemagick png->jpg", [exe("magick", "convert"), "doc.png", "doc.jpg"], file_has(workdir / "doc.jpg", min_size=500))
    check("rsvg-convert svg->png", [exe("rsvg-convert"), "-o", "shape.png", "shape.svg"], file_has(workdir / "shape.png", min_size=100))
    check("ffmpeg sine->wav", [exe("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "tone.wav"], file_has(workdir / "tone.wav", min_size=1000))
    check("ffprobe wav", [exe("ffprobe"), "-hide_banner", "-loglevel", "error", "-show_entries", "stream=codec_name", "tone.wav"])
    check("pandoc md->html", [exe("pandoc"), "-s", "--metadata", "title=Omni", "note.md", "-o", "note.html"], file_has(workdir / "note.html", "Bundled"))
    check("7-zip archive", [exe("7zz", "7z"), "a", "-y", "bundle.7z", "note.txt"], file_has(workdir / "bundle.7z", min_size=50))
    check("7-zip test", [exe("7zz", "7z"), "t", "bundle.7z"])
    lo_profile = (workdir / "lo-profile").resolve().as_uri()
    check("libreoffice txt->pdf", [exe("soffice"), "--headless", "--norestore", f"-env:UserInstallation={lo_profile}", "--convert-to", "pdf", "--outdir", str(workdir / "lo-out"), "note.txt"], file_has(workdir / "lo-out" / "note.pdf", min_size=500), timeout=600)
    check("calibre txt->epub", [exe("ebook-convert"), "note.txt", "note.epub"], file_has(workdir / "note.epub", min_size=500), timeout=600)
    check("yt-dlp --version", [exe("yt-dlp"), "--version"])
    return results


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--app", type=Path, help="Packaged app (.app, or folder with the executable) or installed location")
    parser.add_argument("--installer", type=Path, help="Installer to install first (.dmg or Squirrel Setup.exe; glob allowed)")
    parser.add_argument("--report", type=Path, default=REPO_ROOT / "out" / "smoke" / f"smoke-{omni_environment.platform_key()}.json")
    parser.add_argument("--hide", action="append", default=[], help="macOS: deny read access to this path while running (repeatable)")
    parser.add_argument("--electron-arg", action="append", default=[], help="Extra argument for the Electron executable")
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--skip-functional", action="store_true")
    parser.add_argument("--mode", choices=["base", "full", "both"], default="both")
    parser.add_argument("--components-dir", type=Path, help="Folder with the built component archives + catalog.json (default out/components/<platform>)")
    args = parser.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix="omni-smoke-"))
    summary: dict = {"platform": omni_environment.platform_key(), "workdir": str(workdir), "failures": []}
    try:
        if args.installer:
            matches = sorted(glob.glob(str(args.installer)))
            if not matches:
                raise SystemExit(f"Installer not found: {args.installer}")
            installer = Path(matches[0]).resolve()
            summary["installer"] = str(installer)
            if installer.suffix == ".dmg":
                app_path = install_from_dmg(installer, workdir)
            elif installer.suffix.lower() == ".exe":
                app_path = install_from_squirrel(installer)
            else:
                raise SystemExit("Use --app after installing .deb/.rpm packages with the system package manager")
        else:
            app_path = args.app or default_packaged_app()
        app_root, exe, resources = resolve_app(app_path)
        summary.update({"app": str(app_root), "executable": str(exe), "resources": str(resources)})
        if not exe.is_file():
            raise SystemExit(f"Executable not found: {exe}")

        bundle_manifest = json.loads((resources / "BUNDLE_MANIFEST.json").read_text(encoding="utf-8"))
        summary["bundle_complete_at_build"] = bundle_manifest.get("complete")
        markers = list(bundle_manifest.get("build_host_paths") or []) + [str(REPO_ROOT)]
        catalog = json.loads((resources / "components-catalog.json").read_text(encoding="utf-8"))
        summary["catalog_components"] = [c["id"] for c in catalog.get("components", [])]
        sandbox = sandbox_prefix(args.hide)
        summary["hidden_paths"] = args.hide if sandbox else []
        modes = ["base", "full"] if args.mode == "both" else [args.mode]

        for mode in modes:
            log(f"=== mode: {mode} ===")
            mode_dir = workdir / mode
            user_data = mode_dir / "userdata"
            env = scrubbed_env(mode_dir / "home")
            extra_env = {"OMNI_USER_DATA_DIR": str(user_data), "OMNI_SMOKE_INSTALL": "none" if mode == "base" else "all",
                         "OMNI_SMOKE_SCREENSHOT_DIR": str(args.report.parent / "screenshots" / omni_environment.platform_key())}
            server = None
            if mode == "full":
                comp_dir = (args.components_dir or default_components_dir()).resolve()
                if not (comp_dir / "catalog.json").is_file():
                    raise SystemExit(f"No component archives at {comp_dir} (catalog.json missing)")
                built = json.loads((comp_dir / "catalog.json").read_text(encoding="utf-8"))
                if {c["sha256"] for c in built["components"]} != {c["sha256"] for c in catalog["components"]}:
                    summary["failures"].append("component archives do not match the catalog built into this installer")
                server, base_url = serve_directory(comp_dir)
                extra_env["OMNI_COMPONENTS_BASE_URL"] = base_url
            try:
                launch = launch_app(exe, resources, env, mode_dir / "app-report.json", [], args.electron_arg, args.timeout, extra_env)
            finally:
                if server:
                    server.shutdown()
            summary[mode] = {"launch": {k: v for k, v in launch.items() if k != "report"}, "app_report": launch["report"]}
            if mode == "base":
                summary["failures"] += [f"base: {f}" for f in evaluate_base(launch)]
                continue
            components_root = user_data / "components"
            summary["failures"] += [f"full: {f}" for f in evaluate_launch(launch, components_root)]
            log("auditing installed components for build-machine references")
            audit: list[str] = []
            for comp_manifest in sorted(components_root.glob("*/component.json")):
                comp_root = comp_manifest.parent
                manifest = json.loads(comp_manifest.read_text(encoding="utf-8"))
                found = stager.audit_component(comp_root, manifest, markers)
                if manifest.get("kind") == "python-libraries":
                    found = [a for a in found if ": missing @loader_path/" not in a]
                audit += found
            summary["full"]["audit"] = audit
            summary["failures"] += [f"full audit: {a}" for a in audit]
            if sandbox and (components_root / "TOOLS_MANIFEST.json").is_file():
                verifier = sandboxed_verifier(resources, components_root, env, sandbox)
                summary["full"]["sandboxed_verifier"] = verifier
                if verifier.get("result") != "PASS":
                    summary["failures"].append(f"full: verifier with {args.hide} unreadable failed: {verifier.get('missing') or verifier.get('error')}")
            if not args.skip_functional and (components_root / "TOOLS_MANIFEST.json").is_file():
                work = mode_dir / "work"
                work.mkdir()
                summary["full"]["functional"] = functional_checks(components_root, env, sandbox, work)
                summary["failures"] += [f"full functional {name}: {r['detail']}" for name, r in summary["full"]["functional"].items() if not r["ok"]]
    finally:
        summary["ok"] = not summary["failures"]
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    for mode in ("base", "full"):
        rep_ = (summary.get(mode) or {}).get("app_report") or {}
        readiness = rep_.get("readiness") or {}
        if not readiness:
            continue
        s_ = readiness.get("summary") or {}
        vs = (((rep_.get("verifier") or {}).get("report")) or {}).get("summary") or {}
        log(f"{mode}: engine installed={readiness.get('engine', {}).get('installed')} online={s_.get('localEngineReady')} "
            f"components={s_.get('componentsInstalled')}/{s_.get('componentsTotal')} tools={s_.get('requiredToolsReady')}/{s_.get('requiredToolsTotal')} "
            f"offline={readiness.get('offlineAssets', {}).get('verifiedCount')}/{readiness.get('offlineAssets', {}).get('totalCount')} "
            f"python={vs.get('python_required_ready')}/{vs.get('python_required_total')}")
    for failure in summary["failures"]:
        log(f"FAILURE: {failure[:2000]}")
    log(f"report: {args.report}")
    log("RESULT: PASS" if summary["ok"] else "RESULT: FAIL")
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
