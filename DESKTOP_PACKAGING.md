# OmniConverter Studio — Desktop Packaging Guide

OmniConverter Studio (`theraghavraman/omni_suite_light`) ships as a small
[Electron](https://electronjs.org/docs/latest/tutorial/process-model) installer for
**Windows**, **macOS** and **Linux**. The installer contains the app shell, the Local Engine
code, the Studio UI and the 41 SHA-256-pinned offline browser assets, so it opens and works
in **browser-only mode** with nothing else installed and without a network connection.

Everything heavy is an **optional component** the user picks in the **Component Manager**,
which opens on first launch and later from **File → Manage Components…** (or the READY pill →
*Manage Components*). Users can install all components, some, or none, and add or remove
them at any time. No Python, Homebrew, apt, Chocolatey or manual commands are ever needed.

| Component | Contents | Needs |
| --- | --- | --- |
| Local Engine (Python 3.12) | relocatable [python-build-standalone](https://github.com/astral-sh/python-build-standalone) CPython 3.12.15 | — |
| Data, science & database libraries | `requirements-local.txt` (pandas, pyarrow, DuckDB, Polars, SciPy, astropy, netCDF/HDF5/GRIB, Excel/ODF, SQL dialects, DB/cloud connectors, yt-dlp module) | Local Engine |
| LibreOffice | LibreOffice 26.8.2 (official build) | Local Engine |
| Calibre ebook-convert | Calibre 9.16.0 (official build) | Local Engine |
| FFmpeg, Poppler, qpdf, ImageMagick, Ghostscript, Pandoc, 7-Zip, librsvg | native tools with their libraries and data files | Local Engine |
| Tesseract OCR | Tesseract + tessdata_fast 4.1.0 for 13 languages | Local Engine |
| yt-dlp | yt-dlp 2026.08.19 command-line tool | Local Engine |

Each native-tool component is self-contained (its own `bin/`, `lib/`, `share/`); none depends
on another tool component.

## 1. How it works

1. **Catalog in the installer.** The build writes `resources/components-catalog.json`: for every
   component its archive name, download size, installed size, dependencies, tools and
   **SHA-256**. The catalog is part of the installer, so it is covered by installer signing.
2. **Component Manager (`electron/components.html`, `electron/components.cjs`).** Shows each
   component with size and description (recommended ones preselected), resolves dependencies,
   checks free disk space, downloads with progress and cancel, verifies the SHA-256 **before**
   extracting, extracts into a staging folder and moves it atomically into
   `<userData>/components/<id>/` (user-scoped; no administrator rights). A failed or tampered
   download is discarded and reported per component; the others still install. Installed
   components are merged into `<userData>/components/TOOLS_MANIFEST.json`, and the Local Engine
   is restarted to pick them up.
3. **Download location.** Archives are fetched from the GitHub release `desktop-v<version>` of
   this repository (`OMNI_COMPONENTS_BASE_URL` at build time overrides the location baked into
   the catalog; at run time it overrides it for testing/mirrors — the SHA-256 pins still apply).
4. **Engine.** If the Local Engine component is installed, Electron starts
   `omni_local_server.py` with that runtime only (never a host Python), on `127.0.0.1` with
   `OMNI_NO_BROWSER=1`, a free port, `PYTHONPATH` = the libraries component (if installed),
   `OMNI_TOOL_RESOLUTION=bundled`, and a `PATH` limited to component directories plus OS system
   directories, so nothing installed elsewhere on the machine can stand in for a component. If it
   is not installed, the app opens the UI directly in browser-only mode (no error). If it is
   installed but fails, the user sees an error dialog with the reason and
   `<userData>/logs/local-engine.log`, and the UI opens in a clearly degraded mode.
5. **Truthful readiness.** A tool is *ready* only if its version command executes from the
   installed component (`probe_native_tool`); a tool whose component is not installed is shown
   as *Component not installed*. Python packages are verified by importing them, offline assets
   by SHA-256. `/api/health` reports `tool_groups`, `offline_assets` and `python_executable`.

## 2. Building

```bash
npm ci
npm run desktop:make      # = node scripts/desktop_build.cjs make
```

The same command runs locally and in CI. `scripts/stage_desktop_bundle.py` (inputs pinned in
`scripts/desktop_bundle_sources.json`):

1. stages the base (`build/omni-engine/`, offline assets verified against
   `offline_assets_manifest.json`);
2. builds every component into `build/components/<platform>/<id>/`:
   - downloads are verified against pinned SHA-256/SHA-512 digests before use (with listed
     official mirrors tried in order; a mismatching mirror is rejected) and cached in
     `.desktop-cache/` (or `$OMNI_DESKTOP_CACHE`);
   - package-manager binaries (Homebrew on macOS, Ubuntu 24.04 apt on Linux, MSYS2 on Windows
     for librsvg) are *relocated* by `scripts/desktop_relocate.py`: the binary and its whole
     non-system shared-library closure are copied into the component and references rewritten
     (Mach-O `@loader_path` + ad-hoc re-signing; ELF `$ORIGIN` RUNPATHs with glibc/GPU libraries
     left to the host and declared as `.deb`/`.rpm` dependencies; Windows DLLs next to the exe);
     ImageMagick modules/config, Ghostscript resources and a user-cache fontconfig are included;
   - the libraries component is `pip install --target` into the pinned runtime; wheel libraries
     that point at the build host are bundled, stale absolute rpaths left by upstream wheel
     builders are removed;
   - every tool is executed from its component with a sanitized environment, every required
     Python package is imported, and the component is audited for build-machine references;
3. packs `out/components/<platform>/<id>-<platform>.tar.gz` and writes the catalog.

It exits non-zero if any component fails, and `electron/forge.config.cjs` refuses to package
unless the base and every component were built for the platform/arch being packaged.
`--engine-only` (base only) and `--only <id>` exist for fast development loops; they are marked
incomplete and cannot be packaged.

Build-machine prerequisites (never needed by users):

- **macOS:** `brew install ffmpeg qpdf poppler imagemagick librsvg ghostscript tesseract pandoc sevenzip`
- **Ubuntu 24.04:** `sudo apt-get install dpkg fakeroot rpm patchelf ffmpeg qpdf poppler-utils imagemagick librsvg2-bin ghostscript tesseract-ocr pandoc 7zip`
- **Windows:** MSYS2 with `pacman -S mingw-w64-ucrt-x86_64-librsvg` (`OMNI_MSYS2_ROOT` if not `C:\msys64`)
- Python 3.10+ and Node.js 22.

Installer outputs (`out/make/`): Windows Squirrel `OmniConverter-Studio-Setup.exe` (+ `.nupkg`,
`RELEASES`, MSI deployment tool) and `.zip`; macOS `.dmg` and `.zip`; Linux `.deb`, `.rpm`, `.zip`.
Component archives: `out/components/<platform>/`.

## 3. Clean-environment smoke test

`scripts/smoke_test_desktop.py` (`npm run desktop:smoke -- <args>`) installs the real installer
(DMG copied to a fresh folder, Squirrel `Setup.exe --silent`, or an installed `.deb`/`.rpm`),
launches the real executable with a scrubbed environment (fresh home/AppData, `PATH` = OS system
directories, no `PYTHON*` variables, `OMNI_USER_DATA_DIR` = a fresh folder) and checks two modes:

- **base:** browser-only mode opens, 41/41 offline assets verify, the Local Engine and every tool
  are reported *not installed* (never ready).
- **full:** the app's own Component Manager installs every component from the built archives
  (served on a local HTTP server, verified against the installer's catalog); then the engine must
  start from the component runtime, pass `/healthz` and `/api/health`, load the engine UI with
  `OMNI_TOKEN`, serve vendor assets, and its verifier must import every required package and run
  every required tool from the installed components. Installed components are audited for
  build-machine references and every tool performs a real conversion (Ghostscript PS→PDF/PNG,
  pdftotext, pdftoppm, qpdf, Tesseract OCR, ImageMagick, rsvg-convert, FFmpeg/FFprobe, Pandoc,
  7-Zip, LibreOffice TXT→PDF, Calibre TXT→EPUB, yt-dlp).

Screenshots of the studio window and the Component Manager are written next to the report.

```bash
python3 scripts/smoke_test_desktop.py --installer 'out/make/*.dmg' --hide /opt/homebrew --hide /usr/local
python scripts/smoke_test_desktop.py --installer 'out/make/squirrel.windows/x64/*Setup.exe'
xvfb-run -a <python> scripts/smoke_test_desktop.py --app /usr/lib/omni-converter-studio   # after apt/dnf install
```

`.github/workflows/desktop-installers.yml` runs both modes on every build: the DMG on macOS with
the Homebrew prefix moved away and denied via `sandbox-exec`, Squirrel on Windows, and the
`.deb`/`.rpm` inside fresh `ubuntu:24.04`/`fedora:42` containers (no tools or Python installed;
the harness itself runs on the `python-runtime` component archive, outside the app).

## 4. Downloading CI builds

Per OS, each run uploads `omni-desktop-<platform>-installers` (`out/make/`),
`omni-desktop-<platform>-components` (archives + catalog) and
`omni-desktop-<platform>-smoke-reports` (reports, screenshots, staging manifest), kept 30 days:

```bash
gh run download <run-id> --repo theraghavraman/omni_suite_light --name omni-desktop-darwin-arm64-installers
```

On a `v<version>` tag matching `package.json`, the `publish-components` job uploads all component
archives (plus `catalog-<platform>.json` and `SHA256SUMS`) to the release `desktop-v<version>`,
the location the installers download from. **Installers built without that release (e.g. from
`workflow_dispatch`) open and work in browser-only mode, but their Component Manager downloads
fail until the release exists.**

## 5. Supported targets and limits

| Target | Built in CI | Clean-install smoke tested |
| --- | --- | --- |
| macOS arm64 | yes (`macos-15`) | yes (DMG, base + full) |
| Windows x64 | yes (`windows-2025`) | yes (Squirrel, base + full) |
| Linux x64 | yes (`ubuntu-24.04`) | yes (`.deb` on Ubuntu 24.04, `.rpm` on Fedora 42, base + full) |
| macOS x64 (Intel) | pins present, not built or tested | no |
| Linux arm64, Windows arm64 | not supported (the stager refuses these platforms) | no |

- Linux tool components are relocated from Ubuntu 24.04 packages and need glibc ≥ 2.39. The
  graphics/X/CUPS/D-Bus host libraries LibreOffice and Calibre expect are declared as
  `.deb`/`.rpm` dependencies; the `.zip` build assumes they are present.
- On Linux, ImageMagick keeps Ubuntu's restrictive `policy.xml` (PDF/PS coders disabled).
- mysql-connector-python's optional FIDO2 and Kerberos authentication plugins ship without the
  libraries they reference (upstream wheel); those two MySQL auth methods are not available.

## 6. Signing and notarization

Builds are unsigned by default.

- **macOS:** sign with a Developer ID Application certificate and notarize (set the variables
  below before `npm run desktop:make`). Because components are downloaded after installation,
  every Mach-O in the **component archives** (relocated tools are ad-hoc signed today; LibreOffice
  and Calibre keep their vendors' signatures) must also be signed with that identity (and the
  archives re-hashed into the catalog) for Gatekeeper/notarization to accept them. Unsigned
  installers are blocked by Gatekeeper until the user allows them (Finder → Open, or System
  Settings → Privacy & Security).

  ```bash
  export OMNI_MAC_SIGN=1
  export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
  export APPLE_ID="you@example.com" APPLE_PASSWORD="app-specific-password" APPLE_TEAM_ID="TEAMID"
  npm run desktop:make
  ```
- **Windows:** `Setup.exe`, the app and component executables are not Authenticode-signed, so
  SmartScreen warns. Configure `certificateFile`/`certificatePassword` (or a signing service) for
  `@electron-forge/maker-squirrel` and sign the component executables.
- **Linux:** `.deb`/`.rpm` are unsigned; sign them or publish through a signed repository.

## 7. Licensing

Components redistribute third-party software under their own licenses (LibreOffice MPL-2.0,
Calibre GPL-3.0, Ghostscript AGPL-3.0, FFmpeg GPL builds, Poppler GPL, Pandoc GPL, ImageMagick,
Tesseract Apache-2.0, ...). Each component carries upstream license files and a generated
`licenses/BUNDLED_COMPONENTS.md`; see `THIRD_PARTY_NOTICES.md`. Meet the source-offer obligations
of the GPL/AGPL components when publishing the component archives.

## 8. Security verification & release gates

```bash
npm run desktop:verify
python3 .github/scripts/local_engine_security_test.py
node tests/test_security_browser.cjs
node tests/test_desktop_shell.cjs
node .github/scripts/studio_wiring_check.mjs
npm audit --audit-level=low
```

As documented in `SECURITY_REMEDIATION_STATUS.md`, these operations stay intentionally disabled
(fail-closed, `HTTP 503`) even when the tools they would use are installed: `code_execute` (no
isolated sandbox), `archive_extract` for 7z/RAR (no isolated extractor), and unverified LAN file
transfer (no TLS device pairing).
