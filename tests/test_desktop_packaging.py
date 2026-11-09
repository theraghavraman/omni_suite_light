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
from unittest.mock import patch

import omni_environment
import omni_local_server
import omni_platform
import omni_security_primitives
import prepare_offline
from scripts import stage_desktop_bundle
from scripts import desktop_relocate

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

    def test_macos_smoke_uses_the_packaged_dmg_output_directory(self):
        workflow = (REPO_ROOT / ".github" / "workflows" / "desktop-installers.yml").read_text(encoding="utf-8")
        self.assertIn("--installer 'out/make/dmg/arm64/*.dmg' --mode both", workflow)

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
        workflow = (REPO_ROOT / ".github" / "workflows" / "desktop-installers.yml").read_text(encoding="utf-8")
        self.assertIn("const executableName = 'omni-converter-studio';", forge_config)
        self.assertIn("executableName,", forge_config)
        self.assertEqual(forge_config.count("bin: executableName"), 2)
        self.assertIn("specTemplate: path.join(__dirname, 'omni-rpm.spec.ejs')", forge_config)
        self.assertIn("this.userSupplied.specTemplate", forge_config)
        self.assertIn("electronInstallerCommon.wrapError('creating spec file'", forge_config)

        rpm_template = (REPO_ROOT / "electron" / "omni-rpm.spec.ejs").read_text(encoding="utf-8")
        self.assertIn(
            "cp <%= process.platform === 'darwin' ? '-R' : '-r' %> usr/. %{buildroot}/usr/",
            rpm_template,
        )
        self.assertEqual(workflow.count("--electron-arg=--no-sandbox"), 2)

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
                with_components=False,
                build_root=build_root,
                out_root=Path(tmp) / "out",
            )
            self.assertEqual(manifest["schema_version"], 3)
            # Engine-only staging must never be reported (or packaged) as a complete bundle.
            self.assertFalse(manifest["complete"])
            self.assertTrue((build_root / "BUNDLE_MANIFEST.json").is_file())
            self.assertTrue((build_root / "omni-engine" / "omni_local_server.py").is_file())
            self.assertTrue((build_root / "omni-engine" / "index.html").is_file())
            self.assertTrue((build_root / "omni-engine" / "omni_desktop_readiness.js").is_file())
            self.assertFalse((build_root / "components-catalog.json").exists())


