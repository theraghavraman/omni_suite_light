# Omni Suite remediation threat model

## Assets

- User-selected files and generated outputs.
- The Local Engine process, native conversion tools, and temporary workspace.
- Browser-held local indexes and language/model data.
- Optional remote GitHub content and third-party browser libraries.
- Future Render cloud/social jobs (currently disabled).

## Trust boundaries and actors

- The public static site is untrusted relative to the user's machine. It has no authority to authenticate to the Local Engine.
- The Local Engine listens on loopback and accepts browser operations only from its own loopback UI origin. Non-browser clients still require the process bearer token.
- Uploaded files, archives, Office decks, PDFs, SQL, and data documents are untrusted inputs to browser parsers and native tools.
- CDNs, model registries, GitHub content, and deployment actions are external supply-chain inputs.
- Render Cloud Engine and Social Resolver routes are not trusted for public processing and currently fail closed.

## Main abuse cases and controls

| Abuse case | Current control | Remaining gap |
|---|---|---|
| Public page reads Local Engine token or invokes privileged local API | Health response omits token; no token injection; remote browser Origin rejected | No scoped remote pairing; no regression proof |
| Static source disclosure | Public static path allowlist; Pages publishes curated `dist/` | Build artifact has not been inspected |
| Malicious PDF/deck/archive | PDF.js 6.2.108 ESM pinned; deck schema/sanitizer; archive extraction disabled; ZIP budgets | Malicious document regressions and ZIP post-decompression accounting remain |
| Arbitrary program execution | Browser and local execution actions disabled | Secure sandbox is not deployed |
| Cloud/social resource abuse | Processing routes disabled | OIDC/BFF, shared quotas/jobs, signed grants and isolated workers absent |
| Offline cache substitution | Static SHA-256 manifest, hash check before atomic install | Clean install/tampered cache verification not run |
| LAN interception | LAN transfer disabled | TLS authenticated service not implemented |
| Spreadsheet formula execution | Formula-safe CSV/TSV paths | Full export inventory and regression coverage remain |

## Residual risk

This patch is not production approval. Any remaining Critical/High `BLOCKED` or `NOT VERIFIED` items prevent release. Some browser model/runtime imports still use remote ESM dependency graphs without a complete integrity pin and consent audit. Temporary-file limits do not prove safety for every native parser or data-reader path.
