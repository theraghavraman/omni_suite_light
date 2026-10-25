# Verification log

## Execution environment

- Local test pass: 2026-10-25, macOS with Python 3.14.8 and Node.js.
- The repository CI matrix targets Python 3.13 on Ubuntu, Windows, and macOS. Its first hosted run exposed Windows test-fixture/diagnostic latency and pip-cache issues, plus an Ubuntu dependency-resolution conflict. Those CI harness issues were corrected in the follow-up; see the latest commit's Actions checks for the current hosted result.

## Passed locally

- Python compile checks for the Local Engine, shared helpers, Cloud Engine, Social Resolver, and scripts; Node syntax checks for the CI JavaScript list and module worker.
- `python3 -m unittest discover -s tests -v`: 13 tests passed (7 shared security primitive tests and 6 data-engine limit regressions).
- `node tests/test_security_browser.cjs`: browser security helper regressions passed for deck data, sanitizer fallback, poison keys, CSV/XML encoding, ZIP budgets, and media URL pairs.
- `.github/scripts/local_engine_security_test.py`: temporary-server HTTP checks passed for token-free health, origin rejection, static source/traversal denial, code execution and archive extraction disabled responses, CORS, and invalid token rejection.
- `.github/scripts/cloud_social_security_test.py`: Cloud Engine Flask checks and live Social Resolver ASGI checks passed. Health is available; cloud and social processing routes return HTTP 503; capabilities expose no cloud operations.
- `.github/scripts/environment_inventory_test.py`, `.github/scripts/omni_contract_audit.py`, `.github/scripts/studio_wiring_check.mjs`, and `.github/scripts/assistant_rag_regression.mjs` passed. Assistant retrieval covered 20 questions / 43 entries; guide retrieval covered 7 questions / 109 chunks.
- Python wheel build, installation in a clean temporary virtual environment, CLI `version` / `doctor`, and module imports passed.
- Native smoke suite passed for the operations available on this machine, including scientific/data readers, SQLite read-only access, document and media conversions, and privacy hashing. The ebook conversion step was skipped because local Calibre is not installed; CI treats missing Calibre as a failure.
- Dependency audit passed after upgrading Cloud Engine `pypdf` to 6.21.2. `pip-audit` reported no known vulnerabilities for the Cloud/Social requirements and the Social Resolver installed environment.
- Offline asset preparation verified 41 pinned assets; the knowledge-base manifest check passed. The curated Pages build contained 92 files and passed checks excluding source, test, hidden, config, and secret-like files from the public artifact.
- Custom local HTTP checks passed for health endpoints, remote/originless request denial, Python source and traversal denial, disabled execution/extraction, invalid-token denial, and CORS behavior.
- The new Data Engine limit regressions passed for scientific per-array/aggregate byte caps, bounded metadata, metadata-only scientific profiles, bounded BLOB reads/round-trips, text line-count limits, and spreadsheet formula neutralization in text-to-CSV.
- The expanded native smoke test passed the Data Studio CSV/Parquet/XLSX paths, data round-trips, and scientific NetCDF profile plus JSON/CSV/PNG/HDF5/FITS conversions, using `requirements-data.txt` in the temporary test environment. Calibre ebook conversion was skipped because `ebook-convert` is not installed locally; CI requires it.
- `python3 -m py_compile` for the Local Engine, Cloud Engine, Social Resolver and helpers; `python .github/scripts/omni_contract_audit.py`; and `git -c core.whitespace=cr-at-eol diff --check` passed after the Data Engine changes. Browser, Local Engine, Cloud/Social, environment inventory, studio wiring, assistant/RAG, and JavaScript syntax checks also passed.

## Latest hosted CI

- Commit `0738ecc4eeb85b5107fb30e5f175fe9b12ae243a`: Validate OmniConverter passed on Windows, macOS, and Ubuntu. The first run on the preceding commit caught an optional-NumPy import in primitive metadata formatting; the follow-up made NumPy optional and added a regression that simulates it being unavailable.
- Hybrid RAG validation, GitHub Pages deployment, and container build/publish also passed for that commit.

## Findings fixed during testing

- Python 3.14 can expose a SQLite connection without `enable_load_extension`; the helper now calls the optional method only when present, while read-only mode and the SQL authorizer keep extension loading unavailable.
- The built wheel omitted `omni_security_primitives.py`; it is now included in the package module list.
- The native smoke harness incorrectly expected a bearer token in health output, used a literal `python` executable, and omitted its allowed SQLite test directory. The harness now matches token-free health, uses `sys.executable`, and configures the isolated test root.
- Social Resolver media and download routes passed an unsupported keyword to the fail-closed guard. The calls now use the guard API correctly, and live ASGI coverage exercises those routes.
- Scientific metadata profiling previously fetched every array value. Profiles now read metadata only; scientific conversion checks per-array, aggregate, dtype, and metadata limits before materialization. Direct BLOB and text/log conversions enforce input and output limits, and text-to-CSV neutralizes spreadsheet formulas.
- The dependency audit found three `pypdf` advisories at 6.21.1; 6.21.2 is the audited version now pinned.
- The first hosted matrix run found that Windows SQLite fixtures must explicitly close connections, Windows API health diagnostics can exceed the HTTP regression timeout, and `setup-python` pip caching fails when no packages are installed on a runner. The Ubuntu service smoke dependencies also conflict with the optional full Local Engine environment when installed together. The tests now close fixtures, use the fast cross-platform health probe on Windows, remove the empty cache setup, and install Cloud/Social test dependencies in a dedicated Linux virtual environment.

## Not covered by this local pass

- Full Windows/Linux native execution beyond the hosted matrix's selected regression steps, Docker/container isolation, Render deployment, or GitHub Pages deployment.
- Full browser end-to-end workflows, malicious PDF execution, deep ZIP-bomb behavior across every extraction caller, DNS rebinding/redirect attacks against a live resolver, or external-origin pairing.
- Production identity and authorization, distributed quotas, durable cloud queues, isolated code runners, archive workers, LAN TLS pairing, and the remaining model/runtime integrity and data-consent review.
- Calibre ebook conversion locally; it is required in CI and remains a CI result to collect.
- Full resource bounds for tabular readers and all scientific output-expansion paths remain unverified; this change does not close SEC-025.

## Release recommendation

**BLOCKED.** Local tests confirm selected security boundaries and basic regressions only. Disabled features remain blocked until their replacement architecture is deployed and the applicable integrated security and normal-use tests pass. The tracker statuses have not been promoted to PASS based on this partial local test pass.
