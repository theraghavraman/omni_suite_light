# Omni Suite Knowledge Base

Omni Suite is a browser-first public utility workspace for file conversion, document processing, data work, media tools, diagnostics, and local/private workflows.

## Assistant behavior
- Answer questions about Omni Suite using only retrieved product knowledge when possible.
- Never invent a capability, format, conversion, button, or privacy guarantee.
- If a capability is uncertain or unsupported, say so and recommend the closest relevant Studio.
- Prefer concise step-by-step instructions.
- Explain whether a workflow is browser-first, local fallback, or dependent on a local engine when that information is known.
- The assistant is informational; it does not need to execute conversions itself.

## Studios
PDF Suite: PDF-focused operations such as document manipulation and PDF workflows.
Office Studio: Office-document conversion and spreadsheet/presentation workflows.
EPUB Studio: EPUB/e-book related processing.
Image Tools: image manipulation and conversion utilities.
Image to Text: OCR and image-to-text workflows.
Audio Studio: audio processing/conversion tools.
Video Studio: video processing/conversion tools.
Compressor: file compression and size-reduction workflows.
Data Studio: structured/semi-structured data conversion and data utilities.
Local Engine: local fallback processing for operations that are unsupported or too heavy for browser execution.
BI Interchange: business-intelligence/data interchange workflows.
Code Studio: code/data-format related utilities.
Universal Data: broad structured, semi-structured and unstructured data workflows.
Database Studio: database-oriented utilities and inspection/query tooling where implemented.
Data Clean: data cleaning and normalization workflows.
Batch Lab: batch processing workflows.
System Doctor: system/browser capability and dependency checks.
Diagnostics: browser, engine and workspace diagnostics.
All Tests: integrated testing and health checks, including failed-test filtering.
Private RAG Studio: private browser-local document RAG using IndexedDB, embeddings and an optional local small LLM.

## Processing model
Omni Suite is designed browser-first where practical. Some advanced or heavy formats may use Local Engine as fallback. Availability can vary by browser and device.

## Private RAG
Private RAG Studio stores indexed chunks in browser IndexedDB. It uses semantic embeddings plus lexical retrieval. Its current embedding model is Xenova/all-MiniLM-L6-v2 and its optional local generation model is Xenova/Qwen1.5-0.5B-Chat. WebGPU may be used when available; otherwise WASM fallback is used. Current model/runtime assets may be downloaded on first use, so this is not a guarantee of zero-network operation on a fresh browser.

## Assistant limitations
The assistant's knowledge is based on the curated Omni Suite knowledge base and retrieved repository knowledge. If the site changes, the knowledge base should be refreshed.