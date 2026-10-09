# OmniConverter Studio — Architecture & Practical Guide

> A beginner-friendly handbook on how OmniConverter Studio, the conversion core of Omni Suite, turns files from one format into another without uploading them anywhere.
>
> **Scope:** this guide explains the *how* — browser engines, the Local Native Engine, file-format internals, offline setup, troubleshooting and licensing. For the full list of Studios and where to click, see the companion file `omni-suite.md` in this folder.

## Contents

1. [Core philosophy](#1-core-philosophy)
2. [Dual-engine architecture](#2-dual-engine-architecture)
3. [User interface layer](#3-user-interface-layer)
4. [PDF Suite](#4-pdf-suite)
5. [Word & documents](#5-word--documents)
6. [EPUB Studio](#6-epub-studio)
7. [Image tools & photo sizing](#7-image-tools--photo-sizing)
8. [OCR (image to text)](#8-ocr-image-to-text)
9. [Audio Studio](#9-audio-studio)
10. [Video Studio](#10-video-studio)
11. [Compression & archives](#11-compression--archives)
12. [Local Native Engine](#12-local-native-engine)
13. [Offline preparation](#13-offline-preparation)
14. [Launchers & install scripts](#14-launchers--install-scripts)
15. [Diagnostics & test lab](#15-diagnostics--test-lab)
16. [Browser internals deep dive](#16-browser-internals-deep-dive)
17. [Troubleshooting](#17-troubleshooting)
18. [Open-source licences](#18-open-source-licences)
19. [Glossary](#19-glossary)
20. [Hands-on learning path](#20-hands-on-learning-path)

### Quick reference

| I want to… | Where it happens | Engine |
|---|---|---|
| Merge, split or render PDF pages | PDF Suite | Browser (PDF.js + pdf-lib); qpdf / Poppler for very large jobs |
| Convert Word ↔ PDF | Office Studio | Browser for text; LibreOffice in the Local Engine for faithful layout |
| Convert EPUB ↔ PDF or images | EPUB Studio | Browser; Calibre for MOBI / AZW3 |
| Resize photos to passport / ID sizes | Image Tools | Browser (Canvas) |
| Extract text from images | Image to Text (OCR) | Tesseract.js; native Tesseract for complex layouts |
| Trim audio or export WAV | Audio Studio | Web Audio API |
| Trim video or grab a frame | Video Studio | MediaRecorder / Canvas; FFmpeg for MP4, MKV, MOV |
| Zip, GZIP or unzip files | Compressor | JSZip + CompressionStream |

---

## 1. Core philosophy

### Why cloud converters are a privacy risk

People convert tax forms, contracts, medical reports and family media every day. Most online converters require uploading those files, unencrypted, to someone else's server. That creates three risks:

1. **Transit risk** — data crosses public networks where a misconfigured or compromised proxy can capture it.
2. **Storage risk** — the file is written to a remote disk, and you have no technical proof it is ever deleted. It can be retained, logged or mined.
3. **Compliance risk** — sending health, financial or personal data to an unknown server can breach rules such as GDPR or HIPAA.

### The four design principles

| Principle | What it means in practice |
|---|---|
| **Client-side first** | Parsing, rendering and re-encoding run in the browser sandbox or on your own hardware. |
| **Zero server uploads** | File bytes stay in your device's memory and never travel to a remote endpoint. |
| **Privacy by design** | No tracking, analytics telemetry or cloud microservices. |
| **Fully offline capable** | After a one-time asset download, everything works with no internet, even on an air-gapped machine. |

### How the browser keeps files local

A web browser runs page scripts inside a **sandbox** that isolates them from the operating system. JavaScript cannot read or write your disk unless you explicitly pick a file or folder.

```text
HOST DEVICE
└── BROWSER SANDBOX
    └── JavaScript engine (V8 / SpiderMonkey / JavaScriptCore)
        [File picker] → [Local memory] → [Transcode] → [Blob / TypedArray] → [Download]
```

When you choose a file, the browser reads it into RAM through the `File` / `FileReader` APIs, producing `ArrayBuffer`, `Uint8Array` or `Blob` objects. Text extraction, rendering vector PDFs to bitmaps and resampling audio all happen on your CPU/GPU. The file never leaves the device.

---

## 2. Dual-engine architecture

### Overview

OmniConverter balances zero-install portability with native power by using two engines behind one interface.

```text
                    ┌──────────────────────┐
                    │    USER INTERFACE    │
                    │  (HTML / CSS / JS)   │
                    └──────────┬───────────┘
              ┌────────────────┴────────────────┐
              ▼                                 ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│ BROWSER MODE              │     │ LOCAL NATIVE ENGINE       │
│ (client-side sandbox)     │     │ (Python loopback server)  │
├───────────────────────────┤     ├───────────────────────────┤
│ • PDF.js / pdf-lib        │     │ • 127.0.0.1:8765          │
│ • Tesseract.js (WASM)     │     │ • FFmpeg, qpdf, Poppler   │
│ • Web Audio API / Canvas  │     │ • LibreOffice, Calibre    │
│ • Streams API / JSZip     │     │ • Tesseract, ImageMagick  │
└───────────────────────────┘     └───────────────────────────┘
```

### Engine 1 — Browser Mode

The default. Nothing to install; everything runs inside the browser tab.

- **PDF** — PDF.js renders pages; pdf-lib creates, edits, merges and splits PDF bytes.
- **OCR** — Tesseract.js runs the C++ Tesseract engine compiled to WebAssembly.
- **Audio** — the Web Audio API decodes compressed audio into raw `Float32` samples.
- **Images** — HTML5 Canvas handles scaling, cropping and format conversion.
- **Archives** — JSZip plus the native `CompressionStream` / `DecompressionStream`.

### Engine 2 — Local Native Engine

When a job outgrows the browser (proprietary codecs, very large files, heavy batches), OmniConverter routes it to the Local Native Engine: `omni_local_server.py`, a Python server bound to `127.0.0.1:8765` that drives native command-line tools.

| Tool | Command | Used for |
|---|---|---|
| FFmpeg | `ffmpeg` | Video/audio transcoding and stream demuxing |
| qpdf | `qpdf` | Lossless PDF optimisation, linearisation, merging, page splitting |
| Poppler | `pdftoppm`, `pdftotext` | Native PDF rendering and text extraction |
| LibreOffice | `soffice --headless` | Converting `.docx`, `.xlsx`, `.pptx` |
| Calibre | `ebook-convert` | eBook formats (`.epub`, `.mobi`, `.azw3`) |
| ImageMagick | `magick` | Colour-space work and raster manipulation |
| Tesseract | `tesseract` | Multi-threaded native OCR |

### Choosing an engine

| Criterion | Browser Mode | Local Native Engine |
|---|---|---|
| Setup | None — opens in the browser | Needs Python and the CLI tools |
| Memory | Limited by the tab's heap (≈2 GB) | Limited only by system RAM |
| Codecs | Browser codecs (VP8/VP9, WebP…) | Every installed codec (H.264, H.265, ProRes…) |
| Speed | Single-threaded or worker-bound WASM | Multi-threaded native C/C++ |
| Batch size | Light to medium | Multi-gigabyte, heavy batches |

### Local Engine security model

Because the engine exposes native tools over HTTP, every request passes four checks before anything runs.

```text
Inbound request
  │
  ├─ Host is not 127.0.0.1 / localhost ───────► 403 Forbidden
  ├─ Origin not on the allow-list ────────────► 403 Forbidden
  ├─ X-Omni-Token missing or wrong ───────────► 401 Unauthorized
  ▼
Run the tool (argument list, no shell)
```

1. **Loopback binding** — the converter API listens on `127.0.0.1`, so other machines on your network cannot reach it.
2. **Origin and Host validation** — requests from websites that are not on the allow-list are rejected with HTTP 403.
3. **Per-session token** — at start-up the server generates `secrets.token_hex(32)`. The page receives it and sends it back in the `X-Omni-Token` header; a missing or wrong token gets HTTP 401.
4. **No shell execution** — tools run via `subprocess.run([...])` with an argument list and `shell=False`, so a hostile filename cannot inject commands.

---

## 3. User interface layer

### Design tokens and glass cards

The interface uses CSS custom properties (design tokens) and semi-transparent "glass" cards over a soft gradient.

```css
:root {
  --font-main: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --bg-gradient: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  --glass-bg: rgba(255, 255, 255, 0.65);
  --glass-border: rgba(255, 255, 255, 0.4);
  --glass-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
}

.omni-studio-card {
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  border-radius: 12px;
  padding: 24px;
}

.omni-dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}
```

- **Glassmorphism** — `backdrop-filter: blur()` gives depth while keeping text readable.
- **Fluid layout** — CSS Grid with `auto-fill` / `minmax()` plus Flexbox adapts to any screen width.

### Drag-and-drop file input

```js
const dropZone = document.getElementById('omni-drop-zone');

// Stop the browser from opening the dropped file in the tab
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(type =>
  dropZone.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); })
);

// Highlight while a file hovers over the zone
['dragenter', 'dragover'].forEach(type =>
  dropZone.addEventListener(type, () => dropZone.classList.add('is-active'))
);
['dragleave', 'drop'].forEach(type =>
  dropZone.addEventListener(type, () => dropZone.classList.remove('is-active'))
);

dropZone.addEventListener('drop', e => handleIncomingFiles(e.dataTransfer.files));
```

`preventDefault()` stops the browser opening the file itself; `DataTransfer.files` hands over the dropped files.

### Mobile file-picker fallback

Drag-and-drop is impractical on phones, so tapping a drop zone opens the native picker. `showPicker()` is tried first, then a programmatic `click()`.

```js
function triggerFileSelection() {
  const input = document.getElementById('omni-hidden-file-input');
  if ('showPicker' in HTMLInputElement.prototype) {
    try { input.showPicker(); return; } catch (_) { /* fall through */ }
  }
  input.click();
}
```

---

## 4. PDF Suite

### How a PDF is built

A PDF is a set of numbered objects — vector drawing instructions, embedded fonts, image streams — plus a cross-reference (`xref`) table that says where each object lives. Positions use absolute coordinates in **points** (1 inch = 72 points), so a page looks identical everywhere.

```text
%PDF-1.7
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length 55 >> stream … vector drawing … endstream
xref
trailer << /Size 5 /Root 1 0 R >>
startxref 384
%%EOF
```

### PDF.js: main thread vs worker

PDF.js splits the work across two threads so the page stays responsive:

1. **Main thread** — UI, DOM updates and painting onto the `<canvas>`.
2. **Web Worker** — parsing the binary stream, reading the `xref` table, decoding embedded JPEG/JPEG 2000 images and font maps.

```js
pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.js';

async function loadPDFDocument(fileBuffer) {
  return pdfjsLib.getDocument({ data: fileBuffer }).promise;
}
```

### Opening very large PDFs without crashing

Reading a 2 GB PDF into one `ArrayBuffer` can exceed the browser's heap. A range transport lets PDF.js request only the byte ranges it needs, read on demand with `file.slice(begin, end)`.

```js
class OmniFileRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  constructor(file) {
    super(file.size, []);
    this.file = file;
  }
  requestDataRange(begin, end) {
    this.file.slice(begin, end).arrayBuffer()
      .then(bytes => this.onDataRange(begin, bytes));
  }
}
```

### Rendering pages to images at a chosen DPI

PDF space is 72 points per inch, so the render scale is:

**Scale factor = target DPI ÷ 72** (e.g. 300 DPI → scale 4.1667)

```js
async function renderPageToImage(page, targetDPI = 300, type = 'image/png') {
  const viewport = page.getViewport({ scale: targetDPI / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return new Promise(resolve => canvas.toBlob(resolve, type, 0.95));
}
```

### Merging and splitting with pdf-lib

```js
// Merge any number of PDFs
async function mergePDFs(buffers) {
  const merged = await PDFLib.PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFLib.PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  return merged.save(); // Uint8Array
}

// Keep only selected pages (0-based)
async function extractPages(buffer, keep = [0, 2]) {
  const src = await PDFLib.PDFDocument.load(buffer);
  const out = await PDFLib.PDFDocument.create();
  (await out.copyPages(src, keep)).forEach(p => out.addPage(p));
  return out.save();
}
```

---

## 5. Word & documents

### Inside a .docx file

A `.docx` is a ZIP archive of XML files (the OpenXML format):

```text
document.docx
├── [Content_Types].xml   declares the type of every part
├── _rels/.rels           top-level relationships
└── word/
    ├── document.xml      body text, paragraphs, tables
    ├── styles.xml        paragraph and character styles
    └── media/            embedded images
```

### Extracting text from a .docx

JSZip opens the archive; `DOMParser` reads the XML. Paragraphs are `<w:p>` elements and text runs are `<w:t>`.

```js
async function extractDocxText(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.getElementsByTagName('w:p')]
    .map(p => [...p.getElementsByTagName('w:t')].map(t => t.textContent).join(''))
    .join('\n');
}
```

### Word to PDF: wrapping lines

pdf-lib draws text exactly where told, so long paragraphs must be wrapped by measuring each word with the chosen font.

```js
function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(' ');
  const lines = [];
  let line = words[0] || '';
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, fontSize) < maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}
```

For layout-faithful Word → PDF (tables, headers, images), use the Local Engine, which runs LibreOffice: `soffice --headless --convert-to pdf input.docx`.

### PDF to Word: three reconstruction modes

| Mode | How it works | Strength | Trade-off |
|---|---|---|---|
| **Visual replica** | Each PDF page becomes a high-resolution background image | Looks exactly like the original | Text is not editable |
| **Reflowable text** | Extracted text rebuilt as normal `<w:p>` paragraphs | Fully editable | Layout may shift |
| **Hybrid** | Editable text placed over the page image | Editable text in roughly the right place | Larger file; can need tidying |

---

## 6. EPUB Studio

### Inside an .epub file

An EPUB is a small website (XHTML + CSS) packaged in a ZIP with a fixed layout:

```text
book.epub
├── mimetype                 "application/epub+zip" — first entry, uncompressed
├── META-INF/container.xml   points to the package (.opf) file
└── OEBPS/
    ├── content.opf          metadata, manifest of files, spine (reading order)
    ├── nav.xhtml            EPUB 3 navigation
    ├── toc.ncx              EPUB 2 legacy table of contents
    ├── Styles/style.css
    └── Text/ch1.xhtml, ch2.xhtml …
```

### Fixing "WinAnsi cannot encode" errors

The 14 standard PDF fonts (Helvetica, Times-Roman…) only support the single-byte **WinAnsi (Windows-1252)** character set. Tabs, smart quotes, non-breaking spaces or non-Latin text make pdf-lib throw. A sanitizer normalises the text first:

```js
function sanitizeForWinAnsi(text) {
  if (!text) return '';
  return text
    .replace(/[“”]/g, '"')   // curly double quotes
    .replace(/[‘’]/g, "'")   // curly single quotes
    .replace(/—/g, '--')          // em dash
    .replace(/–/g, '-')           // en dash
    .replace(/\t/g, '    ')            // tab → 4 spaces
    .replace(/ /g, ' ')           // non-breaking space
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ''); // drop anything WinAnsi can't encode
}
```

To keep non-Latin scripts (Hindi, Chinese…), embed a Unicode TTF font with `@pdf-lib/fontkit` instead of relying on the standard fonts.

### EPUB to PDF or page images

1. Read `META-INF/container.xml` to find `content.opf`.
2. Follow the **spine** in `content.opf` to get chapters in reading order.
3. Parse each XHTML chapter with `DOMParser` and take its text.
4. Run the text through `sanitizeForWinAnsi()`.
5. Wrap the lines and draw them to PDF pages (pdf-lib) or to canvases exported as JPG/PNG.

```js
function renderChapterToCanvas(xhtml, width = 600, height = 800) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  const text = sanitizeForWinAnsi(new DOMParser().parseFromString(xhtml, 'text/html').body.textContent || '');
  ctx.fillStyle = '#000'; ctx.font = '16px serif';
  ctx.fillText(text.slice(0, 1000), 40, 50); // real code wraps across many lines and pages
  return canvas;
}
```

### Building an EPUB 3 from scratch

```js
async function buildEpub3(title, chapterXHTML) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' }); // must be first

  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`);

  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Chapter 1</a></li></ol></nav></body></html>`);
  zip.file('OEBPS/ch1.xhtml', chapterXHTML);

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}
```

---

## 7. Image tools & photo sizing

### Fast image decoding

Decoding big photos through `<img>` on the main thread can make the page stutter. `createImageBitmap()` decodes asynchronously (often GPU-accelerated).

```js
async function toWebP(blob, quality = 0.85) {
  const bitmap = await createImageBitmap(blob);
  const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
}
```

### Aspect-ratio modes

| Mode | Behaviour | Use when |
|---|---|---|
| **Contain (fit)** | Whole image fits inside the target; empty space is padded (letterbox) | Nothing may be cut off |
| **Cover (crop)** | Image fills the target; overflow is centre-cropped | Exact size with no borders (ID photos, thumbnails) |
| **Stretch** | Forced to the exact width and height | Proportions don't matter |

### Converting millimetres to pixels

Screens count pixels; printed documents are measured in millimetres or inches.

**Pixels = (millimetres ÷ 25.4) × DPI**

```js
const mmToPx = (mm, dpi = 300) => Math.round((mm / 25.4) * dpi);
// 35 mm at 300 DPI → (35 / 25.4) × 300 = 413.38 → 413 px
```

### Photo size presets

| Preset | Physical size | DPI | Pixels (W × H) |
|---|---|---|---|
| Indian passport photo | 35 × 45 mm | 300 | 413 × 531 |
| 2 × 2 inch ID photo | 50.8 × 50.8 mm | 300 | 600 × 600 |
| Signature | 35 × 15 mm | 300 | 413 × 177 |

---

## 8. OCR (image to text)

### The OCR pipeline

```text
Raster image
  → Binarisation      convert to high-contrast black and white
  → Layout analysis   find text blocks, baselines and character boxes
  → Feature extraction  stroke shapes, loops, curves
  → Recognition       LSTM model matches features (.traineddata)
  → Unicode text
```

### Tesseract.js in the browser

Tesseract.js is the C++ Tesseract engine compiled to WebAssembly and run in a Web Worker, so recognition doesn't freeze the page.

```js
async function runOCR(image, lang = 'eng') {
  const worker = await Tesseract.createWorker(lang, 1, {
    workerPath: './vendor/tesseract/worker.min.js',
    corePath: './vendor/tesseract/core/',
    langPath: './vendor/tesseract/lang/',   // offline language models
    logger: m => console.log(`[OCR] ${m.status} ${Math.round(m.progress * 100)}%`)
  });
  const { data: { text } } = await worker.recognize(image);
  await worker.terminate(); // frees WASM memory
  return text;
}
```

### Supported languages

Bundled language models (`.traineddata.gz`) for offline use:

| Group | Languages (code) |
|---|---|
| Indian | Hindi (`hin`), Bengali (`ben`), Marathi (`mar`), Tamil (`tam`), Telugu (`tel`), Gujarati (`guj`), Punjabi (`pan`) |
| European | English (`eng`), German (`deu`), French (`fra`), Spanish (`spa`) |
| East Asian | Simplified Chinese (`chi_sim`) |

Combine codes with `+` for mixed documents, e.g. `eng+hin`.

---

## 9. Audio Studio

### Digital audio basics

| Term | Meaning | Typical value |
|---|---|---|
| Sample rate | Measurements per second | 44,100 Hz (CD) or 48,000 Hz (video) |
| Bit depth | Precision of each sample | 16-bit |
| Channels | Number of tracks | 1 = mono, 2 = stereo |
| PCM | Uncompressed sample values stored as numbers | Inside `.wav` files |

### Decoding audio files

```js
async function decodeAudio(arrayBuffer) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx.decodeAudioData(arrayBuffer); // AudioBuffer: Float32 samples in [-1, 1]
}
```

### Trimming and changing speed

`OfflineAudioContext` renders as fast as the CPU allows instead of in real time.

```js
async function renderTrimmed(buffer, startSec, endSec, rate = 1.0) {
  const duration = endSec - startSec;
  const ctx = new OfflineAudioContext(
    buffer.numberOfChannels,
    Math.ceil((duration * buffer.sampleRate) / rate),
    buffer.sampleRate
  );
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(ctx.destination);
  src.start(0, startSec, duration);
  return ctx.startRendering();
}
```

### WAV header layout

Browsers can't save raw PCM as `.wav` on their own, so OmniConverter writes the standard 44-byte RIFF WAV header itself. This is how the header is laid out:

| Bytes | Field | Value |
|---|---|---|
| 0–3 | Chunk ID | `"RIFF"` |
| 4–7 | Chunk size | file size − 8 |
| 8–11 | Format | `"WAVE"` |
| 12–15 | Sub-chunk 1 ID | `"fmt "` |
| 16–19 | Sub-chunk 1 size | 16 (PCM) |
| 20–21 | Audio format | 1 = uncompressed PCM |
| 22–23 | Channels | 1 or 2 |
| 24–27 | Sample rate | e.g. 44100 |
| 28–31 | Byte rate | sampleRate × channels × 2 |
| 32–33 | Block align | channels × 2 |
| 34–35 | Bits per sample | 16 |
| 36–39 | Sub-chunk 2 ID | `"data"` |
| 40–43 | Data size | number of audio bytes |

Interleaved 16-bit signed samples follow, mapped from `[-1.0, 1.0]` to `[-32768, 32767]`.

### WAV encoder code

```js
function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels, rate = buffer.sampleRate;
  const dataBytes = buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));

  str(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, dataBytes, true);

  const data = [...Array(channels)].map((_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
```

---

## 10. Video Studio

### Containers vs codecs

- **Container** (`.mp4`, `.webm`, `.mkv`, `.mov`) — the wrapper that holds synchronised video, audio and subtitle tracks plus timing metadata.
- **Codec** (H.264, VP9, AV1 for video; AAC, Opus for audio) — the compression algorithm used for each track inside the container.

```text
Container (.mp4 / .webm)
├── Header: metadata, timing, codec registrations
├── Video track → H.264 / VP9 / AV1
└── Audio track → AAC / Opus / PCM
```

A browser can only play — and therefore process — the codecs it supports. Anything else goes to FFmpeg in the Local Engine.

### Capturing a frame as an image

```js
function captureFrame(videoFile, atSeconds) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.onloadedmetadata = () => { video.currentTime = Math.min(atSeconds, video.duration); };
    video.onseeked = () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: video.videoWidth, height: video.videoHeight });
      canvas.getContext('2d').drawImage(video, 0, 0);
      URL.revokeObjectURL(video.src);
      canvas.toBlob(resolve, 'image/png');
    };
    video.onerror = reject;
    video.src = URL.createObjectURL(videoFile);
  });
}
```

### Trimming video in the browser

The video element is played from the start time while `captureStream()` feeds a `MediaRecorder`, which stops at the end time. Codec preference: `video/webm;codecs=vp9,opus` → `vp8,opus` → `video/webm`.

```js
function recordSegment(video, startSec, endSec) {
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find(t => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(video.captureStream(30), { mimeType: type });
  const chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  return new Promise(resolve => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    video.currentTime = startSec;
    video.onseeked = () => { recorder.start(); video.play(); };
    video.ontimeupdate = () => { if (video.currentTime >= endSec && recorder.state === 'recording') { video.pause(); recorder.stop(); } };
  });
}
```

Output is always WebM and recording runs in real time. For frame-accurate cuts in MP4, MKV or MOV, use FFmpeg via the Local Engine.

### Extracting audio from a video

```js
async function extractAudio(videoBlob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await ctx.decodeAudioData(await videoBlob.arrayBuffer());
  return audioBufferToWav(decoded);
}
```

---

## 11. Compression & archives

### Lossless vs lossy

| Type | Examples | Behaviour |
|---|---|---|
| **Lossless** | DEFLATE, GZIP, ZIP, PNG, WAV | Original data restored byte for byte (LZ77 + Huffman coding) |
| **Lossy** | JPEG, WebP, MP3 | Discards detail people barely notice; cannot be fully restored |

### Streaming GZIP with CompressionStream

The browser's built-in `CompressionStream` / `DecompressionStream` process data in chunks, so the whole file never has to sit in memory.

```js
async function gzipFile(file) {
  const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzipFile(file) {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).blob();
}
```

### Creating ZIP archives with JSZip

```js
async function zipFiles(files) {
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f));
  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    meta => console.log(`Zipping ${meta.percent.toFixed(1)}%`)
  );
}
```

---

## 12. Local Native Engine

### What omni_local_server.py is

The backend is `omni_local_server.py`, built on Python's standard library (`http.server.ThreadingHTTPServer`, `subprocess`, `secrets`, `tempfile`, `hashlib`, `urllib`). It:

- serves the Omni Suite UI and the `/api/*` endpoints on `http://127.0.0.1:8765`;
- runs native tools (FFmpeg, qpdf, Poppler, LibreOffice, Calibre, ImageMagick, Tesseract) in an isolated temp folder;
- reports status at `http://127.0.0.1:8765/api/health`.

Change the port with the `OMNI_PORT` environment variable.

### How requests are checked (simplified)

```python
import secrets

TOKEN = secrets.token_hex(32)   # new for every server start
ALLOWED_ORIGINS = {"http://127.0.0.1:8765", "http://localhost:8765",
                   "https://theraghavraman.github.io"}  # + OMNI_ALLOWED_ORIGINS

def authorize(handler):
    origin = handler.headers.get("Origin", "")
    if origin and origin not in ALLOWED_ORIGINS:
        handler.send_error(403, "Origin not allowed"); return False
    token = handler.headers.get("X-Omni-Token", "")
    if not secrets.compare_digest(token, TOKEN):      # constant-time comparison
        handler.send_error(401, "Missing or invalid local-engine token"); return False
    return True
```

`secrets.compare_digest` prevents timing attacks that could guess the token one character at a time.

### Running native tools safely

Each job writes its input to a private temp folder and calls the tool with an explicit argument list.

```python
import subprocess, tempfile, os

def split_pdf(pdf_bytes, page_range):
    with tempfile.TemporaryDirectory() as tmp:
        src, out = os.path.join(tmp, "in.pdf"), os.path.join(tmp, "out.pdf")
        with open(src, "wb") as f:
            f.write(pdf_bytes)
        cmd = ["qpdf", "--empty", "--pages", src, page_range, "--", out]
        result = subprocess.run(cmd, capture_output=True, timeout=7200)  # no shell
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode())
        with open(out, "rb") as f:
            return f.read()
```

### Typical native commands

| Tool | Example invocation | Task |
|---|---|---|
| FFmpeg | `ffmpeg -i in.mov -c:v libx264 out.mp4` | Transcode video/audio, demux streams |
| qpdf | `qpdf --stream-data=compress in.pdf out.pdf` | Optimise, linearise, split, merge PDFs |
| Poppler | `pdftoppm -r 200 -png in.pdf page` | Render PDF pages to images |
| Poppler | `pdftotext -layout in.pdf out.txt` | Extract text keeping layout |
| LibreOffice | `soffice --headless --convert-to pdf in.docx` | Office documents ↔ PDF |
| Calibre | `ebook-convert in.epub out.mobi` | eBook formats |
| ImageMagick | `magick in.tif -colorspace sRGB out.jpg` | Colour space and raster edits |

### Streaming large uploads

Uploads are copied to disk in 1 MB chunks so multi-gigabyte files never fill Python's memory. Downloads stream back the same way.

```python
CHUNK = 1024 * 1024

def stream_to_file(handler, path, total):
    remaining = total
    with open(path, "wb") as f:
        while remaining > 0:
            chunk = handler.rfile.read(min(CHUNK, remaining))
            if not chunk:
                break
            f.write(chunk)
            remaining -= len(chunk)
```

### Engine housekeeping details

- **Allowed origins** — `http://127.0.0.1:8765`, `http://localhost:8765`, `https://theraghavraman.github.io`, plus any listed in `OMNI_ALLOWED_ORIGINS` (comma-separated).
- **Token delivery** — the page receives the token from `/api/health` (only for allowed origins) or injected into `index.html` when served locally.
- **Safe filenames** — `safe_name()` keeps only letters, digits, `.`, `_` and `-`, and caps names at 180 characters, blocking path tricks such as `../`.
- **Automatic cleanup** — `cleanup_old()` deletes temp files older than 6 hours from `<system temp>/omni_converter_engine`.
- **Timeouts** — long jobs are capped (up to 7,200 s), so a stuck tool can't run forever.

---

## 13. Offline preparation

### What prepare_offline.py does

Online, the page loads libraries (PDF.js, pdf-lib, JSZip, Tesseract.js, SheetJS…) from CDNs. `prepare_offline.py` downloads them once so Omni can run with no internet.

1. Reads its `ASSETS` table: each local path under `vendor/` mapped to a pinned CDN URL (e.g. `pdfjs/pdf.min.js` → PDF.js 3.11.174).
2. Downloads each file over verified HTTPS (`certifi`), streaming the bytes.
3. Writes to a temporary file first (`tempfile.mkstemp`), then renames it into place with `os.replace` — an interrupted download can never leave a half-written library.
4. Records a SHA-256 hash for every vendor file in `vendor/OFFLINE_ASSETS.txt`.

Run it once while online: `python3 prepare_offline.py`.

### Integrity hashing

```python
import hashlib

def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(65536), b""):
            h.update(block)
    return h.hexdigest()
```

Comparing these hashes later shows whether any vendor file was changed or corrupted.

### How the page switches to local files

`index.html` itself is not edited. When the Local Engine serves the page, it checks that the complete offline bundle exists in `vendor/` (PDF.js and its worker, JSZip, pdf-lib, Tesseract worker/core and all language models, SheetJS, js-yaml). If it does, the server rewrites the CDN URLs to `./vendor/…` on the fly. If anything is missing, the page keeps using CDNs.

---

## 14. Launchers & install scripts

### Which script does what

| Script | Platform | Purpose |
|---|---|---|
| `setup_and_start.command` / `setup_and_start.bat` | macOS / Windows | First-time setup, then launch |
| `install_system_tools.command` | macOS / Linux | Install native tools via the system package manager |
| `install_windows.ps1` | Windows | Install native tools on Windows |
| `start_omni.command` / `start_omni.bat` | macOS / Windows | Find Python, start the Local Engine, open the browser |
| `Omni.command` / `Omni.bat` | macOS / Windows | One-click shortcut that calls the start script |

### Installing native tools by OS (simplified)

```bash
case "$(uname -s)" in
  Darwin)
    brew install python3 ffmpeg qpdf poppler libreoffice calibre imagemagick tesseract ;;
  Linux)
    if   command -v apt-get >/dev/null; then sudo apt-get install -y python3 ffmpeg qpdf poppler-utils libreoffice calibre imagemagick tesseract-ocr
    elif command -v dnf     >/dev/null; then sudo dnf install -y python3 ffmpeg qpdf poppler-utils libreoffice calibre ImageMagick tesseract
    elif command -v pacman  >/dev/null; then sudo pacman -S --noconfirm python ffmpeg qpdf poppler libreoffice-fresh calibre imagemagick tesseract
    elif command -v zypper  >/dev/null; then sudo zypper install -y python3 ffmpeg qpdf poppler-tools libreoffice calibre ImageMagick tesseract-ocr
    fi ;;
esac
```

### Finding Python and starting the engine (simplified)

```bash
PYTHON_BIN=""
for cmd in python3 python; do
  if command -v "$cmd" >/dev/null && "$cmd" -c 'import sys; sys.exit(sys.version_info < (3, 8))'; then
    PYTHON_BIN="$cmd"; break
  fi
done
[ -z "$PYTHON_BIN" ] && { echo "Python 3 is required."; exit 1; }

"$PYTHON_BIN" omni_local_server.py &
sleep 2
open "http://127.0.0.1:8765" 2>/dev/null || xdg-open "http://127.0.0.1:8765"
```

---

## 15. Diagnostics & test lab

### Browser capability check

```js
function runBrowserDiagnostics() {
  const d = {
    webAssembly: typeof WebAssembly?.instantiate === 'function',
    webWorker: typeof Worker !== 'undefined',
    canvas2D: !!document.createElement('canvas').getContext('2d'),
    webAudio: !!(window.AudioContext || window.webkitAudioContext),
    compressionStream: typeof CompressionStream !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    folderExport: 'showDirectoryPicker' in window
  };
  console.table(d);
  return d;
}
```

The in-app **Diagnostics** panel also reports whether PDF.js, JSZip, pdf-lib and Tesseract.js loaded.

### Self-healing bridges

`index.html` contains small safety scripts that keep the UI working if part of the app fails to load:

- **`omni-interaction-repair`** — capture-phase listeners on the navigation buttons; if the main framework fails, it still switches Studios.
- **`omni-file-capture-repair`** — repairs drop zones that fail to open the picker on mobile (tries `showPicker()`, then `click()`) and forwards files from inputs that lost their handler.

```js
document.addEventListener('change', e => {
  const t = e.target;
  if (t.tagName === 'INPUT' && t.type === 'file' && !t.hasAttribute('data-bound-listener')) {
    t.setAttribute('data-bound-listener', 'true');
    if (t.files?.length) handleIncomingFiles(t.files);
  }
});
```

### Automated test suites

| Suite | What it checks |
|---|---|
| `omni-all-options-test` | Finds every Studio panel, file input, button and `<select>`; checks every option can be selected without errors; flags buttons whose IDs aren't referenced by any script (orphaned controls). Results download as JSON. |
| `omni-test-lab` | Live functional tests: draws a synthetic image and OCRs it, builds a PDF with pdf-lib and reads it back with PDF.js, round-trips data through GZIP, encodes a WAV, and pings the Local Engine at `/api/health` (skipped in browser-only mode). |

---

## 16. Browser internals deep dive

### Event loop and the main thread

- **Call stack** — JavaScript runs one thing at a time. A long CPU job (millions of pixels, a 50 MB XML file) freezes the UI unless it is split into async steps or moved to a Web Worker.
- **Microtasks** — resolved promises and `await` continuations run before the next screen paint (about every 16.6 ms at 60 Hz).

### Memory limits and garbage collection

- **Heap ceiling** — each tab has a limit (historically ~1.4–2 GB). Exceeding it gives `RangeError: Array buffer allocation failed` or a crashed tab.
- **Garbage collection** — V8 collects short-lived objects quickly and old ones less often. Holding references to canvases or Blobs blocks collection.
- **Good practice** — call `URL.revokeObjectURL(url)`, shrink finished canvases (`canvas.width = canvas.height = 1`), and call `page.cleanup()` in PDF.js.

### WebAssembly memory

- Tesseract.js is C++ compiled to WASM with Emscripten.
- WASM uses one linear block of memory (`WebAssembly.Memory`) that JavaScript's GC doesn't manage, so workers must be `terminate()`d to release it.
- **SIMD** builds process many pixels per instruction, greatly speeding up OCR.

### Canvas memory cost

A canvas has a CSS display size and a separate pixel buffer (`canvas.width` × `canvas.height`). Each pixel costs 4 bytes (RGBA):

**Canvas RAM = width × height × 4 bytes**

An A4 page at 300 DPI is about 2480 × 3508 px ≈ **34.8 MB** per rendered page. Rendering 100 pages at once needs ~3.5 GB — beyond a tab's limit — which is why page ranges and streaming matter.

Drawing an image from another website without CORS headers "taints" the canvas, after which `getImageData()` and `toBlob()` throw a `SecurityError`.

### Web Workers and transferable objects

- Workers run on separate OS threads with no DOM access.
- Messages are normally copied (structured clone), briefly doubling memory.
- Passing `[arrayBuffer]` as the transfer list of `postMessage()` moves ownership instantly with zero copying.

### Web Streams

`CompressionStream` and `DecompressionStream` are built on `ReadableStream` / `WritableStream` / `TransformStream`. Streams support **backpressure**: a slow consumer tells the producer to wait, so data flows in small windows instead of loading whole archives into RAM.

### The loopback interface and process isolation

- `127.0.0.1` is a virtual network interface inside the OS kernel. Traffic to it never reaches Wi-Fi or Ethernet hardware.
- `ThreadingHTTPServer` handles requests concurrently.
- Native tools run with `shell=False` and argument lists such as `["qpdf", "--stream-data=compress", inp, out]`, so `/bin/sh` or `cmd.exe` never interprets filenames.

---

## 17. Troubleshooting

### Tab crashes on large PDFs or ZIPs

- **Symptom:** "Aw, Snap!" (Chrome) or "A problem repeatedly occurred" (Safari) during big conversions.
- **Cause:** too many full-resolution canvases in memory at once (~2 GB tab limit).
- **Fix:**
  1. Use **Page Range** to process 10–25 pages at a time.
  2. Use **Export Pages to Folder**, which writes one page at a time via `showDirectoryPicker()` instead of building a huge ZIP in memory.
  3. Send jobs over ~100 pages to the Local Engine (qpdf / pdftoppm).

### Clicking the drop zone does nothing

- **Cause:** browsers only open file pickers in direct response to a user gesture; a delay between click and picker gets it blocked.
- **Fix:** click the centre of the drop zone; disable extensions that block synthetic clicks; on desktop, drag the file onto the dashed area instead.

### "PDF.js missing" or other library errors

- **Cause:** CDNs are blocked or the machine is offline without the vendor bundle.
- **Fix:**
  1. Connect once and run `python3 prepare_offline.py`.
  2. Check `vendor/` contains the JS, WASM and `.traineddata.gz` files.
  3. Launch with `start_omni.command` / `start_omni.bat` (or `Omni.command` / `Omni.bat`) so the Local Engine serves the local copies.

### "WinAnsi cannot encode" when exporting to PDF

- **Cause:** standard PDF fonts only support Windows-1252; tabs (`0x09`), smart quotes and non-Latin characters break pdf-lib.
- **Fix:** run all text through `sanitizeForWinAnsi()` (Chapter 6) before `widthOfTextAtSize()` or `drawText()`, or embed a Unicode font for non-Latin scripts.

### Local Engine shows "Browser-only mode"

- **Cause:** the Python server isn't running, or a firewall blocks port 8765.
- **Fix:**
  1. Check the port: `lsof -i :8765` (macOS/Linux) or `netstat -ano | findstr 8765` (Windows).
  2. Start it manually: `python3 omni_local_server.py`.
  3. Open `http://127.0.0.1:8765/api/health` in your browser to confirm.

### "Address already in use" on port 8765

- **Cause:** another Omni instance or app already uses the port.
- **Fix:** stop it (`kill $(lsof -t -i:8765)` on macOS/Linux) or choose another port: `OMNI_PORT=8900 python3 omni_local_server.py`.

### HTTP 401 "Missing or invalid local-engine token"

- **Cause:** the page holds a token from a previous server session.
- **Fix:** refresh the page or click **Refresh Engine Status** in the Local Engine panel to fetch the current token from `/api/health`.

### "FFmpeg / LibreOffice is not installed"

- **Cause:** the tool isn't on your `PATH`.
- **Fix:**
  1. Re-run `install_system_tools.command` (macOS/Linux) or `install_windows.ps1` (Windows).
  2. Check with `which ffmpeg`, `which qpdf`, `which soffice`.
  3. On Apple Silicon Macs, make sure Homebrew is on the path: `export PATH="/opt/homebrew/bin:$PATH"`.

### Video trimming fails or outputs 0 bytes

- **Cause:** the browser doesn't support WebM recording or `captureStream()` (common on older Safari).
- **Fix:** use a current Chrome, Edge or Firefox, or trim through FFmpeg in the Local Engine for MP4, MKV and MOV.

### OCR returns blank or garbled text

- **Cause:** low contrast, skewed text, resolution under ~150 DPI, or the wrong language.
- **Fix:**
  1. Upscale to at least 300 DPI in Image Tools first.
  2. Pick the exact language (`hin`, or `eng+hin` for mixed text).
  3. For multi-column layouts, use native Tesseract with page segmentation `--psm 1` via the Local Engine.

---

## 18. Open-source licences

### Licence summary

| Licence | Applies to | Key obligations |
|---|---|---|
| **MIT** | OmniConverter / Omni Suite core, pdf-lib, JSZip | Keep the copyright and permission notice. Provided "as is". |
| **Apache 2.0** | PDF.js, Tesseract.js, Tesseract, qpdf | Keep notices; mark modified files; includes a patent grant that ends if you sue over patents. |
| **SIL OFL 1.1** | Outfit font | Free to use and bundle; can't sell the font alone; modified versions can't use the reserved name. |
| **MPL 2.0** | LibreOffice | Changes to MPL files stay MPL; can be combined with other code in a "larger work". |
| **GPL / LGPL** | FFmpeg builds, Poppler, Calibre | Strong copyleft if linked or redistributed. |
| **ImageMagick Licence** | ImageMagick | Apache-compatible; keep copyright notices. |

### Why GPL tools don't affect Omni's licence

Omni never links GPL libraries into its code and never ships their binaries. It runs FFmpeg, Poppler and Calibre as separate programs via `subprocess.run()`, and users install them from their own package manager. This separation keeps Omni's MIT licence clean. See `THIRD_PARTY_NOTICES.md` in the repository root for the full notices.

---

## 19. Glossary

| Term | Definition |
|---|---|
| **ArrayBuffer** | Fixed-length block of raw binary memory in JavaScript. |
| **Aspect ratio** | Proportion between an image's width and height. |
| **Backpressure** | A stream signal telling the producer to slow down when the consumer can't keep up. |
| **Blob** | Immutable, file-like chunk of binary data in the browser. |
| **Canvas 2D context** | Drawing API for an HTML `<canvas>`; used to render, transform and export pixels. |
| **Codec** | Coder/decoder algorithm that compresses media (H.264, VP9, AAC, Opus). |
| **CompressionStream** | Built-in browser API for streaming GZIP/DEFLATE compression. |
| **Container** | File wrapper holding media tracks or assets (`.mp4`, `.mkv`, `.epub`). |
| **CORS** | Rules that let a server allow or block requests from other websites. |
| **DataView** | Low-level reader/writer for numbers inside an ArrayBuffer, with explicit byte order. |
| **DEFLATE** | Lossless compression combining LZ77 and Huffman coding; used by ZIP and GZIP. |
| **DOM** | In-memory tree representing an HTML or XML document. |
| **DPI / PPI** | Dots / pixels per inch — density linking pixels to physical size. PDF space uses 72 points per inch. |
| **Demuxing** | Separating a container into its individual audio, video and subtitle streams. |
| **EPUB spine** | List in `content.opf` giving the reading order of chapters. |
| **FileRangeTransport** | PDF.js mechanism for loading only requested byte ranges of a file. |
| **JSZip** | JavaScript library for reading and writing ZIP archives. |
| **Loopback (127.0.0.1)** | Virtual network interface a computer uses to talk to itself. |
| **Lossless / lossy** | Exact reconstruction (PNG, ZIP, WAV) vs discarding imperceptible detail (JPEG, MP3, WebP). |
| **MIME type** | Label describing a file's format, e.g. `application/pdf`. |
| **OffscreenCanvas** | Canvas usable inside Web Workers, off the main thread. |
| **OpenXML** | Microsoft's XML-in-ZIP format for `.docx`, `.xlsx` and `.pptx`. |
| **PCM** | Uncompressed digital audio made of sampled amplitude values. |
| **pdf-lib** | JavaScript library for creating and editing PDFs. |
| **PDF.js** | Mozilla's JavaScript engine for parsing and rendering PDFs. |
| **Poppler** | Open-source PDF rendering library and tools (`pdftoppm`, `pdftotext`). |
| **qpdf** | Command-line tool for lossless PDF restructuring: split, merge, linearise, compress. |
| **Sample rate** | Audio samples per second (Hz), e.g. 44,100 or 48,000. |
| **Sandbox** | Restricted environment where web scripts run without direct system access. |
| **SIMD** | Single Instruction, Multiple Data — one CPU instruction applied to many values at once. |
| **Tesseract** | OCR engine originally from HP, open-sourced by Google, with an LSTM recogniser. |
| **TypedArray** | Typed view over binary memory (`Uint8Array`, `Int16Array`, `Float32Array`). |
| **V8** | Google's JavaScript and WebAssembly engine used in Chrome and Edge. |
| **Web Audio API** | Browser API for decoding, processing and generating audio. |
| **WebAssembly (WASM)** | Binary format that runs compiled C/C++/Rust code at near-native speed in browsers. |
| **Web Worker** | Background JavaScript thread separate from the page UI. |
| **WinAnsiEncoding** | Windows-1252 single-byte encoding used by the standard PDF fonts. |

---

## 20. Hands-on learning path

### Five practice projects

1. **Binary foundations** — read a `.png` with `FileReader`, check its first 8 bytes against the PNG signature `89 50 4E 47 0D 0A 1A 0A` using a `Uint8Array`.
2. **Canvas manipulation** — upload an image, crop it to a 1:1 square with the Cover maths from Chapter 7, and download it as WebP.
3. **Web Audio** — generate a 10-second 440 Hz tone (concert A) and save it with the WAV encoder from Chapter 9.
4. **Document dissection** — unzip a `.docx` with JSZip, edit the first `<w:t>` node in `word/document.xml`, re-zip it and open it in Word.
5. **Subprocess integration** — write a minimal `http.server` that accepts a POSTed PDF, validates the filename with a `safe_name()` function, and runs `qpdf` via `subprocess.run()` with `shell=False`.

### Topic index

| Topic | Chapters |
|---|---|
| Privacy model and sandbox | 1, 2, 16 |
| Dual-engine architecture | 2, 12 |
| Security, tokens and origins | 2, 12 |
| PDF rendering, DPI and large files | 4, 16, 17 |
| DOCX internals and Word ↔ PDF | 5 |
| EPUB internals and WinAnsi fixes | 6, 17 |
| Image sizing and presets | 7 |
| OCR and languages | 8, 17 |
| Audio and WAV encoding | 9 |
| Video trimming and frames | 10, 17 |
| Compression and streams | 11, 16 |
| Offline setup | 13, 17 |
| Install scripts | 14 |
| Diagnostics and tests | 15 |
| Licences | 18 |
