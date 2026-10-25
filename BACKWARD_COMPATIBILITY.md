# Backward compatibility and configuration changes

## Intentional behavior changes

- Remote GitHub Pages pages can no longer pair with or authorize the Local Engine. Start the Local Engine's own loopback UI for native operations.
- Browser and Local Engine code execution are disabled until a verified rootless sandbox exists.
- Cloud and Social Resolver processing are disabled until user-bound authentication, shared quotas, and isolated workers are deployed.
- LAN file transfer and 7z/RAR extraction are disabled pending TLS transfer and isolated extraction services.
- GitHub writes from RAG Studio are disabled; stale browser token keys are cleared.
- `/api/health` no longer returns a bearer token. Browser UI calls use same-origin authorization; non-browser clients still use a process token when configured.
- PDF.js callers now await the verified ESM runtime. Offline assets must pass the committed SHA-256 manifest before use.

## Configuration

- `OMNI_CLOUD_TOKEN`, `SOCIAL_TOKEN`, and public browser token settings are removed from the shipped bridge configuration. Do not recreate these as browser secrets.
- `OMNI_ALLOWED_SQLITE_DIR` is needed for SQLite file access. Remote SQL remains unavailable pending a read-only proxy and destination controls.
- Local browser API access uses the loopback UI origin; no `ALLOWED_ORIGINS` remote site setting should be added to enable arbitrary hosted sites.

## Migration and rollback

Treat disabled features as service migrations, not temporary flags. To restore one, implement the missing identity, quotas, isolation, TLS, and tests first. Do not roll back to a version that returns bearer tokens to remote pages, runs arbitrary code, serves source files, or exposes open cloud/social endpoints.