class BundleSourcesTests(unittest.TestCase):
    def setUp(self):
        self.sources = stage_desktop_bundle.load_sources()

    def test_every_download_is_pinned_with_a_strong_digest(self):
        specs = list(self.sources["python"]["platforms"].values())
        for plat in self.sources["platforms"].values():
            specs += plat.get("downloads", [])
        for spec in specs:
            algo, value = stage_desktop_bundle.digest_of(spec)
            self.assertIn(algo, ("sha256", "sha512"))
            self.assertTrue(spec["url"].startswith("https://"), spec["url"])
        for name, digest in self.sources["tessdata"]["files"].items():
            self.assertRegex(digest, r"^[0-9a-f]{64}$", name)
        with self.assertRaises(stage_desktop_bundle.StageError):
            stage_desktop_bundle.digest_of({"url": "https://x", "sha256": "abc"})
        with self.assertRaises(stage_desktop_bundle.StageError):
            stage_desktop_bundle.digest_of({"url": "https://x"})

    def test_each_platform_provides_every_component_and_tool_group(self):
        components = {c["id"]: c for c in self.sources["components"]}
        self.assertIn("python-runtime", components)
        self.assertEqual(components["python-libraries"]["requires"], ["python-runtime"])
        covered_groups = set()
        for comp in components.values():
            for tool in comp.get("tools", []):
                covered_groups |= {g for g, members in omni_environment.NATIVE_GROUPS.items() if tool in members}
        self.assertTrue(set(omni_environment.REQUIRED_NATIVE_GROUPS) <= covered_groups)
        for plat, spec in self.sources["platforms"].items():
            self.assertIn(plat, self.sources["python"]["platforms"])
            harvested = set(spec.get("harvest", {}).get("executables", {}))
            for comp in components.values():
                if not comp.get("tools"):
                    continue
                provided = set(harvested & set(comp["tools"]))
                for download in spec.get("downloads", []):
                    if download.get("component") == comp["id"]:
                        provided |= set(download.get("tools", {}))
                self.assertTrue(provided, f"{plat}: component {comp['id']} has no pinned or harvested executable")
            for download in spec.get("downloads", []):
                self.assertTrue(download.get("build_only") or download.get("component") in components, download["id"])

    def test_components_have_a_valid_dependency_order(self):
        ids = {c["id"] for c in self.sources["components"]}
        for comp in self.sources["components"]:
            for dep in comp.get("requires", []):
                self.assertIn(dep, ids)
                self.assertNotEqual(dep, comp["id"])

    def test_merged_manifest_prefixes_component_paths(self):
        merged = stage_desktop_bundle.merge_component_manifests(
            {"ffmpeg": {"tools": {"ffmpeg": {"path": "bin/ffmpeg"}}, "env": {}, "path_dirs": ["bin"]},
             "tesseract": {"tools": {"tesseract": {"path": "bin/tesseract"}}, "env": {"TESSDATA_PREFIX": ["share/tessdata"]}, "path_dirs": ["bin"]}},
            {"ffmpeg": "ffmpeg", "tesseract": "tesseract"},
        )
        self.assertEqual(merged["tools"]["ffmpeg"]["path"], "ffmpeg/bin/ffmpeg")
        self.assertEqual(merged["env"]["TESSDATA_PREFIX"], ["tesseract/share/tessdata"])
        self.assertEqual(merged["path_dirs"], ["ffmpeg/bin", "tesseract/bin"])

    def test_windows_extractors_precede_archives_that_need_them(self):
        downloads = self.sources["platforms"]["win32-x64"]["downloads"]
        seven_zr = next(d for d in downloads if d["id"] == "7zr")
        self.assertTrue(seven_zr["build_only"], "7zr is an extraction helper, never a user component")
        self.assertEqual(next(d for d in downloads if d["id"] == "7zip")["format"], "7z-sfx")

    def test_linux_7zip_uses_pinned_upstream_static_binary(self):
        downloads = self.sources["platforms"]["linux-x64"]["downloads"]
        seven_zip = next(d for d in downloads if d["id"] == "7zip")
        self.assertIn("7z2605-linux-x64.tar.xz", seven_zip["url"])
        self.assertEqual(seven_zip["tools"], {"7zz": "bin/7zip/7zzs"})


