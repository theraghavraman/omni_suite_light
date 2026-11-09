# Security remediation status

## Desktop Installer & Local Engine Release Posture

- **Standalone Desktop Application (`electron/` + Local Engine): VERIFIED FOR LOCAL OFFLINE DISTRIBUTION.**
  - All local engine, static file serving, loopback origin/Host validation, database path confinement, browser deck/CSV/XML/JSZip budget controls, and SHA-256 offline asset verification findings (`SEC-001` through `SEC-007`, `SEC-018`, `SEC-019`, `SEC-023`, `SEC-025` through `SEC-029`, `SEC-032`, `SEC-034` through `SEC-039`) are **VERIFIED** via automated unit and integration suites (`tests/test_security_primitives.py`, `tests/test_data_engine_limits.py`, `tests/test_desktop_packaging.py`, `tests/test_security_browser.cjs`, `.github/scripts/local_engine_security_test.py`, and `.github/scripts/build_public.py`).
  - Features requiring multi-tenant cloud infrastructure, remote social media resolvers, arbitrary code execution sandboxes, 7z/RAR extraction isolation, or LAN transfer TLS pairing (`SEC-008` through `SEC-017`, `SEC-020` through `SEC-022`) are **intentionally disabled (fail-closed with HTTP 503)** in the Local Engine and Desktop build so that no unsafe execution path is reachable in distributed desktop installers.
- **Multi-Tenant Hosted Cloud / Social Services: BLOCKED.**
  - Re-enabling hosted cloud/social APIs or arbitrary code execution remains blocked until rootless sandboxing (`SEC-008`/`SEC-009`), distributed quota/queue backends (`SEC-010`/`SEC-013`/`SEC-014`/`SEC-016`), and LAN TLS pairing (`SEC-021`/`SEC-022`) are deployed.

See `VERIFICATION_LOG.md` and `REMEDIATION_TRACKER_V2.csv` for test execution logs and evidence.

