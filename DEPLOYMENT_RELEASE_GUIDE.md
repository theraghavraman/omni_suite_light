# Deployment and release guide

## Current release gate

**Do not approve a production release yet.** Review `SECURITY_REMEDIATION_STATUS.md`; unresolved critical/high findings and unrun application regressions remain. The cloud and social services must stay unavailable, and user code execution and LAN transfer must stay disabled.

## GitHub Pages

The Pages workflow now downloads browser dependencies with the committed SHA-256 pins, rebuilds the knowledge manifest, creates an explicit `dist/` allowlist, and uploads only `dist/`. Third-party GitHub Actions are referenced by commit SHA. Review the artifact contents and test public/offline runtime behavior before release.

## Local Engine

The engine remains loopback-bound. Keep it bound to `127.0.0.1`; use its local UI rather than the remote static page for privileged local operations. The health probe `/healthz` does not return credentials. Offline setup uses `offline_assets_manifest.json`; the installer refuses an asset whose bytes do not match its pinned hash.

## Render

Do not enable cloud/social processing by setting a token. The current APIs intentionally return 503. Re-enablement requires an OIDC/BFF, CSRF defense, subject-scoped permissions, shared persistent job state and quotas, private object storage, and isolated workers. Verify deployment health separately from processing readiness.

## Required before release

1. Review every changed file and inspect the final Pages artifact.
2. Run malicious-input and normal-feature regression cases for all changed paths.
3. Test Windows, macOS, Linux/container, local/offline hosting, and supported browsers.
4. Verify package/action pins, installer dependency locks, native parser resource limits, and rollback behavior.
5. Record independent security review and only then update blocked/unverified findings.

`VERIFICATION_LOG.md` records what was not run in this change set.
