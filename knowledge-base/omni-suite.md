# Omni Suite Product Knowledge

This knowledge base is the authoritative product reference for Omni Assistant. Use only facts stated here or retrieved from verified repository sources. If a capability is not listed, say that it is not verified rather than inventing support.

## Product
Omni Suite is a browser-first public utility workspace for file conversion, document processing, data work, media tools, diagnostics, and local/private workflows.

## Browser-first processing
Omni Suite tries to process supported operations in the browser first. Operations that are unsupported or too heavy for reliable browser execution can use the Local Engine where implemented.

## Local Engine
Local Engine provides local fallback processing for operations that cannot be performed reliably in the browser. It is separate from the browser-only path.

## Privacy model
Private RAG keeps indexed document chunks and vectors in this browser's IndexedDB. Omni Assistant does not send questions to a remote AI API. Fresh-browser model assets may still be downloaded from model/CDN hosts unless the assets are self-hosted.

## Local AI model
The lightweight browser language model is Gemma 3 270M Instruct, loaded from the ONNX Community Transformers.js model onnx-community/gemma-3-270m-it-ONNX. The assistant uses quantized browser inference with WebGPU when available and WASM fallback otherwise.

## Embedding model
Private RAG and semantic assistant retrieval use Xenova/all-MiniLM-L6-v2 for embeddings.

## Private RAG retrieval
Private RAG combines lexical retrieval with semantic vector retrieval. Indexed chunks are stored locally in IndexedDB. Repository knowledge can also be indexed locally.

## Private RAG documents
Private RAG can index supported text/source documents and extract text from PDF and DOCX when the corresponding browser libraries are available. The indexed knowledge stays in the browser's local IndexedDB.

## Private RAG repository knowledge
Private RAG can index text/source/configuration files from the Omni Suite repository and store their chunks locally. Repository indexing is retrieval, not model training or fine-tuning.

## PDF Suite
PDF Suite is for PDF-focused document workflows such as manipulation and PDF processing. Browser availability depends on the operation and available libraries.

## Office Studio
Office Studio handles Office-document workflows, including Word, PowerPoint, and spreadsheet-related conversion where implemented.

## EPUB Studio
EPUB Studio handles EPUB and e-book related processing.

## Image Tools
Image Tools provides image conversion and manipulation utilities.

## Image to Text
Image to Text provides OCR and image-to-text extraction workflows.

## Audio Studio
Audio Studio provides audio processing and conversion workflows.

## Video Studio
Video Studio provides video processing and conversion workflows.

## Compressor
Compressor provides file compression and file-size reduction workflows.

## Data Studio
Data Studio handles structured and semi-structured data workflows, including data conversion and utilities.

## Universal Data
Universal Data is the broad data workspace for structured, semi-structured, and unstructured data workflows.

## Database Studio
Database Studio provides database-oriented utilities, inspection, and query workflows where implemented. The connection URL section was removed from the public UI.

## Data Clean
Data Clean provides data cleaning and normalization workflows.

## Batch Lab
Batch Lab provides batch processing workflows for multiple files or operations.

## BI Interchange
BI Interchange provides business-intelligence and data-interchange workflows.

## Code Studio
Code Studio provides code and data-format related utilities.

## System Doctor
System Doctor checks browser, engine, dependency, and local-environment capabilities.

## Diagnostics
Diagnostics provides browser, engine, and workspace diagnostics useful for troubleshooting.

## All Tests
All Tests provides integrated health checks and can filter failed tests.

## Conversion guidance
For PDF to PowerPoint or PowerPoint to PDF, start with Office Studio. Browser execution is preferred where the selected operation is supported; heavier operations may use Local Engine.

## Spreadsheet guidance
For spreadsheet conversion and spreadsheet-oriented processing, start with Office Studio for Office-document workflows or Data Studio for structured data workflows. Choose based on the source and desired output.

## CSV and JSON guidance
For CSV, JSON, and similar structured-data operations, start with Data Studio. Universal Data is the broader choice when the workflow crosses structured, semi-structured, and unstructured data.

## SQL guidance
For SQL and database inspection/query work, start with Database Studio.

## OCR guidance
For extracting text from an image, start with Image to Text.

## Image conversion guidance
For image conversion and manipulation, start with Image Tools.

## Audio guidance
For audio conversion or processing, start with Audio Studio.

## Video guidance
For video conversion or processing, start with Video Studio.

## Compression guidance
For reducing file size or creating compressed archives, start with Compressor.

## Multiple-file guidance
For processing multiple files in a workflow, start with Batch Lab when the operation is supported there.

## Troubleshooting
If a browser operation fails, check Diagnostics or System Doctor first. All Tests can be used for broader verification and failed-test filtering.

## Unsupported capability rule
Omni Assistant must not claim that a specific format or conversion is supported unless it is stated in this knowledge base or verified from the repository implementation. When uncertain, recommend the closest Studio and explain that support must be checked.

## Assistant behavior
The assistant should be concise and practical. It should distinguish browser-first processing, Local Engine fallback, and Private RAG local retrieval. It should never describe repository indexing as training.

## Assistant scope
Omni Assistant is informational. It can explain Omni Suite workflows and recommend Studios; it does not need to execute conversions itself.

## Knowledge freshness
When Omni Suite changes, update this knowledge base and its retrieval tests. Repository-aware retrieval can provide additional implementation context when the user explicitly asks about the codebase.