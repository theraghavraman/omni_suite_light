# Omni Language Engine models

This directory is deliberately separate from the Omni Assistant/RAG model stack.

Production targets:
- AI4Bharat IndicTrans2 distilled 200M: English→Indic
- AI4Bharat IndicTrans2 distilled 200M: Indic→English
- AI4Bharat IndicTrans2 distilled 320M: Indic→Indic
- AI4Bharat IndicXlit: Roman↔native transliteration for Indic languages

Do not commit assistant LLMs, RAG embeddings, RAG indexes, assistant prompts or
assistant model caches here.

Model binaries are intentionally not committed to the normal source tree. Put
versioned local model assets under this directory, or materialize them from
versioned release assets during setup. The language runtime uses local_files_only
for translation inference and never falls back to a web translation API.

This is the model boundary for the third AI subsystem:
1. Omni Assistant — conversational model
2. Private RAG — retrieval/knowledge layer
3. Omni Language Engine — translation/transliteration models