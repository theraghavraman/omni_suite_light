# Security remediation status

**Release recommendation: BLOCKED.** Critical and High findings remain blocked or unverified; the local test pass is not production certification. The supplied archive is an implementation specification. Security and normal-use regressions now run locally and are wired into GitHub Actions, but cross-platform runs, browser end-to-end coverage, and production architecture gates remain open. See `VERIFICATION_LOG.md` and `REMEDIATION_TRACKER_V2.csv` for evidence and residual risk.

| ID | Priority | Status | Change / remaining blocker |
|---|---|---|---|
| SEC-001 | High | **NOT VERIFIED** | Local Engine no longer returns its process token; browser access accepts only the local UI origin; remote-origin pairing is not implemented. |
| SEC-002 | High | **NOT VERIFIED** | Static serving uses a strict allowlist, rejects symlinks/traversal, and exposes only web assets and supported knowledge-base files. Pages now publishes dist/. |
| SEC-003 | High | **NOT VERIFIED** | PDF.js moved to verified pdfjs-dist 6.2.108 ESM main/worker, matching SHA-256 pins, async callers, scripting and eval disabled. |
| SEC-004 | High | **NOT VERIFIED** | Deck import/render uses schema validation and safe image handling from the browser security helper. |
| SEC-005 | High | **NOT VERIFIED** | Sanitizer failure now renders source as text rather than restoring unsanitized HTML. |
| SEC-006 | High | **NOT VERIFIED** | SQLite access is read-only with confined paths; remote database connections fail closed pending a read-only proxy. |
| SEC-007 | High | **NOT VERIFIED** | Remote DB hosts are opt-in and SQLite paths are confined to a configured directory; remote database access fails closed. |
| SEC-008 | Critical | **BLOCKED** | Browser and Local Engine code execution are disabled. A rootless, network-isolated, resource-limited runner is not present. |
| SEC-009 | Medium | **BLOCKED** | Browser Worker execution was removed and its UI is disabled pending a network-isolated sandbox. |
| SEC-010 | High | **BLOCKED** | Live ASGI checks confirm Social Resolver processing routes fail closed with HTTP 503; browser resolver configuration and credentials are disabled, while identity and quota architecture remains absent. |
| SEC-011 | High | **BLOCKED** | Social processing is disabled; bounded redirect/DNS-pinned HTTPS helper is present but not an enabled service path. |
| SEC-012 | High | **NOT VERIFIED** | Temporary media files use private storage and response cleanup paths; processing routes remain disabled. |
| SEC-013 | High | **BLOCKED** | Caller-supplied X-Forwarded-For trust was removed and in-memory counters are bounded, but shared distributed quotas are absent. |
| SEC-014 | Medium | **BLOCKED** | Live runtime checks confirm cloud processing routes fail closed with HTTP 503 pending a durable shared job queue and status store. |
| SEC-015 | Medium | **BLOCKED** | Cloud processing is disabled; option and filename handling still needs review before service reactivation. |
| SEC-016 | High | **BLOCKED** | Cloud processing is disabled pending isolated workers and resource quotas. |
| SEC-017 | Medium | **BLOCKED** | Runtime checks confirm the capabilities API offers no operations and cloud processing fails closed while placeholder operations are not offered as usable outputs. |
| SEC-018 | High | **NOT VERIFIED** | Local uploads use a private temporary root, bounded upload sizes/quotas and concurrency slots. |
| SEC-019 | Medium | **NOT VERIFIED** | Local streamed uploads write to unique temporary files and atomically replace final paths; failures clean partials. |
| SEC-020 | High | **BLOCKED** | 7z/RAR archive extraction is refused until an isolated, resource-limited extractor exists. |
| SEC-021 | High | **BLOCKED** | LAN transfer startup is disabled pending TLS-authenticated pairing and transfer sessions. |
| SEC-022 | High | **BLOCKED** | LAN uploads/downloads are disabled with transfer startup; pathname race is unreachable through the disabled feature. |
| SEC-023 | Medium | **NOT VERIFIED** | js-yaml upgraded to 4.1.1 in browser and offline asset definitions. |
| SEC-024 | High | **BLOCKED** | Static core libraries and on-demand vendor-loader dependencies use SRI/SHA-256 pins. Several ESM/CDN paths and transitive runtime/model imports still lack end-to-end integrity verification. |
| SEC-025 | High | **NOT VERIFIED** | Scientific readers apply shape/dtype limits, disable CDF conversion, and bound privacy-scan reads. Some tabular paths still materialize full datasets. |
| SEC-026 | Medium | **NOT VERIFIED** | CSV/TSV exports escape spreadsheet-formula prefixes in browser, local, and cloud code paths. |
| SEC-027 | High | **NOT VERIFIED** | A global JSZip load wrapper enforces compressed input, entry count, per-entry and aggregate metadata budgets. Decompressed streaming output limits are not enforced at every extraction call. |
| SEC-028 | Medium | **NOT VERIFIED** | XML export sanitizes element names and escapes values. |
| SEC-029 | High | **NOT VERIFIED** | Offline assets are checked against committed SHA-256 pins before atomic installation; existing files are re-verified. |
| SEC-030 | Medium | **BLOCKED** | Model snapshot and Git-sourced model artifact pins were not completed; model/runtime integrity and explicit data-transfer consent remain open. |
| SEC-031 | High | **NOT VERIFIED** | Installers no longer bootstrap package managers from remote shell scripts or request elevated package-manager runs. Python dependencies and native packages are not fully hash/version pinned. |
| SEC-032 | High | **NOT VERIFIED** | A secret-free /healthz probe is available; health payload no longer discloses bearer credentials. |
| SEC-033 | Medium | **NOT VERIFIED** | Main and cloud containers use non-root users; cloud Docker context path was corrected. Base images and several dependency versions remain mutable or unpinned. |
| SEC-034 | Medium | **NOT VERIFIED** | Local/cloud/social API responses add nosniff, frame, referrer, permissions and no-store headers where applicable. A strict CSP is not configured. |
| SEC-035 | Medium | **NOT VERIFIED** | Cloud/social token inputs and browser persistence were removed; GitHub browser writes are disabled and stale browser token keys are cleared. |
| SEC-036 | Medium | **NOT VERIFIED** | Media URL and metadata values are retained as paired records during filtering and presentation. |
| SEC-037 | Medium | **NOT VERIFIED** | GitHub Actions references are pinned to commit SHAs. Security suites were added and passed locally; hosted CI results are pending. |
| SEC-038 | Medium | **NOT VERIFIED** | GitHub Pages now builds an explicit dist/ allowlist and uploads only that curated tree; offline assets are hash checked before packaging. |
| SEC-039 | Medium | **NOT VERIFIED** | Local Host authority parsing uses the shared IPv4/IPv6 loopback parser and exact configured port validation. |
| SEC-040 | Medium | **BLOCKED** | Cloud/social uploads and public remote resolver work are disabled. Browser model runtimes and some user-initiated repository fetches still need a complete consent/data-flow review. |

Base handoff SHA-256: `acf1893414b806072a318cdf5b663183372050b18a0dacfc51d80787170fbf44`.

Source revision before changes: `d5b3c5b214140e71a76fb3380bc3a49a8b85ba13`. Current branch: `codex/omni-suite-remediation`.

## Closure criteria

A finding can move to PASS only after an integrated security regression and normal-use regression pass on applicable platforms, a review of the final diff, and a recorded result. Disabled features remain BLOCKED until their replacement architecture is deployed and tested.

The most important open release blockers are the missing code-execution sandbox (SEC-008/009), cloud/social identity and worker infrastructure (SEC-010/013/014/016), unaudited runtime module/model dependency paths (SEC-024/030/040), archive isolation (SEC-020), and LAN TLS transfer (SEC-021/022).
