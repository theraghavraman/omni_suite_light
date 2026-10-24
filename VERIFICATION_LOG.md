# Verification log

## Execution environment

- Local test pass: 2026-10-24, macOS with Python 3.14.8 and Node.js.
- The repository CI matrix targets Python 3.13 on Ubuntu, Windows, and macOS. Those hosted jobs were not run as part of this local verification.

## Passed locally

- Python compile checks for the Local Engine, shared helpers, Cloud Engine, Social Resolver, and scripts; Node syntax checks for the CI JavaScript list and module worker.
- `python3 -m unittest discover -s tests -v`: 7 shared security primitive tests passed.
- `node tests/test_security_browser.cjs`: browser security helper regressions passed for deck data, sanitizer fallback, poison keys, CSV/XML encoding, ZIP budgets, and media URL pairs.
- `.github/scripts/local_engine_security_test.py`: temporary-server HTTP checks passed for token-free health, origin rejection, static source/traversal denial, code execution and archive extraction disabled responses, CORS, and invalid token rejection.
- `.github/scripts/cloud_social_security_test.py`: Cloud Engine Flask checks and live Social Resolver ASGI checks passed. Health is available; cloud and social processing routes return HTTP 503; capabilities expose no cloud operations.
- `.github/scripts/environment_inventory_test.py`, `.github/scripts/omni_contract_audit.py`, `.github/scripts/studio_wiring_check.mjs`, and `.github/scripts/assistant_rag_regression.mjs` passed. Assistant retrieval covered 20 questions / 43 entries; guide retrieval covered 7 questions / 109 chunks.
- Python wheel build, installation in a clean temporary virtual environment, CLI `version` / `doctor`, and module imports passed.
- Native smoke suite passed for the operations available on this machine, including scientific/data readers, SQLite read-only access, document and media conversions, and privacy hashing. The ebook conversion step was skipped because local Calibre is not installed; CI treats missing Calibre as a failure.
- Dependency audit passed after upgrading Cloud Engine `pypdf` to 6.21.2. `pip-audit` reported no known vulnerabilities for the Cloud/Social requirements and the Social Resolver installed environment.
- Offline asset preparation verified 41 pinned assets; the knowledge-base manifest check passed. The curated Pages build contained 92 files and passed checks excluding source, test, hidden, config, and secret-like files from the public artifact.
- Custom local HTTP checks passed for health endpoints, remote/originless request denial, Python source and traversal denial, disabled execution/extraction, invalid-token denial, and CORS behavior.

## Findings fixed during testing

- Python 3.14 can expose a SQLite connection without `enable_load_extension`; the helper now calls the optional method only when present, while read-only mode and the SQL authorizer keep extension loading unavailable.
- The built wheel omitted `omni_security_primitives.py`; it is now included in the package module list.
- The native smoke harness incorrectly expected a bearer token in health output, used a literal `python` executable, and omitted its allowed SQLite test directory. The harness now matches token-free health, uses `sys.executable`, and configures the isolated test root.
- Social Resolver media and download routes passed an unsupported keyword to the fail-closed guard. The calls now use the guard API correctly, and live ASGI coverage exercises those routes.
- The dependency audit found three `pypdf` advisories at 6.21.1; 6.21.2 is the audited version now pinned.

## Not covered by this local pass

- Windows/Linux native execution, hosted GitHub Actions results, Docker/container isolation, Render deployment, or GitHub Pages deployment.
- Full browser end-to-end workflows, malicious PDF execution, deep ZIP-bomb behavior across every extraction caller, DNS rebinding/redirect attacks against a live resolver, or external-origin pairing.
- Production identity and authorization, distributed quotas, durable cloud queues, isolated code runners, archive workers, LAN TLS pairing, and the remaining model/runtime integrity and data-consent review.
- Calibre ebook conversion locally; it is required in CI and remains a CI result to collect.

## Release recommendation

**BLOCKED.** Local tests confirm selected security boundaries and basic regressions only. Disabled features remain blocked until their replacement architecture is deployed and the applicable integrated security and normal-use tests pass. The tracker statuses have not been promoted to PASS based on this partial local test pass.
