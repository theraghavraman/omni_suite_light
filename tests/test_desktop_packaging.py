#!/usr/bin/env python3
"""Unit tests for OmniConverter Studio desktop Electron packaging & security boundaries."""
from __future__ import annotations

from contextlib import closing
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

import omni_environment
import omni_local_server
import omni_platform
import omni_security_primitives
import prepare_offline
from scripts import stage_desktop_bundle

REPO_ROOT = Path(__file__).resolve().parent.parent


class DesktopPackagingTests(unittest.TestCase):
    def test_electron_shell_and_forge_files_exist(self):
        required = (
            REPO_ROOT / "electron" / "main.cjs",
            REPO_ROOT / "electron" / "preload.cjs",
            REPO_ROOT / "electron" / "forge.config.cjs",
            REPO_ROOT / "electron" / "entitlements.mac.plist",
            REPO_ROOT / "scripts" / "stage_desktop_bundle.py",
            REPO_ROOT / "omni_desktop_readiness.js",
            REPO_ROOT / ".github" / "workflows" / "desktop-installers.yml",
            REPO_ROOT / "DESKTOP_PACKAGING.md",
        )
        for path in required:
            self.assertTrue(path.is_file(), f"Missing desktop packaging file: {path}")

    def test_electron_main_enforces_security_boundaries(self):
        main_src = (REPO_ROOT / "electron" / "main.cjs").read_text(encoding="utf-8")
        self.assertIn("contextIsolation: true", main_src)
        self.assertIn("nodeIntegration: false", main_src)
        self.assertIn("sandbox: true", main_src)
        self.assertIn("OMNI_NO_BROWSER: '1'", main_src)
        self.assertIn("const HOST = '127.0.0.1';", main_src)

    def test_omni_local_server_respects_no_browser_env(self):
        server_src = (REPO_ROOT / "omni_local_server.py").read_text(encoding="utf-8")
        self.assertIn('os.environ.get("OMNI_NO_BROWSER") != "1"', server_src)

    def test_package_json_preserves_npm_contract_and_adds_forge(self):
        pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(pkg["name"], "@theraghavraman/omni-universal-data-studio")
        self.assertEqual(pkg["main"], "electron/main.cjs")
        self.assertEqual(pkg["config"]["forge"], "./electron/forge.config.cjs")
        self.assertIn("universal_data_studio.js", pkg["files"])
        for script_name in ("desktop:stage", "desktop:start", "desktop:package", "desktop:make", "desktop:verify"):
            self.assertIn(script_name, pkg["scripts"])

    def test_linux_installers_use_the_packaged_executable_name(self):
        forge_config = (REPO_ROOT / "electron" / "forge.config.cjs").read_text(encoding="utf-8")
        self.assertIn("const executableName = 'omni-converter-studio';", forge_config)
        self.assertIn("executableName,", forge_config)
        self.assertEqual(forge_config.count("bin: executableName"), 2)
        self.assertIn("specTemplate: path.join(__dirname, 'omni-rpm.spec.ejs')", forge_config)
        self.assertIn("this.userSupplied.specTemplate", forge_config)
        self.assertIn("electronInstallerCommon.wrapError('creating spec file'", forge_config)

        rpm_template = (REPO_ROOT / "electron" / "omni-rpm.spec.ejs").read_text(encoding="utf-8")
        self.assertIn(
            "cp <%= process.platform === 'darwin' ? '-R' : '-r' %> ../usr/. %{buildroot}/usr/",
            rpm_template,
        )

    def test_bundled_tools_dir_precedence_in_omni_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_bin = Path(tmp) / ("qpdf.exe" if os.name == "nt" else "qpdf")
            fake_bin.write_text("#!/bin/sh\necho qpdf\n", encoding="utf-8")
            if os.name != "nt":
                fake_bin.chmod(0o755)
            old_env = os.environ.get("OMNI_BUNDLED_TOOLS_DIR")
            try:
                os.environ["OMNI_BUNDLED_TOOLS_DIR"] = tmp
                resolved = omni_environment.find_native_tool_path("qpdf")
                self.assertEqual(Path(resolved).resolve(), fake_bin.resolve())
            finally:
                if old_env is None:
                    os.environ.pop("OMNI_BUNDLED_TOOLS_DIR", None)
                else:
                    os.environ["OMNI_BUNDLED_TOOLS_DIR"] = old_env

    def test_static_path_allows_desktop_readiness_script_and_blocks_electron_dir(self):
        self.assertTrue(omni_local_server.approved_static_path("omni_desktop_readiness.js"))
        self.assertFalse(omni_local_server.approved_static_path("electron/main.cjs"))
        self.assertFalse(omni_local_server.approved_static_path("electron/preload.cjs"))
        self.assertFalse(omni_local_server.approved_static_path("electron/forge.config.cjs"))

    def test_sqlite_workspace_confinement_and_offline_asset_pins(self):
        pins = prepare_offline.load_pins()
        self.assertEqual(set(pins.keys()), set(omni_environment.OFFLINE_ASSET_URLS.keys()))
        self.assertEqual(len(pins), 41)

        with tempfile.TemporaryDirectory() as allowed_dir, tempfile.TemporaryDirectory() as outside_dir:
            allowed_root = Path(allowed_dir)
            inside_db = allowed_root / "workspace.sqlite"
            outside_db = Path(outside_dir) / "outside.sqlite"
            for db_path in (inside_db, outside_db):
                with closing(sqlite3.connect(db_path)) as conn:
                    conn.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT)")
                    conn.execute("INSERT INTO notes VALUES (1, 'ready')")
                    conn.commit()

            inside_url = f"sqlite:///{inside_db.as_posix()}"
            outside_url = f"sqlite:///{outside_db.as_posix()}"
            scheme, resolved = omni_security_primitives.validate_db_destination(
                inside_url, sqlite_root=allowed_root
            )
            self.assertEqual(scheme, "sqlite")
            self.assertEqual(resolved, inside_db.resolve())

            with self.assertRaises(ValueError):
                omni_security_primitives.validate_db_destination(
                    outside_url, sqlite_root=allowed_root
                )

            old_env = os.environ.get("OMNI_ALLOWED_SQLITE_DIR")
            try:
                os.environ["OMNI_ALLOWED_SQLITE_DIR"] = str(allowed_root)
                tables = omni_platform.database_tables(inside_url)
                self.assertIn("notes", tables["tables"]["main"])
                res = omni_platform.database_query(inside_url, "SELECT title FROM notes")
                self.assertEqual(res["rows"][0]["title"], "ready")
            finally:
                if old_env is None:
                    os.environ.pop("OMNI_ALLOWED_SQLITE_DIR", None)
                else:
                    os.environ["OMNI_ALLOWED_SQLITE_DIR"] = old_env

    def test_stage_desktop_bundle_creates_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            build_root = Path(tmp) / "build"
            manifest = stage_desktop_bundle.stage_bundle(
                download_offline=False,
                create_venv=False,
                build_root=build_root,
            )
            self.assertEqual(manifest["schema_version"], 1)
            self.assertTrue((build_root / "BUNDLE_MANIFEST.json").is_file())
            self.assertTrue((build_root / "omni-engine" / "omni_local_server.py").is_file())
            self.assertTrue((build_root / "omni-engine" / "index.html").is_file())
            self.assertTrue((build_root / "omni-engine" / "omni_desktop_readiness.js").is_file())


if __name__ == "__main__":
    unittest.main()
