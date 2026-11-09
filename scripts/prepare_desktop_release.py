#!/usr/bin/env python3
"""Validate catalog hashes and stage the desktop-v<version> GitHub release assets."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = ("linux-x64", "win32-x64", "darwin-arm64")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_stream(stream) -> str:
    digest = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


def add_flat_file(source: Path, destination_dir: Path) -> None:
    destination = destination_dir / source.name
    if destination.exists():
        raise RuntimeError(f"release asset filename collision: {source.name}")
    shutil.copy2(source, destination)


def copy_installer_tree(source_dir: Path, destination_dir: Path) -> list[str]:
    names: list[str] = []
    for source in sorted(path for path in source_dir.rglob("*") if path.is_file()):
        if source.name.startswith("."):
            continue
        add_flat_file(source, destination_dir)
        names.append(source.name)
    if not names:
        raise RuntimeError(f"no installers found in {source_dir}")
    return names


def check_sources_asset(source_dir: Path, platform: str, version: str) -> Path:
    name = f"omni-desktop-{platform}-corresponding-sources.tar"
    archive = source_dir / name
    if not archive.is_file():
        raise RuntimeError(f"missing corresponding-source offer for {platform}: {archive}")
    with tarfile.open(archive, "r:") as bundle:
        members = {
            member.name.removeprefix("desktop-corresponding-sources/"): member
            for member in bundle.getmembers()
            if member.isfile() and member.name.startswith("desktop-corresponding-sources/")
        }
        if "SOURCE-OFFER.md" not in members or "SOURCE_MANIFEST.json" not in members:
            raise RuntimeError(f"source offer archive is incomplete for {platform}: {archive}")
        manifest_file = bundle.extractfile(members["SOURCE_MANIFEST.json"])
        if manifest_file is None:
            raise RuntimeError(f"cannot read source manifest for {platform}: {archive}")
        manifest = json.load(manifest_file)
        if manifest.get("platform") != platform or manifest.get("app_version") != version:
            raise RuntimeError(f"source manifest platform/version mismatch for {platform}: {archive}")
        expected_files = {item["name"]: item for item in manifest.get("included_files", [])}
        actual_files = set(members) - {"SOURCE_MANIFEST.json"}
        if set(expected_files) != actual_files:
            missing = sorted(set(expected_files) - actual_files)
            unexpected = sorted(actual_files - set(expected_files))
            raise RuntimeError(f"source manifest file list mismatch for {platform}; missing={missing}, unexpected={unexpected}")
        for file_name, item in expected_files.items():
            member = members[file_name]
            if member.size != item.get("size"):
                raise RuntimeError(f"source manifest size mismatch for {platform}/{file_name}")
            stream = bundle.extractfile(member)
            if stream is None or sha256_stream(stream) != item.get("sha256"):
                raise RuntimeError(f"source manifest checksum mismatch for {platform}/{file_name}")
        entries = manifest.get("source_entries")
        if not isinstance(entries, list):
            raise RuntimeError(f"source manifest has no source entries for {platform}")
        entry_names = {member_name.rsplit("/", 1)[-1]: member_name for member_name in members}
        for entry in entries:
            entry_name = entry.get("name")
            if not entry.get("project") or not entry.get("version") or not entry_name or not entry.get("sha256"):
                raise RuntimeError(f"source entry lacks project/version/name/hash for {platform}: {entry}")
            member_name = entry_names.get(entry_name)
            if not member_name:
                raise RuntimeError(f"source entry file is missing for {platform}: {entry_name}")
            stream = bundle.extractfile(members[member_name])
            if stream is None or sha256_stream(stream) != entry["sha256"]:
                raise RuntimeError(f"source entry hash mismatch for {platform}/{entry_name}")
        projects = "\n".join(entry.get("project", "").lower() for entry in entries)
        required_projects = ("ffmpeg", "ghostscript", "poppler", "calibre", "pandoc")
        missing_projects = [project for project in required_projects if project not in projects]
        if missing_projects:
            raise RuntimeError(f"source archive misses required copyleft project entries for {platform}: {', '.join(missing_projects)}")
    return archive


def prepare(artifacts: Path, output: Path, version: str) -> None:
    shutil.rmtree(output, ignore_errors=True)
    output.mkdir(parents=True)
    for platform in PLATFORMS:
        component_dir = artifacts / f"omni-desktop-{platform}-components"
        installer_dir = artifacts / f"omni-desktop-{platform}-installers"
        source_dir = artifacts / f"omni-desktop-{platform}-sources"
        catalog_path = component_dir / "catalog.json"
        if not catalog_path.is_file():
            raise RuntimeError(f"missing component catalog for {platform}: {catalog_path}")
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        expected_base = f"https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v{version}/"
        if catalog.get("platform") != platform or catalog.get("app_version") != version:
            raise RuntimeError(f"catalog version/platform mismatch in {catalog_path}")
        if catalog.get("base_url") != expected_base:
            raise RuntimeError(f"catalog download URL mismatch in {catalog_path}: {catalog.get('base_url')}")
        components = catalog.get("components")
        if not isinstance(components, list) or len(components) != 14:
            raise RuntimeError(f"expected 14 components in {catalog_path}")
        for component in components:
            filename = component.get("file")
            archive = component_dir / str(filename)
            if not archive.is_file():
                raise RuntimeError(f"catalog archive missing for {platform}/{component.get('id')}: {archive}")
            actual = sha256(archive)
            if actual != component.get("sha256") or archive.stat().st_size != component.get("size"):
                raise RuntimeError(f"catalog checksum/size mismatch for {platform}/{filename}; rebuild catalog after any binary signing or archive change")
            add_flat_file(archive, output)
        renamed_catalog = output / f"catalog-{platform}.json"
        if renamed_catalog.exists():
            raise RuntimeError(f"duplicate release catalog filename: {renamed_catalog.name}")
        shutil.copy2(catalog_path, renamed_catalog)
        copy_installer_tree(installer_dir, output)
        source_archive = check_sources_asset(source_dir, platform, version)
        add_flat_file(source_archive, output)

    source_offer = output / "SOURCE-OFFER.md"
    shutil.copy2(ROOT / "DESKTOP_SOURCE_OFFER.md", source_offer)
    notes = [
        f"# OmniConverter Studio {version}",
        "",
        "The small base installer runs browser-only when no optional components are installed. The installer catalogs point to this release for verified component downloads.",
        "",
        "## Tested targets",
        "",
        "- macOS arm64 (DMG; base and full component smoke)",
        "- Windows x64 (Squirrel installer; base and full component smoke)",
        "- Linux x64 (.deb on Ubuntu 24.04 and .rpm on Fedora 42; base and full component smoke)",
        "",
        "## Source and integrity files",
        "",
        "This release includes a per-platform corresponding-source archive for the copyleft native components, component catalogs, and `SHA256SUMS`. The catalogs pin the exact component archive SHA-256 values; the release preparation step verified every catalog hash and byte size against the final archives before upload.",
        "",
        "Corresponding-source offers (free download): [Linux x64](https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v" + version + "/omni-desktop-linux-x64-corresponding-sources.tar), [Windows x64](https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v" + version + "/omni-desktop-win32-x64-corresponding-sources.tar), [macOS arm64](https://github.com/theraghavraman/omni_suite_light/releases/download/desktop-v" + version + "/omni-desktop-darwin-arm64-corresponding-sources.tar).",
        "",
        "## Signing status",
        "",
        "These release installers are not Developer ID notarized, Authenticode signed, or Linux package signed. macOS component binaries relocated by the build may carry ad-hoc signatures; their archive hashes in the catalogs reflect the final packaged bytes.",
        "",
        "## Target limits",
        "",
        "macOS x64 is unbuilt and untested. Linux arm64 and Windows arm64 are unsupported; the stager refuses those targets.",
        "",
        "## Security limits",
        "",
        "Code execution, 7z/RAR archive extraction, and unverified LAN transfer remain fail-closed as documented in `SECURITY_REMEDIATION_STATUS.md`.",
        "",
        f"CI build and clean-install smoke results: https://github.com/theraghavraman/omni_suite_light/actions/runs/{os.environ.get('GITHUB_RUN_ID', 'unknown')}",
        "",
    ]
    (output / "RELEASE_NOTES.md").write_text("\n".join(notes), encoding="utf-8")
    lines = []
    for path in sorted(output.iterdir()):
        if path.is_file() and path.name != "SHA256SUMS":
            lines.append(f"{sha256(path)}  {path.name}")
    (output / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Prepared {len(lines)} SHA-256-pinned release assets in {output}")
    for line in lines:
        print(line)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    prepare(args.artifacts, args.output, args.version)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"release preparation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
