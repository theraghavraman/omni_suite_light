#!/usr/bin/env python3
"""Create the release's GPL/AGPL/LGPL corresponding-source bundle.

Sources come from the same inputs used by the desktop component build:
Homebrew formula source archives on macOS, signed Ubuntu source packages on
Linux, and pinned upstream source revisions on Windows.  The bundle also
contains the component license/provenance tables and Omni's relocation/build
scripts.  It is uploaded alongside the component archives at release time.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COPYLEFT_NAMES = ("GNU GENERAL PUBLIC LICENSE", "GNU AFFERO GENERAL PUBLIC LICENSE",
                  "GNU LESSER GENERAL PUBLIC LICENSE", "GNU LIBRARY GENERAL PUBLIC LICENSE")
COPYLEFT_ID = re.compile(
    r"(?:SPDX-LICENSE-IDENTIFIER:\s*[^\n]*)?\b(?:A?GPL|LGPL)(?:[- ]?\d(?:\.\d+)?(?:\.\d+)?|\s*v?\d(?:\.\d+)?(?:\.\d+)?|\+|\b)",
    re.IGNORECASE,
)
SOURCE_COMPONENTS = ("ffmpeg", "ghostscript", "poppler", "pandoc", "calibre")
CALIBRE_VERSION = "9.16.0"
CALIBRE_URL = f"https://download.calibre-ebook.com/{CALIBRE_VERSION}/calibre-{CALIBRE_VERSION}.tar.xz"
CALIBRE_SHA512 = "c606194e31ccf868ed298a908fcddf8c2f4ab5dbd3678e10de559d6c05b51c953e6bb7575c7a385e957360a64a62b8e00b3c8bf05b65455984374471aea9b2d8"

# These are immutable source revisions for the Windows vendor-built components.
WIN_SOURCE_ARCHIVES = (
    {
        "name": "ffmpeg-9.0.2-source.tar.gz",
        "url": "https://github.com/FFmpeg/FFmpeg/archive/946fcce07b6dcd0331c8cc609192aeff5e1924f8.tar.gz",
        "revision": "946fcce07b6dcd0331c8cc609192aeff5e1924f8",
        "project": "FFmpeg 9.0.2",
        "version": "9.0.2",
    },
    {
        "name": "poppler-26.07.0-source.tar.xz",
        "url": "https://poppler.freedesktop.org/poppler-26.07.0.tar.xz",
        "sha256": "304832f48f8a47fdca90c6b6d1f684e68f37c10c9a0726f345f4ca9df4ca01e2",
        "project": "Poppler 26.07.0",
        "version": "26.07.0",
    },
    {
        "name": "poppler-windows-build-scripts.tar.gz",
        "url": "https://github.com/oschwartz10612/poppler-windows/archive/109a0191d527f0a62a6e4dd11ed4baaf23d58949.tar.gz",
        "revision": "109a0191d527f0a62a6e4dd11ed4baaf23d58949",
        "project": "poppler-windows packaging script for the pinned Windows build",
        "version": "26.07.0-0",
    },
    {
        "name": "conda-forge-poppler-feedstock-26.07.0.tar.gz",
        "url": "https://github.com/conda-forge/poppler-feedstock/archive/0de45e35e7ddc99e572f60e0599030874f9b65c3.tar.gz",
        "revision": "0de45e35e7ddc99e572f60e0599030874f9b65c3",
        "project": "conda-forge Poppler 26.07.0 build recipe and patches",
        "version": "26.07.0",
    },
    {
        "name": "ghostscript-10.08.0-source.tar.xz",
        "url": "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10080/ghostscript-10.08.0.tar.xz",
        "sha256": "c20492bc8ebb96c87fa2e52a0926e1cda8cde95d66145e018ac713fed5da38cf",
        "project": "Ghostscript 10.08.0",
        "version": "10.08.0",
    },
    {
        "name": "pandoc-3.12-source.tar.gz",
        "url": "https://hackage.haskell.org/package/pandoc-3.12.tar.gz",
        "sha256": "ef4475d2b137c72340d36723d6d694c5bd7b823d7a214efc1d5b7634d5bea9b1",
        "project": "Pandoc 3.12",
        "version": "3.12",
    },
)


def digest_file(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(args: list[str], *, cwd: Path | None = None) -> str:
    proc = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)
    if proc.returncode:
        raise RuntimeError(f"command failed ({proc.returncode}): {' '.join(args)}\n{proc.stderr[-4000:]}")
    return proc.stdout


def verified_ssl_context() -> ssl.SSLContext:
    try:
        import certifi
    except ImportError:
        return ssl.create_default_context()
    return ssl.create_default_context(cafile=certifi.where())


def download(url: str, destination: Path, *, algo: str | None = None,
             expected: str | None = None) -> dict:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "OmniConverter-Source-Offer/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=90, context=verified_ssl_context()) as response, temporary.open("wb") as out:
            shutil.copyfileobj(response, out, 1024 * 1024)
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"failed to download source archive {url}: {exc}") from exc
    if algo and expected:
        actual = digest_file(temporary, algo)
        if actual.lower() != expected.lower():
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"source checksum mismatch for {url}: {algo} {actual} != {expected}")
    os.replace(temporary, destination)
    return {"name": destination.name, "url": url, "sha256": digest_file(destination),
            "size": destination.stat().st_size, "verified_by": f"{algo}:{expected}" if algo and expected else "immutable source revision/HTTPS"}


def archive_git_revision(url: str, revision: str, destination: Path, prefix: str) -> dict:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="omni-source-git-") as temp_name:
        repository = Path(temp_name) / "repository"
        run(["git", "init", "--quiet", str(repository)])
        run(["git", "-C", str(repository), "fetch", "--quiet", "--depth=1", url, revision])
        actual_revision = run(["git", "-C", str(repository), "rev-parse", "FETCH_HEAD"]).strip()
        if actual_revision.lower() != revision.lower():
            raise RuntimeError(f"Git source revision mismatch for {url}: expected {revision}, got {actual_revision}")
        with destination.open("wb") as output:
            proc = subprocess.run(
                ["git", "-C", str(repository), "archive", "--format=tar", f"--prefix={prefix}/", actual_revision],
                stdout=output, stderr=subprocess.PIPE, check=False,
            )
        if proc.returncode:
            destination.unlink(missing_ok=True)
            raise RuntimeError(f"cannot archive Git source revision {actual_revision}: {proc.stderr.decode(errors='replace')[-2000:]}")
    return {
        "name": destination.name, "url": url, "revision": actual_revision,
        "sha256": digest_file(destination), "size": destination.stat().st_size,
        "verified_by": f"git commit {actual_revision}",
    }


def calibre_source(destination: Path) -> dict:
    return download(CALIBRE_URL, destination, algo="sha512", expected=CALIBRE_SHA512)


def parse_component_table(path: Path) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$", line)
        if match and match.group(1).strip().lower() != "component":
            name, version, source = (part.strip() for part in match.groups())
            rows[name] = {"version": version, "source": source}
    return rows


def has_copyleft_license(directory: Path) -> bool:
    if not directory.is_dir():
        return False
    for path in directory.rglob("*"):
        if not path.is_file() or path.stat().st_size > 2_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore").upper()
        except OSError:
            continue
        if any(name in text for name in COPYLEFT_NAMES):
            return True
        # Debian copyright files and formula notices often use short identifiers
        # instead of embedding the complete license.
        if COPYLEFT_ID.search(text):
            return True
    return False


def copy_build_provenance(destination: Path, platform: str) -> None:
    provenance = destination / "build-provenance"
    provenance.mkdir(parents=True, exist_ok=True)
    for relative in ("LICENSE", "THIRD_PARTY_NOTICES.md", "scripts/desktop_bundle_sources.json",
                     "scripts/stage_desktop_bundle.py", "scripts/desktop_relocate.py"):
        source = ROOT / relative
        if source.is_file():
            target = provenance / relative.replace("/", "__")
            shutil.copy2(source, target)
    components = ROOT / "build" / "components" / platform
    table_root = provenance / "component-provenance"
    for component in SOURCE_COMPONENTS:
        table = components / component / "licenses" / "BUNDLED_COMPONENTS.md"
        if table.is_file():
            target = table_root / f"{component}-BUNDLED_COMPONENTS.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(table, target)


def collect_calibre_table_version(platform: str) -> str:
    table = ROOT / "build" / "components" / platform / "calibre" / "licenses" / "BUNDLED_COMPONENTS.md"
    versions = parse_component_table(table)
    for name, info in versions.items():
        if name.lower() == "calibre":
            return info["version"]
    return CALIBRE_VERSION


def collect_macos(platform: str, destination: Path, entries: list[dict]) -> None:
    components = ROOT / "build" / "components" / platform
    formula_versions: dict[str, str] = {}
    formulas = {"ffmpeg", "ghostscript", "poppler", "pandoc"}
    for component in SOURCE_COMPONENTS:
        table = components / component / "licenses" / "BUNDLED_COMPONENTS.md"
        for name, row in parse_component_table(table).items():
            license_dir = components / component / "licenses" / name
            if has_copyleft_license(license_dir) and row["source"].startswith("Homebrew bottle ("):
                formulas.add(name)
                formula_versions[name] = row["version"]
    formula_dir = destination / "homebrew-formulae"
    archive_dir = destination / "archives"
    for formula in sorted(formulas):
        info = json.loads(run(["brew", "info", "--json=v2", "--formula", formula]))["formulae"][0]
        stable = info["urls"]["stable"]
        version = str(info["versions"]["stable"])
        revision = int(info.get("revision") or 0)
        staged_version = formula_versions.get(formula)
        formula_build_version = f"{version}_{revision}" if revision else version
        if staged_version and staged_version not in {version, formula_build_version}:
            raise RuntimeError(
                f"Homebrew source version drift for {formula}: bundled {staged_version}, "
                f"formula source {version} (revision {revision})"
            )
        url, checksum = stable["url"], stable["checksum"]
        filename = urllib.parse.unquote(Path(urllib.parse.urlparse(url).path).name)
        if not filename:
            filename = f"{formula}-{version}-source.tar.gz"
        if checksum and len(checksum) == 64:
            record = download(url, archive_dir / f"{formula}-{version}-{filename}", algo="sha256", expected=checksum)
        elif stable.get("revision") and url.endswith(".git"):
            record = archive_git_revision(
                url, stable["revision"], archive_dir / f"{formula}-{version}-source.tar",
                f"{formula}-{stable['revision'][:12]}",
            )
        else:
            raise RuntimeError(f"Homebrew formula has neither a source SHA-256 nor an immutable Git revision: {formula}")
        record.update({
            "project": formula,
            "version": staged_version or version,
            "formula_source_version": version,
            "formula_revision": revision,
            "formula_sha256": checksum,
        })
        entries.append(record)
        formula_dir.mkdir(parents=True, exist_ok=True)
        recipe = run(["brew", "cat", formula])
        (formula_dir / f"{formula}.rb").write_text(recipe, encoding="utf-8")
    if collect_calibre_table_version(platform) != CALIBRE_VERSION:
        raise RuntimeError(f"Calibre source pin {CALIBRE_VERSION} does not match the staged component")
    entries.append(calibre_source(archive_dir / f"calibre-{CALIBRE_VERSION}-source.tar.xz") | {"project": "Calibre", "version": CALIBRE_VERSION})


def collect_linux(platform: str, destination: Path, entries: list[dict]) -> None:
    components = ROOT / "build" / "components" / platform
    source_packages: set[tuple[str, str]] = set()
    for component in SOURCE_COMPONENTS:
        table = components / component / "licenses" / "BUNDLED_COMPONENTS.md"
        for package, row in parse_component_table(table).items():
            source = row["source"]
            if not source.startswith("Ubuntu package "):
                continue
            if not has_copyleft_license(components / component / "licenses" / package):
                continue
            try:
                metadata = run(["dpkg-query", "-W", "-f=${source:Package}\t${source:Version}", package]).strip()
            except RuntimeError as exc:
                raise RuntimeError(f"cannot resolve installed source package for copyleft package {package}") from exc
            source_name, source_version = (metadata.split("\t", 1) + [""])[:2]
            if not source_name:
                source_name = package
            if not source_version:
                source_version = row["version"]
            source_packages.add((source_name, source_version))
    package_dir = destination / "ubuntu-source-packages"
    package_dir.mkdir(parents=True, exist_ok=True)
    for source_name, source_version in sorted(source_packages):
        before = set(package_dir.iterdir())
        run(["apt-get", "source", f"{source_name}={source_version}"], cwd=package_dir)
        after = set(package_dir.iterdir())
        for path in sorted(after - before):
            if path.is_file():
                entries.append({"project": source_name, "version": source_version,
                                "name": path.name, "sha256": digest_file(path), "size": path.stat().st_size,
                                "url": "Ubuntu signed deb-src repository", "verified_by": "APT signed repository metadata"})
    for path in package_dir.iterdir():
        if path.is_dir():
            shutil.rmtree(path)
    if collect_calibre_table_version(platform) != CALIBRE_VERSION:
        raise RuntimeError(f"Calibre source pin {CALIBRE_VERSION} does not match the staged component")
    entries.append(calibre_source(destination / "archives" / f"calibre-{CALIBRE_VERSION}-source.tar.xz") | {"project": "Calibre", "version": CALIBRE_VERSION})


def collect_windows(platform: str, destination: Path, entries: list[dict]) -> None:
    versions = {
        "ffmpeg": "9.0.2", "ghostscript": "10.08.0", "poppler": "26.07.0-0",
        "pandoc": "3.12", "calibre": CALIBRE_VERSION,
    }
    components = ROOT / "build" / "components" / platform
    for component, expected in versions.items():
        rows = parse_component_table(components / component / "licenses" / "BUNDLED_COMPONENTS.md")
        actual = next((row["version"] for name, row in rows.items() if name.lower() == component), expected)
        if actual and not (actual == expected or (component == "poppler" and actual.startswith(expected))):
            raise RuntimeError(f"source version pin mismatch for {component}: expected {expected}, staged {actual}")
    archive_dir = destination / "archives"
    for spec in WIN_SOURCE_ARCHIVES:
        filename = spec["name"]
        record = download(spec["url"], archive_dir / filename,
                          algo="sha256" if spec.get("sha256") else None,
                          expected=spec.get("sha256"))
        record.update({key: value for key, value in spec.items() if key != "url"})
        entries.append(record)
    ffmpeg_root = components / "ffmpeg"
    extra_info = destination / "build-provenance" / "windows-vendor-build-info"
    extra_info.mkdir(parents=True, exist_ok=True)
    for name in ("README.txt", "LICENSE.txt", "COPYING.txt"):
        for source in ffmpeg_root.rglob(name):
            if source.is_file():
                shutil.copy2(source, extra_info / f"ffmpeg-{name}")
                break
    binaries = list(ffmpeg_root.rglob("ffmpeg.exe"))
    if not binaries:
        raise RuntimeError("cannot locate the staged Windows FFmpeg binary to record its exact build configuration")
    proc = subprocess.run([str(binaries[0]), "-hide_banner", "-buildconf"], text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode:
        raise RuntimeError(f"cannot read the staged FFmpeg build configuration: {proc.stderr[-2000:]}")
    (extra_info / "ffmpeg-buildconf.txt").write_text(proc.stdout + proc.stderr, encoding="utf-8")
    pins = json.loads((ROOT / "scripts" / "desktop_bundle_sources.json").read_text(encoding="utf-8"))
    ffmpeg_pin = next((item for item in pins["platforms"][platform]["downloads"] if item.get("id") == "ffmpeg"), None)
    if not ffmpeg_pin:
        raise RuntimeError("missing pinned Windows FFmpeg download metadata")
    (extra_info / "ffmpeg-vendor-build.txt").write_text(
        "Windows FFmpeg source and build provenance\n"
        "===========================================\n"
        f"Pinned vendor binary: {ffmpeg_pin['url']}\n"
        f"Pinned vendor archive SHA-256: {ffmpeg_pin['sha256']}\n"
        "Vendor release page: https://www.gyan.dev/ffmpeg/builds/\n"
        "FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/946fcce07b6dcd0331c8cc609192aeff5e1924f8\n"
        "The exact configure options reported by the staged binary are in ffmpeg-buildconf.txt.\n",
        encoding="utf-8",
    )
    entries.append(calibre_source(archive_dir / f"calibre-{CALIBRE_VERSION}-source.tar.xz") | {"project": "Calibre", "version": CALIBRE_VERSION})


def write_source_offer(destination: Path, platform: str, app_version: str, entries: list[dict]) -> None:
    lines = [
        f"# Corresponding source offer — OmniConverter Studio {app_version} ({platform})",
        "",
        "This asset provides, at no charge, the source packages and build provenance for Ghostscript, FFmpeg, Poppler, Calibre, and Pandoc distributed with this platform build. It accompanies the matching component archives on the `desktop-v" + app_version + "` GitHub release.",
        "",
        f"Download this platform's corresponding source archive: https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v{app_version}/omni-desktop-{platform}-corresponding-sources.tar",
        "",
        "The bundle includes source archives for the exact staged versions, applicable package-manager recipes or signed Ubuntu source packages, component license/provenance tables, and Omni's relocation/build scripts. On Windows it also includes the vendor release reference and FFmpeg's exact build configuration, plus the Poppler packaging recipe and patches. `SOURCE_MANIFEST.json` records each source URL or immutable revision and hashes the included source files and build materials. Ubuntu source packages were retrieved from the runner's signed `deb-src` indexes; Homebrew source archives were verified against the formula SHA-256 or exact Git commit; vendor archives were checked against their pinned digest or immutable source revision.",
        "",
        "This source offer is provided from the same GitHub release as the corresponding component binaries. Keep this asset with any redistributed copy of the matching component archives.",
        "",
        "| Source project/package | Version | Included file(s) | SHA-256 |",
        "| --- | --- | --- | --- |",
    ]
    for item in entries:
        lines.append(f"| {item.get('project', '')} | {item.get('version', '')} | `{item.get('name', '')}` | `{item.get('sha256', '')}` |")
    (destination / "SOURCE-OFFER.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    files = []
    for path in sorted(destination.rglob("*")):
        if path.is_file() and path.name != "SOURCE_MANIFEST.json":
            files.append({"name": path.relative_to(destination).as_posix(), "sha256": digest_file(path),
                          "size": path.stat().st_size})
    (destination / "SOURCE_MANIFEST.json").write_text(json.dumps({
        "schema_version": 1, "app_version": app_version, "platform": platform,
        "source_entries": entries, "included_files": files,
    }, indent=2) + "\n", encoding="utf-8")


def make_tar(source_dir: Path, archive: Path) -> None:
    archive.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "w") as tar:
        for path in sorted(source_dir.rglob("*")):
            if path.is_file():
                tar.add(path, arcname=Path("desktop-corresponding-sources") / path.relative_to(source_dir), recursive=False)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", required=True, choices=("darwin-arm64", "linux-x64", "win32-x64"))
    parser.add_argument("--app-version", required=True)
    parser.add_argument("--components-dir", type=Path, default=ROOT / "build" / "components")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "out" / "sources")
    args = parser.parse_args()
    platform = args.platform
    components_dir = args.components_dir / platform
    for component in SOURCE_COMPONENTS:
        if not (components_dir / component / "licenses" / "BUNDLED_COMPONENTS.md").is_file():
            raise SystemExit(f"missing provenance table for required source component {component}: {platform}")
    out_dir = args.output_dir / platform
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    copy_build_provenance(out_dir, platform)
    entries: list[dict] = []
    try:
        if platform == "darwin-arm64":
            collect_macos(platform, out_dir, entries)
        elif platform == "linux-x64":
            collect_linux(platform, out_dir, entries)
        else:
            collect_windows(platform, out_dir, entries)
    except Exception as exc:
        raise SystemExit(f"failed to assemble corresponding-source offer: {exc}") from exc
    write_source_offer(out_dir, platform, args.app_version, entries)
    archive = args.output_dir / f"omni-desktop-{platform}-corresponding-sources.tar"
    make_tar(out_dir, archive)
    print(f"SOURCE OFFER: {archive} ({archive.stat().st_size} bytes, sha256 {digest_file(archive)})")
    print(f"SOURCE FILES: {len(entries)} project/package source records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
