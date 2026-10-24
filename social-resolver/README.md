# Omni Social Resolver

## Disabled pending security infrastructure

The resolver container is intentionally fail-closed. `GET /api/health` reports service liveness; social URL resolution, media proxying, and downloads return HTTP 503 until the service has a per-user identity and authorization layer, shared quotas, signed media grants, and isolated workers.

Do not deploy this service for public processing or configure it as the Social Media Studio backend. `social_resolver_config.js` is intentionally empty. A token embedded in a static browser application would be public and would not provide user authentication.

Before re-enabling processing, implement and verify the requirements in `SECURITY_REMEDIATION_STATUS.md`: user-bound authorization on every route, distributed rate limits, bounded redirect-by-redirect DNS-pinned media fetching, private job storage and cleanup, and platform-level resource isolation. The current source contains pieces of the URL and response hardening, but they are not a substitute for those missing services.
