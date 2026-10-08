# Redmark Forge — ONLYOFFICE Office Engine

Redmark Forge Office Tools now uses the open-source ONLYOFFICE Docs Community Edition as the actual document editor rather than attempting to recreate Word, Excel or PowerPoint in custom browser JavaScript.

## What this integration provides

- DOC/DOCX/DOCM/DOT/DOTX/DOTM and OpenDocument/RTF/text document editing
- XLS/XLSX/XLSM/XLSB/XLT/XLTX/XLTM and ODS/CSV/TSV spreadsheet editing
- PPT/PPTX/PPTM/PPS/PPSX/POT/POTX/POTM and ODP presentation editing
- PDF editor/viewer/form workflows supported by the installed Community build
- real document/spreadsheet/presentation ribbons and menus
- comments, review/track changes, printing, downloading, copy/paste, forms and spreadsheet filtering where supported
- co-editing architecture with shared document keys
- autosave + force-save
- Office conversion handled by the editor/core instead of the old hand-built PPTX writer
- plugins/macros hooks exposed by ONLYOFFICE
- browser embedding through the official Docs API
- Redmark Forge Notepad remains a separate lightweight arbitrary-extension text editor

## Architecture

1. Redmark Forge remains the GitHub Pages frontend.
2. omni-cloud-engine is the storage/callback bridge. It accepts an authenticated upload, gives ONLYOFFICE a short-lived signed file URL, signs the editor config with JWT, receives callbacks and stores the newest version.
3. redmark-office-docs is a separate ONLYOFFICE Docs Community service.
4. The browser embeds ONLYOFFICE's own DocsAPI.DocEditor UI.

This follows ONLYOFFICE's documented integration model: the editor receives a document URL/key, calls a callback URL when a version is saved, and uses a signed JWT when JWT validation is enabled.

## Required Render environment on omni-cloud-engine

- ONLYOFFICE_URL=https://<your-office-docs-service>
- OFFICE_JWT_SECRET=<same secret used by ONLYOFFICE JWT_SECRET>
- OFFICE_STORAGE_SECRET=<separate random secret>
- CLOUD_PUBLIC_BASE=https://omni-cloud-engine.onrender.com
- existing OMNI_CLOUD_TOKEN remains required for uploads/force-save

## ONLYOFFICE service

Use the official Community Docker image via onlyoffice/Dockerfile and set:

- JWT_ENABLED=true
- JWT_SECRET=<same OFFICE_JWT_SECRET>
- JWT_HEADER=Authorization
- JWT_IN_BODY=false
- PLUGINS_ENABLED=true

The Render blueprint uses the 2c-4g plan because ONLYOFFICE documents a Docker recommendation of at least 4 GB RAM and dual-core CPU. The existing Redmark Forge cloud engine can remain on its current free plan.

## License

ONLYOFFICE Docs Community Edition is GNU AGPL v3.0. Redmark Forge must preserve the applicable AGPL obligations when distributing or modifying the Community Edition. Redmark Forge does not copy Google Docs source code.