class VerifiedDownloadTests(unittest.TestCase):
    def _server(self, payload: bytes, mode: str):
        import http.server
        import threading

        state = {"calls": 0}

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                state["calls"] += 1
                rng = self.headers.get("Range")
                if mode == "flaky" and rng:
                    start = int(rng.split("=")[1].rstrip("-"))
                    body = payload[start:]
                    self.send_response(206)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                body = payload[: len(payload) // 2] if mode == "flaky" else payload
                self.wfile.write(body)  # flaky: close early -> truncated transfer

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        return f"http://127.0.0.1:{server.server_address[1]}/file.bin", state

    def test_truncated_download_resumes_and_verifies(self):
        import hashlib
        from unittest import mock

        payload = os.urandom(300_000)
        url, state = self._server(payload, "flaky")
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(stage_desktop_bundle.time, "sleep"):
            path = stage_desktop_bundle.download_verified(url, "sha256", hashlib.sha256(payload).hexdigest(), Path(tmp), "test")
            self.assertEqual(path.read_bytes(), payload)
        self.assertGreaterEqual(state["calls"], 2)

    def test_wrong_bytes_are_rejected_not_retried_forever(self):
        from unittest import mock

        url, _ = self._server(b"not the pinned file", "ok")
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(stage_desktop_bundle.time, "sleep"):
            with self.assertRaises(stage_desktop_bundle.StageError) as ctx:
                stage_desktop_bundle.download_verified(url, "sha256", "0" * 64, Path(tmp), "test")
            self.assertIn("no source produced the pinned file", str(ctx.exception))
            self.assertEqual(list(Path(tmp).iterdir()), [])


class StrictToolResolutionTests(unittest.TestCase):
    def setUp(self):
        self._env = {k: os.environ.get(k) for k in ("OMNI_TOOL_RESOLUTION", "OMNI_NATIVE_TOOLS_ROOT", "PATH")}
        omni_environment._MANIFEST_CACHE.clear()
        omni_environment._PROBE_CACHE.clear()

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        omni_environment._MANIFEST_CACHE.clear()

    def _fake_tool(self, directory: Path, name: str, exit_code: int = 0) -> Path:
        if os.name == "nt":
            path = directory / f"{name}.cmd"
            path.write_text(f"@echo {name} 1.0\r\n@exit /b {exit_code}\r\n", encoding="utf-8")
        else:
            path = directory / name
            path.write_text(f"#!/bin/sh\necho {name} 1.0\nexit {exit_code}\n", encoding="utf-8")
            path.chmod(0o755)
        return path

    def test_bundled_mode_ignores_package_manager_tools(self):
        with tempfile.TemporaryDirectory() as bundle, tempfile.TemporaryDirectory() as host:
            host_tool = self._fake_tool(Path(host), "qpdf")
            os.environ["PATH"] = host + os.pathsep + os.environ.get("PATH", "")
            os.environ["OMNI_NATIVE_TOOLS_ROOT"] = bundle
            os.environ["OMNI_TOOL_RESOLUTION"] = "bundled"
            # No manifest entry: a host install must not make the bundle look ready.
            (Path(bundle) / "TOOLS_MANIFEST.json").write_text(json.dumps({"tools": {}}), encoding="utf-8")
            self.assertIsNone(omni_environment.find_native_tool_path("qpdf"))
            bundled_tool = self._fake_tool(Path(bundle), "qpdf")
            omni_environment._MANIFEST_CACHE.clear()
            (Path(bundle) / "TOOLS_MANIFEST.json").write_text(
                json.dumps({"tools": {"qpdf": {"path": bundled_tool.name}}}), encoding="utf-8"
            )
            os.utime(Path(bundle) / "TOOLS_MANIFEST.json", None)
            resolved = omni_environment.find_native_tool_path("qpdf")
            self.assertEqual(Path(resolved).resolve(), bundled_tool.resolve())
            self.assertNotEqual(Path(resolved).resolve(), host_tool.resolve())
            self.assertTrue(omni_environment.is_bundled_path(resolved))

    def test_a_tool_that_fails_to_run_is_not_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            broken = self._fake_tool(Path(tmp), "qpdf", exit_code=3)
            ok, _ = omni_environment.probe_native_tool(str(broken), "qpdf")
            self.assertFalse(ok)
            working = self._fake_tool(Path(tmp), "pandoc")
            ok, version = omni_environment.probe_native_tool(str(working), "pandoc")
            self.assertTrue(ok)
            self.assertIn("pandoc", version)

    def test_bundle_environment_has_no_host_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = omni_environment.bundled_tool_environment(
                tmp, {"env": {"TESSDATA_PREFIX": ["share/tessdata"]}, "path_dirs": ["bin"]},
                {"PATH": "/opt/homebrew/bin"}, sanitize_path=True,
            )
            self.assertNotIn("/opt/homebrew", env["PATH"])
            self.assertEqual(env["TESSDATA_PREFIX"], str(Path(tmp) / "share" / "tessdata"))
            self.assertEqual(env["OMNI_TOOL_RESOLUTION"], "bundled")


class RelocationTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "POSIX launchers only")
    def test_pip_shebangs_become_relocatable(self):
        with tempfile.TemporaryDirectory() as tmp:
            runtime = Path(tmp) / "python-runtime"
            scripts = runtime / "bin"
            scripts.mkdir(parents=True)
            script = scripts / "yt-dlp"
            script.write_text(f"#!{runtime}/bin/python3.12\nimport sys\nprint('hi')\n", encoding="utf-8")
            untouched = scripts / "other"
            untouched.write_text("#!/bin/sh\necho ok\n", encoding="utf-8")
            changed = stage_desktop_bundle.make_posix_scripts_relocatable(scripts, runtime)
            self.assertEqual(changed, ["yt-dlp"])
            text = script.read_text(encoding="utf-8")
            self.assertTrue(text.startswith("#!/bin/sh\n"))
            self.assertNotIn(str(runtime), text)
            self.assertIn("print('hi')", text)
            compile(text, "yt-dlp", "exec")  # trampoline must remain valid Python

    def test_text_audit_flags_build_host_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "launcher"
            bad.write_text('#!/bin/sh\nexec "/opt/homebrew/bin/qpdf" "$@"\n', encoding="utf-8")
            good = Path(tmp) / "relative"
            good.write_text('#!/bin/sh\nexec "$(dirname "$0")/qpdf" "$@"\n', encoding="utf-8")
            problems = desktop_relocate.audit_text_files([bad, good], desktop_relocate.build_host_markers())
            self.assertEqual(len(problems), 1)
            self.assertIn("launcher", problems[0])

    def test_elf_host_library_policy(self):
        for host in ("libc.so.6", "libm.so.6", "ld-linux-x86-64.so.2", "libGL.so.1", "libgcc_s.so.1"):
            self.assertTrue(desktop_relocate.is_elf_host_lib(host), host)
        for bundled in ("libtesseract.so.5", "libMagickCore-6.Q16.so.7", "libstdc++.so.6", "libgs.so.10"):
            self.assertFalse(desktop_relocate.is_elf_host_lib(bundled), bundled)

    def test_elf_relocator_bundles_transitive_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_dir = root / "source"
            source_dir.mkdir()
            sources = {}
            for name in ("ffmpeg", "libavcodec.so.60", "libSDL2-2.0.so.0", "libexpat.so.1"):
                sources[name] = source_dir / name
                sources[name].write_bytes(b"fixture")
            lib_dir = root / "bundle" / "lib"
            host_expat = root / "host" / "libexpat.so.1"
            host_expat.parent.mkdir()
            host_expat.write_bytes(b"host fixture")

            def fake_ldd(path):
                path = Path(path)
                name = path.name
                if path.parent.resolve() == source_dir.resolve():
                    dependencies = {
                        "ffmpeg": {"libavcodec.so.60": str(sources["libavcodec.so.60"]), "libc.so.6": "/lib/libc.so.6"},
                        "libavcodec.so.60": {"libSDL2-2.0.so.0": str(sources["libSDL2-2.0.so.0"]), "libc.so.6": "/lib/libc.so.6"},
                        # Model a dependency that only appears on the relocated ELF's final ldd pass.
                        "libSDL2-2.0.so.0": {"libc.so.6": "/lib/libc.so.6"},
                        "libexpat.so.1": {"libc.so.6": "/lib/libc.so.6"},
                    }
                    return dependencies[name]
                if name == "ffmpeg":
                    return {"libavcodec.so.60": str(lib_dir / "libavcodec.so.60"), "libc.so.6": "/lib/libc.so.6"}
                if name == "libavcodec.so.60":
                    return {"libSDL2-2.0.so.0": str(lib_dir / "libSDL2-2.0.so.0"), "libc.so.6": "/lib/libc.so.6"}
                if name == "libSDL2-2.0.so.0":
                    expat = lib_dir / "libexpat.so.1"
                    target = str(expat) if expat.exists() else str(host_expat)
                    return {"libexpat.so.1": target, "libc.so.6": "/lib/libc.so.6"}
                return {"libc.so.6": "/lib/libc.so.6"}

            relocator = desktop_relocate.ELFRelocator(lib_dir)
            with patch.object(desktop_relocate, "ldd", side_effect=fake_ldd), \
                    patch.object(desktop_relocate, "patchelf") as mocked_patchelf:
                relocator.add(sources["ffmpeg"], root / "bundle" / "bin" / "ffmpeg")
                relocator.run()

            self.assertEqual(set(relocator.libs), {"libavcodec.so.60", "libSDL2-2.0.so.0", "libexpat.so.1"})
            self.assertTrue((root / "bundle" / "lib" / "libexpat.so.1").is_file())
            self.assertTrue(mocked_patchelf.call_count)
            self.assertTrue(all(call.args[0] == "--force-rpath" for call in mocked_patchelf.call_args_list))

    @unittest.skipUnless(os.name == "nt", "PE parsing exercised on Windows")
    def test_pe_imports_of_python(self):
        import sys
        imports = [n.lower() for n in desktop_relocate.pe_imports(Path(sys.executable))]
        self.assertTrue(any(n.startswith("python3") for n in imports), imports)


class VerifierTruthfulnessTests(unittest.TestCase):
    def test_offline_asset_check_rejects_tampered_files(self):
        import verify_local_environment as verifier

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pins = prepare_offline.load_pins()
            (root / "offline_assets_manifest.json").write_text(json.dumps(pins), encoding="utf-8")
            first = next(iter(pins))
            target = root / "vendor" / first
            target.parent.mkdir(parents=True)
            target.write_text("not the pinned asset", encoding="utf-8")
            original = verifier.ROOT
            try:
                verifier.ROOT = root
                result = verifier.check_offline_assets()
            finally:
                verifier.ROOT = original
            self.assertFalse(result[f"vendor/{first}"])
            self.assertFalse(any(result.values()))


if __name__ == "__main__":
    unittest.main()
