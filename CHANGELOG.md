# Changelog

All notable changes to Redmark Forge / Omni Suite are documented here.

This project follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
The platform version is shown in the home screen and is aligned with `package.json`.
Release tags should use the matching `vMAJOR.MINOR.PATCH` format.

## [1.0.0] - 2026-10-10

### Added
- Established a single visible platform release version, **1.0.0**, aligned with `package.json`.
- Added this changelog as the canonical user-facing release history.
- Wired the static Omni contract audit into GitHub Actions so it runs on pushes and pull requests.

### Platform
- Documented the platform capability layer under version 1.0.0 instead of the conflicting 0.5 label.
- Preserved the existing Local Engine contract, environment inventory checks, and conversion workflows.

### Validation
- CI now invokes `.github/scripts/omni_contract_audit.py` in the native-engine validation workflow.
- The audit's success still depends on the workflow run; adding the step does not itself prove the audit passes.
