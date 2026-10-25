# Privacy and data-flow map

| Workflow | Data location / destination | Current behavior |
|---|---|---|
| Browser conversion | User browser memory; browser download | Selected files are processed client-side where supported. Some browser engines/models are fetched from pinned or currently unverified remote module sources; see SEC-024/030/040. |
| Local Engine conversion | Browser to `127.0.0.1:8765`; private OS temporary directory; output returned to browser | Browser access is limited to the loopback UI origin. Local process token is not exposed to browser-readable health or HTML. Uploaded files are bounded and stored under a private temporary root. |
| Local RAG | Browser IndexedDB; optional user-triggered public GitHub repository reads; optional local model runtime | Browser GitHub writes and stored GitHub credentials are disabled. Remote model and repository data flows still need an explicit consent and retention review. |
| Cloud processing | Would send selected files to Render | Disabled; client submits no file or token and API routes fail closed. |
| Social resolver | Would send a public URL to a remote resolver/download service | Disabled; API routes fail closed. Do not configure a production resolver URL. |
| LAN transfer | Would expose a short-lived transfer endpoint to the local network | Disabled pending TLS-authenticated pairing and storage. |
| Public Pages | Browser downloads static files from GitHub Pages | Pages uploads an allowlisted `dist/` tree. It excludes Python sources, Docker definitions, tests, and repository metadata. |

The static UI cannot provide server-side response headers such as a complete CSP by itself. The security status records this limitation.