| ID | Priority | Status | Change / verification evidence |
|---|---|---|---|
| SEC-001 | High | **VERIFIED (LOCAL/DESKTOP)** | Local Engine no longer returns its process token; browser access accepts only the local UI origin (`127.0.0.1`/`localhost`); verified in `local_engine_security_test.py` and `test_desktop_packaging.py`. |
| SEC-002 | High | **VERIFIED (LOCAL/DESKTOP)** | Static serving uses a strict allowlist, rejects symlinks/traversal, and exposes only web assets and supported knowledge-base files; `build_public.py` enforces public tree leak checks. |
| SEC-003 | High | **VERIFIED (LOCAL/DESKTOP)** | PDF.js moved to verified `pdfjs-dist` 6.2.108 ESM main/worker, matching SHA-256 pins, async callers, scripting and eval disabled (`isEvalSupported: false`, `enableScripting: false`). |
| SEC-004 | High | **VERIFIED (LOCAL/DESKTOP)** | Deck import/render uses schema validation and safe image handling from `omni_security_browser.js` (`validateDeckDocument`, `isSafeImageDataUrl`); verified in `test_security_browser.cjs`. |
| SEC-005 | High | **VERIFIED (LOCAL/DESKTOP)** | Sanitizer failure now renders source as text rather than restoring unsanitized HTML (`sanitizeRichHtml`); verified in `test_security_browser.cjs`. |
| SEC-006 | High | **VERIFIED (LOCAL/DESKTOP)** | SQLite access is read-only (`mode=ro`) with confined paths (`OMNI_ALLOWED_SQLITE_DIR`); remote database connections fail closed (`SEC-006`/`SEC-007`); verified in `test_desktop_packaging.py` and `local_engine_security_test.py`. |
| SEC-007 | High | **VERIFIED (LOCAL/DESKTOP)** | Remote DB hosts are opt-in and SQLite paths are confined to a configured directory; Electron sets `OMNI_ALLOWED_SQLITE_DIR` to the user's `Documents` directory by default. |
| SEC-008 | Critical | **FAIL-CLOSED (HTTP 503)** | Browser and Local Engine code execution (`code_execute`) are disabled and return HTTP 503 (`local_engine_security_test.py`). |
| SEC-009 | Medium | **FAIL-CLOSED (DISABLED)** | Browser Worker execution was removed and its UI is disabled pending a network-isolated sandbox. |
| SEC-010 | High | **FAIL-CLOSED (HTTP 503)** | Live ASGI checks confirm Social Resolver processing routes fail closed with HTTP 503 (`social_security_test.py`); not bundled in desktop builds. |
| SEC-011 | High | **FAIL-CLOSED (HTTP 503)** | Social processing is disabled; bounded redirect/DNS-pinned HTTPS helper is verified in `test_security_primitives.py`. |
| SEC-012 | High | **VERIFIED (LOCAL/DESKTOP)** | Temporary media files use private storage (`0o700`) and response cleanup paths; processing routes remain disabled in social service. |
| SEC-013 | High | **FAIL-CLOSED (HTTP 503)** | Caller-supplied `X-Forwarded-For` trust was removed and in-memory counters are bounded (`test_security_primitives.py`); hosted cloud/social routes remain disabled. |
| SEC-014 | Medium | **FAIL-CLOSED (HTTP 503)** | Live runtime checks confirm cloud processing routes fail closed with HTTP 503 (`cloud_security_test.py`); not bundled in desktop builds. |
| SEC-015 | Medium | **FAIL-CLOSED (HTTP 503)** | Cloud processing is disabled; option and filename handling remain gated behind HTTP 503. |
| SEC-016 | High | **FAIL-CLOSED (HTTP 503)** | Cloud processing is disabled pending isolated workers and resource quotas. |
| SEC-017 | Medium | **FAIL-CLOSED (HTTP 503)** | Runtime checks confirm the cloud capabilities API offers no operations and cloud processing fails closed. |
| SEC-018 | High | **VERIFIED (LOCAL/DESKTOP)** | Local uploads use a private temporary root (`0o700`), bounded upload sizes/quotas (`MAX_MULTIPART_BYTES`), and concurrency slots; verified in `local_engine_security_test.py`. |
| SEC-019 | Medium | **VERIFIED (LOCAL/DESKTOP)** | Local streamed uploads write to unique temporary files and atomically replace final paths; failures clean partials (`test_security_primitives.py`). |
| SEC-020 | High | **FAIL-CLOSED (HTTP 503)** | 7z/RAR archive extraction (`archive_extract`) is refused with HTTP 503 until an isolated, resource-limited extractor exists (`local_engine_security_test.py`). |
| SEC-021 | High | **FAIL-CLOSED (HTTP 503)** | LAN transfer startup (`/api/transfer/start`) is disabled with HTTP 503 pending TLS-authenticated pairing (`local_engine_security_test.py`). |
| SEC-022 | High | **FAIL-CLOSED (HTTP 503)** | LAN uploads/downloads are disabled with transfer startup; pathname race is unreachable through the disabled feature. |
| SEC-023 | Medium | **VERIFIED (LOCAL/DESKTOP)** | `js-yaml` upgraded to 4.1.1 in browser and offline asset definitions (`vendor/asset-sha256.json`). |
| SEC-024 | High | **PARTIAL / OFFLINE PINNED** | All 41 static core libraries and offline bundle assets in `vendor/asset-sha256.json` are verified by SHA-256 during `scripts/stage_desktop_bundle.py`; optional CDN model imports remain disabled offline. |
| SEC-025 | High | **VERIFIED (LOCAL/DESKTOP)** | Scientific metadata profiling avoids loading array values; conversion enforces per-array, aggregate, and metadata byte caps and rejects unsupported variable-length arrays (`test_data_engine_limits.py`). |
| SEC-026 | Medium | **VERIFIED (LOCAL/DESKTOP)** | CSV/TSV exports escape spreadsheet-formula prefixes (`=`, `+`, `-`, `@`, tab/CR/LF) across browser (`test_security_browser.cjs`) and Python (`test_security_primitives.py`). |
| SEC-027 | High | **VERIFIED (LOCAL/DESKTOP)** | `installZipBudget(JSZip)` enforces compressed input (`100 MB`), entry count (`2,500`), per-entry (`60 MB`), and cumulative (`250 MB`) decompressed byte budgets on both metadata and `entry.async(...)` extraction streams (`test_security_browser.cjs`). |
| SEC-028 | Medium | **VERIFIED (LOCAL/DESKTOP)** | XML export sanitizes element names (`safeXmlTagName`) and escapes values (`escapeXmlText`); verified in `test_security_browser.cjs`. |
| SEC-029 | High | **VERIFIED (LOCAL/DESKTOP)** | Offline assets are checked against committed SHA-256 pins (`prepare_offline.py`) before atomic installation and during desktop bundle staging (`scripts/stage_desktop_bundle.py`). |
| SEC-030 | Medium | **FAIL-CLOSED (OFFLINE)** | Remote Git-sourced model artifact downloads are not invoked by the offline desktop bundle. |
| SEC-031 | High | **VERIFIED (DESKTOP BUNDLE)** | Desktop installers package Python and native tools directly via `scripts/stage_desktop_bundle.py` and Electron Forge without remote shell script bootstrapping or elevated package-manager prompts. |
| SEC-032 | High | **VERIFIED (LOCAL/DESKTOP)** | Secret-free `/healthz` and `/api/health` probes are verified (`local_engine_security_test.py`, `test_desktop_packaging.py`) and never disclose bearer credentials. |
| SEC-033 | Medium | **VERIFIED (CONTAINER)** | Main and cloud containers use non-root users; cloud Docker context path was corrected. |
| SEC-034 | Medium | **VERIFIED (LOCAL/DESKTOP)** | Local/cloud/social API responses add `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and `Cache-Control: no-store` (`local_engine_security_test.py`). |
| SEC-035 | Medium | **VERIFIED (LOCAL/DESKTOP)** | Cloud/social token inputs and browser persistence were removed; GitHub browser writes are disabled and stale browser token keys are cleared (`clearPersistedSecretKeys` in `test_security_browser.cjs`). |
| SEC-036 | Medium | **VERIFIED (LOCAL/DESKTOP)** | Media URL and metadata values are retained as paired records during filtering and presentation (`pairMediaItems` in `test_security_browser.cjs`). |
| SEC-037 | Medium | **VERIFIED (CI)** | GitHub Actions references across `.github/workflows/local-engine-check.yml`, `security-verification.yml`, `deploy-pages.yml`, and `desktop-installers.yml` are pinned to commit SHAs. |
| SEC-038 | Medium | **VERIFIED (CI/BUILD)** | `.github/scripts/build_public.py` builds an explicit `dist/` allowlist and blocks server/desktop packaging files (`main.cjs`, `preload.cjs`, `forge.config.cjs`, `.py`, `.ps1`, `.bat`, `.command`). |
| SEC-039 | Medium | **VERIFIED (LOCAL/DESKTOP)** | Local Host authority parsing uses the shared IPv4/IPv6 loopback parser and exact configured port validation (`is_loopback_host_header` in `test_security_primitives.py` and `local_engine_security_test.py`). |
| SEC-040 | Medium | **FAIL-CLOSED (LOCAL/DESKTOP)** | Cloud/social uploads and public remote resolver work are disabled; desktop app runs against `127.0.0.1` loopback with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. |

Base handoff SHA-256: `acf1893414b806072a318cdf5b663183372050b18a0dacfc51d80787170fbf44`.

Source revision before changes: `079464f4f2e4926028886586f498544ed0c64177`. Target branch: `main`.

## Closure criteria

1. **Desktop & Local Engine Distribution**: All active local/browser controls (`SEC-001`..`SEC-007`, `SEC-018`..`SEC-019`, `SEC-023`, `SEC-025`..`SEC-029`, `SEC-031`..`SEC-032`, `SEC-034`..`SEC-039`) pass automated verification, and high-risk remote/sandbox features (`SEC-008`..`SEC-017`, `SEC-020`..`SEC-022`) fail closed with HTTP 503.
2. **Hosted Cloud / Social Reactivation**: Disabled features (`SEC-008`..`SEC-017`, `SEC-020`..`SEC-022`, `SEC-030`, `SEC-040`) remain fail-closed until their isolated sandbox and distributed quota architectures are deployed and verified.
