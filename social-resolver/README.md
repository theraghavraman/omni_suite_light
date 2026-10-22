# Omni Social Resolver

Remote resolver for Omni Suite Social Media Studio.

The GitHub Pages application sends only a public URL to this service, receives media metadata, and the browser initiates the download. No platform login, cookies, credential harvesting, private-account access, DRM bypass, or anti-bot circumvention is implemented.

## Deploy on Render

Create a new Render Blueprint using the repository and select the Blueprint path:

`social-resolver/render.yaml`

The Blueprint creates a Docker web service named `omni-social-resolver`. After deployment, Render provides an HTTPS `onrender.com` URL. Put that URL in `social_resolver_config.js` in the main Omni Suite repository.

The resolver exposes:

- `GET /api/health`
- `POST /api/resolve` with JSON `{"url":"https://..." }`
- `GET /api/download?url=...&quality=1080p`

Only supported public-platform hostnames are accepted.

## Limits and abuse controls

The default maximum media duration is 15 minutes and the maximum generated file size is 300 MB. These are deliberately conservative for a public resolver.

Every request is rate limited per client IP: `RATE_LIMIT_PER_MINUTE` (default 20) requests per 60 seconds, applied to all endpoints. This is the main protection against the service being used as an open download proxy.

Set `SOCIAL_TOKEN` on the Render service to require a token on `POST /api/resolve` (the heavy metadata step). When set, callers must send it as the `X-Omni-Social-Token` header; paste the same value into `window.OMNI_SOCIAL_RESOLVER_TOKEN` in `social_resolver_config.js`. Because that value ships in the public page it is not a real secret — it is a gate you can rotate (change it on the service and in the config to cut off abuse). The `media-proxy` and `download` URLs are loaded as `<img>`/`<video>`/`<a>` sources, which cannot carry a custom header, so they are protected by the rate limit and the host allow-lists rather than the token. Leaving `SOCIAL_TOKEN` unset keeps the resolver open (rate limited only), matching the previous behaviour.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGIN` | `https://theraghavraman.github.io` | CORS origin allowed to call the service from a browser. |
| `SOCIAL_TOKEN` | _(unset)_ | If set, required as `X-Omni-Social-Token` on `/api/resolve`. |
| `RATE_LIMIT_PER_MINUTE` | `20` | Per-IP request budget per 60s across all endpoints. |
| `MAX_DURATION` | `900` | Maximum media duration in seconds. |
| `MAX_DOWNLOAD_MB` | `300` | Maximum generated file size. |
