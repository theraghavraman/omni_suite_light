#!/usr/bin/env node
/**
 * Deterministic regression test for Omni Assistant product retrieval.
 * Does not download models or require network access.
 */
import fs from "node:fs";
import path from "node:path";

const kb = fs.readFileSync(path.join(process.cwd(), "knowledge-base", "omni-suite.md"), "utf8").trim();

function split(text) {
  const sections = text.split(/(?=^##\s+)/m).map(x => x.trim()).filter(Boolean);
  return sections.length > 1 ? sections.flatMap(x => x.length <= 1100 ? [x] : splitLong(x)) : splitLong(text);
}
function splitLong(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 760) {
    const chunk = text.slice(i, i + 900).trim();
    if (chunk) out.push(chunk);
    if (i + 900 >= text.length) break;
  }
  return out;
}
function lex(query, text) {
  const queryTokens = new Set((query.toLowerCase().match(/[a-z0-9_-]{2,}/g) || []));
  const bodyTokens = text.toLowerCase().match(/[a-z0-9_-]{2,}/g) || [];
  let n = 0;
  for (const token of bodyTokens) if (queryTokens.has(token)) n++;
  const bodyScore = n / Math.sqrt(Math.max(1, queryTokens.size * bodyTokens.length));
  const heading = (text.match(/^##\s+.+$/m)?.[0] || "").toLowerCase();
  const headingTokens = heading.match(/[a-z0-9_-]{2,}/g) || [];
  const headingHits = headingTokens.filter(token => queryTokens.has(token)).length;
  const headingScore = headingHits / Math.max(1, headingTokens.length);
  return bodyScore + (headingScore * 0.45);
}

const docs = split(kb);
if (docs.length < 25) throw new Error(`Expected at least 25 retrieval entries, found ${docs.length}`);

const cases = [
  ["Which Studio handles PDF to PowerPoint?", ["office studio", "pdf", "powerpoint"]],
  ["Where should I go for SQL queries?", ["database studio", "sql"]],
  ["Which Studio is for OCR?", ["image to text", "ocr"]],
  ["Where do I process CSV and JSON?", ["data studio", "csv", "json"]],
  ["What is Universal Data?", ["universal data", "structured", "unstructured"]],
  ["What does Private RAG use for embeddings?", ["all-minilm-l6-v2", "embedding"]],
  ["What local language model does Omni use?", ["gemma 3 270m", "onnx-community"]],
  ["Is repository indexing training?", ["retrieval", "not model training"]],
  ["Where do I troubleshoot browser problems?", ["diagnostics", "system doctor"]],
  ["What does All Tests do?", ["all tests", "failed-test"]],
  ["Where do I compress files?", ["compressor", "file size"]],
  ["Which Studio handles audio?", ["audio studio"]],
  ["Which Studio handles video?", ["video studio"]],
  ["Which Studio handles EPUB?", ["epub studio"]],
  ["Where do I clean data?", ["data clean", "normalization"]],
  ["Which Studio handles batch work?", ["batch lab"]],
  ["What is the privacy model?", ["indexeddb", "remote ai api"]],
  ["Does Omni always require the Local Engine?", ["browser-first", "local engine"]],
  ["What happens when a capability is uncertain?", ["not verified", "closest studio"]],
  ["Is the assistant informational?", ["informational", "execute conversions"]]
];

let failures = 0;
for (const [question, expected] of cases) {
  const ranked = docs.map(text => ({ text, score: lex(question, text) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 8).map(x => x.text.toLowerCase()).join("\n");
  const ok = expected.every(term => top.includes(term));
  if (!ok) {
    failures++;
    console.error(`FAIL: ${question}\nTop retrieval:\n${top.slice(0, 1800)}\nExpected: ${expected.join(", ")}\n`);
  }
}
if (failures) throw new Error(`${failures}/${cases.length} retrieval regression cases failed`);
console.log(`Assistant retrieval regression passed: ${cases.length} questions across ${docs.length} entries.`);
