#!/usr/bin/env node
/**
 * Deterministic regression test for Omni Assistant product retrieval.
 * Does not download models or require network access.
 */
import fs from "node:fs";
import path from "node:path";

const kb = fs.readFileSync(path.join(process.cwd(), "knowledge-base", "omni-suite.md"), "utf8").trim();

// Mirrors split() in omni_assistant.js: "## " sections, long ones re-split on "### " with headings kept.
function split(text) {
  text = text.replace(/\r/g, "").trim();
  const sections = text.split(/(?=^##\s+)/m).map(x => x.trim()).filter(Boolean);
  if (sections.length <= 1) return splitLong(text);
  const out = [];
  for (const sec of sections) {
    if (sec.length <= 1100) { out.push(sec); continue; }
    const h2 = /^##\s/.test(sec) ? sec.split("\n", 1)[0] : "";
    for (const sub of sec.split(/(?=^###\s+)/m).map(x => x.trim()).filter(Boolean)) {
      const isSub = /^###\s/.test(sub), crumb = isSub && h2 ? h2 + "\n" : "", h3 = isSub ? sub.split("\n", 1)[0] + "\n" : "";
      const piece = crumb + sub;
      if (piece.length <= 1100) { out.push(piece); continue; }
      const prefix = crumb + h3 || (/^##\s/.test(sub) ? h2 + "\n" : "");
      splitLong(piece).forEach((x, i) => out.push(i ? prefix + x : x));
    }
  }
  return out;
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
  const overlaps = (token, set) => set.has(token) || [...set].some(q => q.length >= 6 && token.length >= 6 && q.slice(0,6) === token.slice(0,6));
  let n = 0;
  for (const token of bodyTokens) if (overlaps(token, queryTokens)) n++;
  const bodyScore = n / Math.sqrt(Math.max(1, queryTokens.size * bodyTokens.length));
  const heading = (text.match(/^##\s+.+$/m)?.[0] || "").toLowerCase();
  const headingTokens = heading.match(/[a-z0-9_-]{2,}/g) || [];
  const headingHits = headingTokens.filter(token => overlaps(token, queryTokens)).length;
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

// ---- Knowledge-base rule: every supported file in knowledge-base/ must be in manifest.json ----
const kbDir = path.join(process.cwd(), "knowledge-base");
const manifest = JSON.parse(fs.readFileSync(path.join(kbDir, "manifest.json"), "utf8"));
const listed = new Set((Array.isArray(manifest) ? manifest : manifest.files || []).map(f => typeof f === "string" ? f : f.path));
const KB_FILE = /\.(md|markdown|txt|text|html?|json|csv|tsv|xml|ya?ml|rst|pdf|docx)$/i;
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.name.startsWith(".") ? [] : d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const onDisk = walk(kbDir).map(f => path.relative(kbDir, f).split(path.sep).join("/")).filter(f => f !== "manifest.json" && KB_FILE.test(f));
const missing = onDisk.filter(f => !listed.has(f));
const ghost = [...listed].filter(f => !onDisk.includes(f));
if (missing.length || ghost.length) throw new Error(`knowledge-base/manifest.json out of sync. Missing: ${missing.join(", ") || "none"}; listed but absent: ${ghost.join(", ") || "none"}. Run python3 .github/scripts/build_kb_manifest.py`);
console.log(`Knowledge-base manifest covers all ${onDisk.length} files.`);

// ---- OmniConverter guide: clean structure and retrievable chapters ----
const guide = fs.readFileSync(path.join(kbDir, "omniconverter-guide.md"), "utf8");
if (/<PARSED TEXT FOR PAGE|\uFFFE|\u2423/.test(guide)) throw new Error("omniconverter-guide.md still contains PDF extraction artifacts");
const fences = (guide.match(/^```/gm) || []).length;
if (fences % 2) throw new Error("omniconverter-guide.md has an unclosed code block");
const guideDocs = split(guide);
const orphan = guideDocs.filter(c => /^###\s/.test(c));
if (orphan.length) throw new Error(`${orphan.length} guide chunks lost their chapter heading`);
const guideCases = [
  ["How do I fix WinAnsi cannot encode error?", ["winansi", "sanitizeforwinansi"]],
  ["What port does the Local Native Engine use?", ["8765"]],
  ["Passport photo pixel size at 300 DPI", ["413", "531"]],
  ["How is the WAV header laid out?", ["riff", "44"]],
  ["Port 8765 address already in use", ["omni_port"]],
  ["Why do GPL tools not affect the licence?", ["subprocess", "gpl"]],
  ["What does prepare_offline.py do?", ["vendor", "sha-256"]]
];
let guideFailures = 0;
for (const [question, expected] of guideCases) {
  const top = guideDocs.map(text => ({ text, score: lex(question, text) })).sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.text.toLowerCase()).join("\n");
  if (!expected.every(t => top.includes(t))) { guideFailures++; console.error(`FAIL (guide): ${question}\nExpected: ${expected.join(", ")}\n${top.slice(0, 1200)}\n`); }
}
if (guideFailures) throw new Error(`${guideFailures}/${guideCases.length} guide retrieval cases failed`);
console.log(`Guide retrieval passed: ${guideCases.length} questions across ${guideDocs.length} chunks.`);
