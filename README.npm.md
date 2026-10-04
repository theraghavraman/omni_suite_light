# Omni Universal Data Studio

Browser-side data handling and visualization engine extracted from OmniConverter Studio.

## Included

- CSV / TSV parsing
- JSON / JSONL / NDJSON normalization
- GeoJSON / GPX / KML parsing
- Numeric-field visualization
- Geo visualization
- CSV / JSON / GeoJSON / SVG / PNG / WAV / WebM / HTML exports
- Text / Base64 / hexadecimal conversion
- Browser-first processing with no server dependency for supported formats

## Usage

This package is a browser asset rather than a Node.js server library. Install it from GitHub Packages and include the script in a browser application:

```html
<script src="./node_modules/@theraghavraman/omni-universal-data-studio/universal_data_studio.js"></script>
```

The script exposes `window.OMNI_UNIVERSAL_DATA` after initialization.

For formats that require native desktop tooling, use OmniConverter's Local Engine or the published container image.
