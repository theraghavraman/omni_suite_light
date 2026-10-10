/* Omni Suite — site-wide assistant
 * Product RAG + local small LLM. Uses curated knowledge-base files and optionally
 * the Private RAG IndexedDB corpus when available.
 */
(()=>{"use strict";
const CDN="https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const EMBED="Xenova/all-MiniLM-L6-v2", LLM="onnx-community/gemma-3-270m-it-ONNX";
let docs=[],busy=false,knowledgeLoaded=false,privateLoaded=false,currentStudio=null;
const esc=s=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function studioContext(){const n=document.querySelector(".nav-btn.active");if(!n)return null;return {tab:n.dataset.tab||"",name:(n.querySelector(".studio-label")?.textContent||n.textContent||"").trim()}}
function studioAction(query){const q=query.toLowerCase();const map=[["apache hop","tabETLStudio","ETL Studio"],["hop server","tabETLStudio","ETL Studio"],["etl","tabETLStudio","ETL Studio"],["pdf","tabPdf","PDF Suite"],["powerpoint","tabWord","Office Studio"],["word","tabWord","Office Studio"],["excel","tabWord","Office Studio"],["spreadsheet","tabData","Data Studio"],["csv","tabData","Data Studio"],["json","tabData","Data Studio"],["database","tabDatabaseStudio","Database Studio"],["sql","tabDatabaseStudio","Database Studio"],["image","tabImages","Image Tools"],["ocr","tabOcr","Image to Text"],["audio","tabAudio","Audio Studio"],["video","tabVideo","Video Studio"],["compress","tabCompress","Compressor"],["rag","tabRAGStudio","Private RAG"],["code","tabCodeStudio","Code Studio"],["universal data","tabUniversalData","Universal Data"],["data clean","tabDataClean","Data Clean"],["batch","tabBatchLab","Batch Lab"]];for(const [key,tab,name] of map)if(q.includes(key))return {tab,name};return currentStudio}
function openStudio(tab){const b=document.querySelector(".nav-btn[data-tab=\""+tab+"\"]");if(b){b.click();return true}return false}
function styles(){if(document.getElementById("omni-assistant-css"))return;const s=document.createElement("style");s.id="omni-assistant-css";s.textContent=`
#omniAssistantButton{position:fixed;right:22px;left:auto;bottom:22px;z-index:90;border:0;border-radius:18px;padding:12px 16px;background:linear-gradient(135deg,#6c5cff,#ff4f9a);color:#fff;font-weight:850;box-shadow:0 18px 38px -14px rgba(80,60,190,.55);cursor:pointer;display:flex;gap:9px;align-items:center}
#omniAssistantButton:hover{transform:translateY(-3px)}#omniAssistantPanel{position:fixed;right:22px;left:auto;bottom:78px;z-index:91;width:min(430px,calc(100vw - 28px));height:min(650px,calc(100vh - 110px));display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(108,92,255,.18);border-radius:24px;background:rgba(255,255,255,.97);box-shadow:0 30px 80px -24px rgba(45,36,110,.45);backdrop-filter:blur(18px)}
#omniAssistantPanel.open{display:flex;animation:omniAsIn .3s ease}.omni-as-head{padding:17px 18px;border-bottom:1px solid #eceaf5;background:linear-gradient(135deg,#f8f6ff,#fff)}
.omni-as-title{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:76px}.omni-as-title strong{font-size:1rem}.omni-as-badge{font-size:.65rem;font-weight:900;padding:5px 8px;border-radius:999px;background:#e7fbf4;color:#087f5b}
.omni-as-sub{font-size:.75rem;color:#73788d;margin-top:5px;line-height:1.45}.omni-as-aihint{display:block;margin-top:7px;font-size:.67rem;color:#68718a}.omni-as-context{display:inline-flex;margin-top:8px;padding:5px 8px;border-radius:999px;background:#f0edff;color:#5b4bb1;font-size:.65rem;font-weight:850}.omni-as-action{margin-top:8px;border:1px solid #d8d1ff;border-radius:9px;background:#f5f2ff;color:#5947b8;padding:7px 10px;font-size:.7rem;font-weight:850;cursor:pointer}.omni-as-action:hover{background:#ebe6ff}.omni-as-chat{flex:1;overflow:auto;padding:14px;background:#fafbfe}
.omni-as-msg{max-width:88%;padding:10px 12px;border-radius:15px;margin:0 0 10px;white-space:pre-wrap;line-height:1.48;font-size:.82rem}
.omni-as-msg.bot{background:#fff;border:1px solid #e6e8ef;color:#29304a}.omni-as-msg.user{margin-left:auto;background:#6c5cff;color:#fff}
.omni-as-source{margin-top:8px;padding:7px 9px;border-radius:10px;background:#f4f2ff;color:#6259a0;font-size:.68rem}.omni-as-source a{color:#5d46bd;font-weight:800;text-decoration:none}.omni-as-source a:hover{text-decoration:underline}
.omni-as-form{display:flex;gap:8px;padding:11px;border-top:1px solid #eceef4;background:#fff}.omni-as-form textarea{flex:1;min-height:42px;max-height:110px;resize:none;border:1px solid #dfe3ec;border-radius:13px;padding:10px;font:inherit;font-size:.8rem}.omni-as-send{border:0;border-radius:13px;padding:0 13px;background:#1c1b3a;color:#fff;font-weight:800;cursor:pointer}.omni-as-suggestions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.omni-as-suggestions button{border:1px solid #e0e2ea;background:#f7f6ff;color:#574bb0;border-radius:999px;padding:7px 9px;font-size:.68rem;font-weight:800;cursor:pointer}.omni-as-suggestions button:hover{background:#eeeaff}.omni-as-tools{position:absolute;right:12px;top:12px;display:flex;gap:4px}.omni-as-tool{width:30px;height:30px;border:1px solid #e5e7ef;border-radius:9px;background:#fff;color:#596178;font-weight:900;cursor:pointer}.omni-as-tool:hover{background:#f4f2ff;color:#5d46bd}.omni-as-clear{position:absolute;right:12px;top:48px;border:0;background:transparent;color:#85899b;cursor:pointer}.omni-as-minimized{width:260px!important;height:54px!important;border-radius:18px!important}.omni-as-minimized .omni-as-head{border:0;padding:11px 14px}.omni-as-minimized .omni-as-title{padding-right:0}.omni-as-minimized .omni-as-sub,.omni-as-minimized .omni-as-chat,.omni-as-minimized .omni-as-form,.omni-as-minimized .omni-as-clear{display:none}.omni-as-shrink{width:min(350px,calc(100vw - 28px))!important;height:min(470px,calc(100vh - 110px))!important}.omni-as-shrink .omni-as-chat{padding:10px}.omni-as-shrink .omni-as-msg{font-size:.76rem;padding:8px 10px}
@keyframes omniAsIn{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
.omni-as-minimized .omni-as-suggestions{display:none}.omni-as-minimized .omni-as-tools{top:12px}@media(max-width:600px){#omniAssistantButton{right:14px;left:auto;bottom:14px}#omniAssistantPanel{right:14px;left:auto;bottom:70px;width:calc(100vw - 28px);height:calc(100vh - 92px);border-radius:20px}}
`;document.head.appendChild(s)}
function saveUiState(p){localStorage.setItem("omniAssistantState",JSON.stringify({open:p.classList.contains("open"),minimized:p.classList.contains("omni-as-minimized"),shrink:p.classList.contains("omni-as-shrink"),seen:true}));}
function restoreUiState(p){let x=null;try{x=JSON.parse(localStorage.getItem("omniAssistantState")||"null")}catch(e){} if(x?.minimized){p.classList.add("omni-as-minimized");document.getElementById("omniAsMin").textContent="↗"} if(x?.shrink){p.classList.add("omni-as-shrink");document.getElementById("omniAsShrink").textContent="＋"} return x}
function ui(){if(document.getElementById("omniAssistantPanel"))return;const b=document.createElement("button");b.id="omniAssistantButton";b.innerHTML="✦ <span>Ask Omni</span>";b.onclick=()=>{const p=document.getElementById("omniAssistantPanel");p.classList.add("open");saveUiState(p)};document.body.appendChild(b);const p=document.createElement("section");p.id="omniAssistantPanel";p.setAttribute("aria-label","Omni Assistant");p.innerHTML=`<div class="omni-as-head"><div class="omni-as-title"><strong>Omni Assistant</strong><span class="omni-as-badge" id="omniAsStatus">LOCAL-FIRST</span></div><div class="omni-as-tools"><button class="omni-as-tool" id="omniAsShrink" title="Shrink assistant">−</button><button class="omni-as-tool" id="omniAsMin" title="Minimize assistant">⌄</button><button class="omni-as-tool" id="omniAsClose" title="Close assistant">×</button></div><button class="omni-as-clear" id="omniAsClear" title="Clear chat">Clear</button><div class="omni-as-sub">Independent local AI · repository-aware · no API key required</div><div class="omni-as-context" id="omniAsContext">Context: detecting studio…</div><div class="omni-as-aihint" id="omniAsAIHint">Local AI is idle until you ask a question.</div></div><div class="omni-as-chat" id="omniAsChat"><div class="omni-as-msg bot">Hi! I’m Omni Assistant. I can help you choose a Studio, understand conversions, troubleshoot Omni Suite, or explain the repository.</div><div class="omni-as-suggestions"><button data-q="Which Studio should I use?">Which Studio?</button><button data-q="How do I convert PDF to PowerPoint?">PDF → PowerPoint</button><button data-q="What can Omni Suite do?">What can Omni Suite do?</button><button data-q="Help me troubleshoot Omni Suite">Troubleshoot</button></div></div><div class="omni-as-form"><textarea id="omniAsInput" placeholder="Ask about Omni Suite…" aria-label="Ask Omni"></textarea><button class="omni-as-send" id="omniAsSend">Ask</button></div>`;document.body.appendChild(p);document.getElementById("omniAsSend").onclick=ask;document.getElementById("omniAsInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask()}});document.getElementById("omniAsClear").onclick=()=>document.getElementById("omniAsChat").innerHTML='<div class="omni-as-msg bot">Chat cleared. What would you like to know about Omni Suite?</div>';document.getElementById("omniAsMin").onclick=()=>{p.classList.toggle("omni-as-minimized");document.getElementById("omniAsMin").textContent=p.classList.contains("omni-as-minimized")?"↗":"⌄";saveUiState(p)};document.getElementById("omniAsShrink").onclick=()=>{p.classList.toggle("omni-as-shrink");document.getElementById("omniAsShrink").textContent=p.classList.contains("omni-as-shrink")?"＋":"−";saveUiState(p)};document.getElementById("omniAsClose").onclick=()=>{p.classList.remove("open");saveUiState(p)};p.querySelectorAll(".omni-as-suggestions button").forEach(x=>x.onclick=()=>{document.getElementById("omniAsInput").value=x.dataset.q;ask()});const state=restoreUiState(p);if(!state?.seen)setTimeout(()=>{p.classList.add("open");saveUiState(p)},900)}
function toggle(){const p=document.getElementById("omniAssistantPanel");p.classList.toggle("open");saveUiState(p)}
async function localAI(){if(!window.OmniLocalAI)throw new Error("Independent local AI runtime is unavailable");return window.OmniLocalAI}
// Chunk by "## " sections; long sections are split again on "### " and every piece keeps its headings as context.
function split(t){
 t=t.replace(/\r/g,"").trim();
 const sections=t.split(/(?=^##\s+)/m).map(x=>x.trim()).filter(Boolean);
 if(sections.length<=1)return splitLong(t);
 const out=[];
 for(const sec of sections){
  if(sec.length<=1100){out.push(sec);continue}
  const h2=/^##\s/.test(sec)?sec.split("\n",1)[0]:"";
  for(const sub of sec.split(/(?=^###\s+)/m).map(x=>x.trim()).filter(Boolean)){
   const isSub=/^###\s/.test(sub),crumb=isSub&&h2?h2+"\n":"",h3=isSub?sub.split("\n",1)[0]+"\n":"";
   const piece=crumb+sub;
   if(piece.length<=1100){out.push(piece);continue}
   const prefix=crumb+h3||(/^##\s/.test(sub)?h2+"\n":"");
   splitLong(piece).forEach((x,i)=>out.push(i?prefix+x:x));
  }
 }
 return out
} function splitLong(t){const out=[];for(let i=0;i<t.length;i+=760){const part=t.slice(i,i+900).trim();if(part)out.push(part);if(i+900>=t.length)break}return out}function lex(q,t){const a=new Set((q.toLowerCase().match(/[a-z0-9_-]{2,}/g)||[])),b=t.toLowerCase().match(/[a-z0-9_-]{2,}/g)||[];let n=0;for(const x of b)if(a.has(x))n++;return n/Math.sqrt(Math.max(1,a.size*b.length))}
function cos(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}return d/(Math.sqrt(na*nb)||1)}
async function emb(t){const ai=await localAI();document.getElementById("omniAsStatus").textContent="LOADING AI";return ai.embed(t)}
// Knowledge base rule: every supported file inside knowledge-base/ is assistant knowledge.
// manifest.json is regenerated automatically (Pages deploy + Local Engine), and on GitHub Pages the
// live folder listing is merged in so files saved from Private RAG count before the next deploy.
const KB_FILE=/\.(md|markdown|txt|text|html?|json|csv|tsv|xml|ya?ml|rst|pdf|docx)$/i;
function pagesRepo(){const h=location.hostname||"";if(!h.endsWith(".github.io"))return "";const repo=location.pathname.split("/").filter(Boolean)[0];return repo?h.split(".")[0]+"/"+repo:""}
async function knowledgeFiles(base){
 let files=[];
 try{const r=await fetch(base+"knowledge-base/manifest.json",{cache:"no-store"});if(r.ok){const j=await r.json();files=(Array.isArray(j)?j:j.files||[]).map(f=>typeof f==="string"?{path:f}:f)}}catch(e){}
 const repo=pagesRepo();
 if(repo){try{const r=await fetch("https://api.github.com/repos/"+repo+"/contents/knowledge-base?ref=main",{cache:"no-store"});if(r.ok){const known=new Set(files.map(f=>f.path));for(const x of await r.json())if(x.type==="file"&&!known.has(x.name))files.push({path:x.name,title:x.name.replace(/\.[^.]+$/,"").replace(/[_]+/g," "),raw:x.download_url})}}catch(e){}}
 const seen=new Set();
 return files.filter(f=>f&&f.path&&f.path!=="manifest.json"&&KB_FILE.test(f.path)&&!seen.has(f.path)&&seen.add(f.path));
}
async function knowledgeText(url,path){
 const r=await fetch(url,{cache:"no-store"});if(!r.ok)return "";
 if(/\.pdf$/i.test(path)){
  if(!window.pdfjsLib)return "";
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await r.arrayBuffer())}).promise;let t="";
  for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const c=await pg.getTextContent();t+=c.items.map(x=>x.str).join(" ").replace(/\s+/g," ").trim()+"\n\n";pg.cleanup()}
  try{await pdf.destroy()}catch(e){}
  return t;
 }
 if(/\.docx$/i.test(path)){
  if(!window.JSZip)return "";
  const z=await JSZip.loadAsync(await r.arrayBuffer());const xml=await z.file("word/document.xml")?.async("text");if(!xml)return "";
  return xml.replace(/<w:tab[^>]*\/>/g,"\t").replace(/<\/w:p>/g,"\n").replace(/<[^>]+>/g,"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");
 }
 const t=await r.text();
 if(/\.html?$/i.test(path)){const d=new DOMParser().parseFromString(t,"text/html");d.querySelectorAll("script,style,noscript").forEach(n=>n.remove());return (d.body?.textContent||"").replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n")}
 return t;
}
async function loadKnowledge(includePrivate=false){
 const base=location.href.replace(/[^/]+$/,"");
 if(!knowledgeLoaded){knowledgeLoaded=true;try{const files=await knowledgeFiles(base);const loaded=await Promise.all(files.map(async f=>{try{const text=await knowledgeText(f.raw||base+"knowledge-base/"+f.path.split("/").map(encodeURIComponent).join("/"),f.path);if(!text||!text.trim())return null;const source=f.title||f.path;return split(text).map(c=>({source,text:c,kbPath:f.path}))}catch(e){console.warn("Omni Assistant could not read knowledge file:",f.path,e);return null}}));loaded.flat().forEach(x=>{if(x)docs.push(x)})}catch(e){}}
 if(includePrivate&&!privateLoaded){privateLoaded=true;try{const db=await new Promise((res,rej)=>{const r=indexedDB.open("omni-private-rag-v1",2);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});if(db.objectStoreNames.contains("chunks")){const rows=await new Promise((res,rej)=>{const q=db.transaction("chunks","readonly").objectStore("chunks").getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error)});for(const x of rows)docs.push({source:"Private RAG: "+x.source,text:x.text,vector:x.vector,repo:x.meta?.repository,blobSha:x.meta?.blobSha})}if(db.objectStoreNames.contains("meta")){const m=await new Promise((res,rej)=>{const q=db.transaction("meta","readonly").objectStore("meta").get("repository");q.onsuccess=()=>res(q.result?.value||null);q.onerror=()=>rej(q.error)});if(m?.commitSha){const s=document.getElementById("omniAsStatus");if(s)s.title=`Repository indexed at commit ${m.commitSha.slice(0,7)}`;}}}catch(e){}}
}
function needsPrivateKnowledge(q){return /my document|my file|indexed|index|repository|repo|source code|implementation|codebase|commit|private rag/i.test(q)}
async function retrieve(q){
 if(!docs.length)await loadKnowledge();
 if(!docs.length)return[];
 const terms=(q.toLowerCase().match(/[a-z0-9_-]{2,}/g)||[]);
 const topicBoost=d=>{
   const t=String(d.text||"").toLowerCase(),s=String(d.source||"").toLowerCase();
   let b=0;
   if(/sql|database|query/.test(q.toLowerCase())&&(/database|sql|query|table|schema/.test(t+" "+s)))b+=0.18;
   if(/program|coding|code|javascript|python/.test(q.toLowerCase())&&(/code|program|javascript|python|developer/.test(t+" "+s)))b+=0.18;
   if(/universal data/.test(q.toLowerCase())&&/universal data|structured|semi-structured|unstructured/.test(t+" "+s))b+=0.22;
   if(/pdf|powerpoint|ppt|word|excel/.test(q.toLowerCase())&&/office|pdf|powerpoint|word|excel/.test(t+" "+s))b+=0.15;
   return b;
 };
 const lexicalRank=docs.map(d=>({...d,lexical:lex(q,d.text),topic:topicBoost(d)}))
   .map(d=>({...d,score:d.lexical+d.topic}))
   .sort((a,b)=>b.score-a.score);
 const lexicalCandidates=lexicalRank.slice(0,48);
 const qv=await emb(q);
 const scored=lexicalCandidates.map(d=>{
   const semantic=d.vector?cos(qv,d.vector):0;
   return {...d,score:(0.62*d.score)+(0.38*semantic)};
 }).sort((a,b)=>b.score-a.score);
 const relevant=scored.filter(x=>x.lexical>=0.08||x.topic>0||x.score>=0.14);
 return (relevant.length?relevant:scored).slice(0,8);
}
function intentAnswer(q){
 const s=q.toLowerCase().trim();
 const target=studioAction(s);
 if(!target?.tab)return null;
 if(/^(i want to|i need to|i need|i want|looking to|looking for|need to|want to|help me|work with|use|process|convert|handle|manage|query|run|analy[sz]e|edit|create|open)/.test(s)){
  const reasons={
   "PDF Suite":"PDF documents and PDF-specific workflows.",
   "Office Studio":"Word, PowerPoint and spreadsheet workflows.",
   "Data Studio":"CSV, JSON and structured/semi-structured data workflows.",
   "Database Studio":"SQL and database inspection/query workflows.",
   "Image Tools":"image conversion and manipulation.",
   "Image to Text":"OCR and image-to-text extraction.",
   "Audio Studio":"audio processing and conversion.",
   "Video Studio":"video processing and conversion.",
   "Compressor":"compression and file-size reduction.",
   "Private RAG":"private browser-local document retrieval.",
   "Code Studio":"code and data-format utilities.",
   "Universal Data":"broader structured, semi-structured and unstructured data workflows.",
   "Data Clean":"data cleaning and normalization.",
   "Batch Lab":"batch processing workflows."
  };
  return "Use "+target.name+" for "+(reasons[target.name]||"this workflow")+"";
 }
 return null;
}
function fastAnswer(q){const s=q.toLowerCase().replace(/[?!.]/g,"").trim();const current=currentStudio?.name;
if(/^(hi|hello|hey|hiya|good morning|good afternoon|good evening|howdy)$/.test(s))return "Hi! I’m Omni Assistant. What would you like to do with Omni Suite?";
if(/^(thanks|thank you|thx|ty)$/.test(s))return "You’re welcome! What would you like to work on next?";
if(/^(bye|goodbye|see you)$/.test(s))return "Goodbye! I’ll be here when you need help with Omni Suite.";
if(/^(which studio|what studio|where should i start|help me choose)/.test(s))return "Tell me what you want to work with and I’ll point you to the right Studio. PDF → PowerPoint = Office Studio; OCR = Image to Text; CSV/JSON/data conversion = Data Studio; database queries = Database Studio; batch work = Batch Lab.";
if(/pdf.*(powerpoint|ppt)|(?:powerpoint|ppt).*pdf/.test(s))return "For PDF ↔ PowerPoint, use Office Studio. Omni Suite is browser-first where practical; heavier or unsupported operations can fall back to the Local Engine.";
if(/how.*(file|document).*conversion|how.*conversion.*work|file conversion/.test(s))return "Omni Suite uses a browser-first conversion pipeline: it first tries a supported in-browser converter, keeps processing local where possible, and uses the Local Engine only when the browser cannot reliably perform the operation. The exact path depends on the file format and Studio." ;
if(/what can omni|what does omni|what is omni suite/.test(s))return "Omni Suite is a browser-first workspace for file conversion, document processing, data work, media tools, diagnostics, and local/private workflows.";
if(/what can (we|i) do with universal data|what.*universal data|universal data.*(do|support|handle)/.test(s))return "Universal Data Studio is for structured, semi-structured, unstructured and signal-style data. It can normalize CSV/TSV, JSON/NDJSON, GeoJSON, GPX and KML, inspect records and numeric fields, preview geospatial data and audio, visualize numeric series, export normalized data, and use the Local Engine when native or binary formats need heavier decoding.";
if(/where can i (test|run)|where.*test.*sql|where.*run.*sql|test.*sql|sql.*test/.test(s))return "For SQL and database-related work, open Database Studio. It is the Omni Suite area intended for SQL/database workflows; use it for the SQL functionality exposed by the current browser/local implementation rather than assuming a connection to an external database.";
if(/^(how to use programming|how.*programming|i want to do programming|i want.*program|need.*program|want.*code|how.*code)/.test(s))return "Use Code Studio for programming and code-oriented work. Open Code Studio to work with code utilities and supported programming/data-format workflows.";
if(/privacy|private|secure|api key/.test(s))return "Omni Suite is designed browser-first. Private RAG keeps indexed chunks and vectors in this browser’s IndexedDB, and its optional local LLM receives retrieved context rather than your whole document. Fresh-browser AI model assets may still need to download.";
if(/troubleshoot|not working|error|broken|failed/.test(s))return current?"You’re currently in "+current+". Start with Diagnostics or System Doctor to check browser/engine capabilities; All Tests can run integrated checks and filter failed tests.":"Start with Diagnostics or System Doctor to check browser/engine capabilities; All Tests can run integrated checks and filter failed tests.";
if(/current studio|where am i/.test(s))return current?"You are currently in "+current+".":"You’re currently at the Omni Suite overview.";return null}
function cleanAssistantAnswer(text){
 let s=String(text||"").replace(/\r/g,"");
 const lines=s.split("\n").filter(line=>{
   const x=line.trim();
   if(!x)return true;
   if(/^(?:[-*]\s*)?(?:\d+[.)]\s*)?\*{0,2}\s*\[?\s*(?:Source|Citation|Reference)\s*\d+[^\n]*$/i.test(x))return false;
   if(/^(?:Sources?|Citations?|References?)\s*:/i.test(x))return false;
   return true;
 });
 s=lines.join("\n");
 s=s.replace(/\[\s*(?:Source|Citation|Reference)\s*\d+(?:\s*:[^\]]*)?\s*\]/gi,"");
 s=s.replace(/\*{0,2}\[?\s*(?:Source|Citation|Reference)\s*\d+\s*\]?\*{0,2}/gi,"");
 s=s.replace(/(?:\*{0,2})\[?\s*Your Company Name\s*\]?\*{0,2}/gi,"");
 const lines2=s.split("\n");
 const counts={};
 lines2.forEach(line=>{const k=line.trim().toLowerCase();if(k)counts[k]=(counts[k]||0)+1;});
 s=lines2.filter(line=>{const k=line.trim().toLowerCase();return !(counts[k]>=3 && /your company name|company name|placeholder|lorem ipsum/i.test(k));}).join("\n");
 // The local 270M model can occasionally emit citation-like numeric spans
 // (for example "[2000-2001]") even when the prompt forbids citations.
 // They are not valid Omni Suite source references, so remove them before rendering.
 s=s.replace(/\[\s*\d{1,6}\s*[-–—]\s*\d{1,6}\s*\]/g,"");
 return s.replace(/\n{3,}/g,"\n\n").trim();
}
function uniqueSources(rows){
 const seen=new Set();
 return rows.filter(x=>{const key=String(x.source||"").trim().toLowerCase();if(!key||seen.has(key))return false;seen.add(key);return true;});
}
async function generate(q,r,view){const ai=await localAI();const cap=ai.capability();if(cap.constrained&&!cap.webgpu)return cleanAssistantAnswer(r[0]?.text)||"Retrieved Omni Suite knowledge is available, but the local model is constrained on this device.";document.getElementById("omniAsStatus").textContent="LOADING GEMMA";const context=r.slice(0,3).map((x,i)=>"REFERENCE "+String.fromCharCode(65+i)+": "+x.source+"\n"+String(x.text).replace(/Your Company Name/gi,"").slice(0,420)).join("\n\n");const studio=currentStudio?.name?"\nCURRENT STUDIO: "+currentStudio.name:"";const prompt="You are Omni Assistant for Omni Suite. Answer only from the supplied references. Be concise: 1-3 short sentences. Do not invent capabilities. Never output reference labels, citation placeholders, numbered reference lists, source lists, or bracketed labels such as [Source 1]. Sources are rendered by the interface separately."+studio+"\n\nREFERENCES:\n"+context+"\n\nQUESTION: "+q+"\nANSWER:";let streamed="";const o=await ai.generate(prompt,{max_new_tokens:64,temperature:.1,onToken:t=>{streamed+=String(t);if(view){view.textContent=cleanAssistantAnswer(streamed);view.dataset.streaming="1"}}});const answer=cleanAssistantAnswer(o||streamed||"");
if(answer)return answer;
const fallback=cleanAssistantAnswer(r[0]?.text||"");
return fallback?"I found relevant Omni Suite knowledge, but the local model returned no generated text.\n\nRelevant knowledge:\n"+fallback:"I found relevant Omni Suite knowledge, but the local model returned no generated text. Try Retrieval only or ask the question again."; }
function updateContext(){currentStudio=studioContext();const e=document.getElementById("omniAsContext");if(e)e.textContent=currentStudio?.name?"Context: "+currentStudio.name:"Context: Omni Suite overview";updateAIHint()} function updateAIHint(){const e=document.getElementById("omniAsAIHint");if(!e||!window.OmniLocalAI)return;const s=window.OmniLocalAI.status();e.textContent=s.state==="idle"?(s.mobile?(s.constrained?"Mobile device detected · Local AI may be slower.":"Mobile-ready · Local AI loads only when needed."):"Local AI is idle until you ask a question."):(s.webgpu?"Local AI · WebGPU":"Local AI · WASM")}
function add(text,kind){const c=document.createElement("div");c.className="omni-as-msg "+kind;c.textContent=text;document.getElementById("omniAsChat").appendChild(c);c.scrollIntoView({block:"end"});return c}
async function ask(){if(busy)return;updateContext();const input=document.getElementById("omniAsInput"),q=input.value.trim();if(!q)return;input.value="";add(q,"user");
const instant=intentAnswer(q)||fastAnswer(q);if(instant){const wait=add(instant,"bot");const target=studioAction(q);if(target?.tab){const action=document.createElement("button");action.className="omni-as-action";action.textContent="Open "+target.name;action.onclick=()=>openStudio(target.tab);wait.appendChild(action)}return}
const wait=add("Searching Omni Suite knowledge…","bot");busy=true;try{if(needsPrivateKnowledge(q))await loadKnowledge(true);const r=await retrieve(q);if(!r.length){wait.textContent="I don’t have verified information for that yet. Try asking about a Studio, conversion, supported workflow, privacy, or troubleshooting."}else{let ans;try{ans=await generate(q,r,wait);document.getElementById("omniAsStatus").textContent=navigator.gpu?"LOCAL · WEBGPU":"LOCAL · WASM"}catch(e){ans=r[0].text;document.getElementById("omniAsStatus").textContent="RETRIEVAL FALLBACK"}ans=cleanAssistantAnswer(ans);if(!ans)ans=cleanAssistantAnswer(r[0]?.text)||"I found relevant Omni Suite knowledge, but the local model returned no usable answer. Please try the question again.";wait.textContent=ans;const target=studioAction(q);if(target?.tab){const action=document.createElement("button");action.className="omni-as-action";action.textContent="Open "+target.name;action.onclick=()=>openStudio(target.tab);wait.appendChild(action)}const src=document.createElement("div");src.className="omni-as-source";const displayedSources=uniqueSources(r).slice(0,3);src.innerHTML="Sources: "+displayedSources.map(x=>{const m=String(x.source).match(/^Repository: (.+)$/)||(x.kbPath?[null,"knowledge-base/"+x.kbPath]:null);return m?"<a href=\"https://github.com/theraghavraman/omni_suite_light/blob/main/"+m[1].split("/").map(encodeURIComponent).join("/")+"\" target=\"_blank\" rel=\"noopener noreferrer\">"+esc(x.kbPath&&!String(x.source).startsWith("Repository: ")?x.source:m[1])+"</a>":esc(x.source)}).join(" · ");wait.appendChild(src)}}catch(e){wait.textContent="I couldn’t complete the local retrieval right now. Please try again; the assistant does not send your question to a remote AI API."}finally{busy=false}}
function start(){styles();ui();updateContext();document.querySelectorAll(".nav-btn").forEach(b=>b.addEventListener("click",()=>setTimeout(updateContext,0)));if(window.OmniLocalAI){window.OmniLocalAI.onStatus(x=>{const e=document.getElementById("omniAsStatus");if(e)e.textContent=x.state==="ready-webgpu"?"LOCAL · WEBGPU":x.state==="ready-wasm"?"LOCAL · WASM":x.state==="loading"?"PREPARING AI":"LOCAL-FIRST";updateAIHint()});updateAIHint();const cap=window.OmniLocalAI.capability();const conn=navigator.connection||{};if(!cap.mobile&&cap.webgpu&&!conn.saveData&&conn.effectiveType!=="2g"&&conn.effectiveType!=="slow-2g")setTimeout(()=>window.OmniLocalAI.warmChat().catch(()=>{}),1800)}}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();