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

## Limits

The default maximum media duration is 15 minutes and the maximum generated file size is 300 MB. These are deliberately conservative for a public resolver.
