/* Omni Suite — Private RAG Studio
 * Browser-first RAG: IndexedDB knowledge store, semantic embeddings, vector search,
 * lexical/semantic hybrid retrieval, optional local small LLM, and repository knowledge.
 */
(()=>{"use strict";
const $=id=>document.getElementById(id);
const DB="omni-private-rag-v1", STORE="chunks", META="meta", REPO_KEY="repository";
let db=null, embedder=null, generator=null, chunks=[], lastResults=[];
const MODEL_EMBED="Xenova/all-MiniLM-L6-v2";
const MODEL_LLM="onnx-community/gemma-3-1b-it-ONNX";
const CDN="https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";

function css(){
 if($("omni-rag-css"))return;
 const s=document.createElement("style");s.id="omni-rag-css";s.textContent=`
#tabRAGStudio{--studio-accent:#7c5cff;--studio-accent-2:#00b8d9}
.rag-hero{background:radial-gradient(circle at 90% 0%,rgba(124,92,255,.16),transparent 38%),linear-gradient(145deg,#fff,#f7f5ff)}
.rag-kicker{font-size:.72rem;font-weight:800;letter-spacing:.14em;color:#7154d9;text-transform:uppercase}
.rag-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}
.rag-statbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.rag-stat{padding:8px 11px;border:1px solid #dfe3ef;border-radius:12px;background:#fff;font-size:.78rem}.rag-stat b{display:block;font-size:1rem}
.rag-drop{border:1.5px dashed #b8afd9;border-radius:16px;padding:24px;text-align:center;background:#fbfaff;cursor:pointer}.rag-drop.drag{border-color:#7c5cff;background:#f3f0ff}
.rag-list{max-height:260px;overflow:auto;border:1px solid #e1e5ee;border-radius:14px}.rag-item{padding:10px 12px;border-bottom:1px solid #edf0f5;display:flex;justify-content:space-between;gap:12px}.rag-item:last-child{border-bottom:0}.rag-item small{display:block;color:#70798b}
.rag-answer{min-height:150px;white-space:pre-wrap;line-height:1.55;border:1px solid #e0e4ed;border-radius:14px;padding:16px;background:#fbfcfe}
.rag-source{padding:10px 12px;border:1px solid #e4e7ef;border-radius:12px;margin-top:8px;background:#fff}.rag-source b{display:block}.rag-source b a{color:#5d46bd;text-decoration:none}.rag-source b a:hover{text-decoration:underline}.rag-source small{color:#667085}
.rag-status{font-size:.82rem;color:#667085}.rag-ok{color:#087f5b}.rag-warn{color:#9a6700}.rag-error{color:#b42318}
.rag-controls{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.rag-controls .form-group{margin:0}
.rag-pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:#f0edff;color:#5d46bd;font-size:.72rem;font-weight:700}
.rag-model-card{position:relative;overflow:hidden;background:linear-gradient(145deg,#fff,#faf9ff);border:1px solid #e8e5f4}
.rag-model-card::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,#7c5cff,#ff4f9a,#ff8a3d)}
.rag-model-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}
.rag-local-badge{flex:0 0 auto;padding:6px 9px;border-radius:999px;background:#e9fbf5;color:#087f5b;font-size:.65rem;font-weight:900;letter-spacing:.06em}
.rag-model-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.rag-model-item{min-width:0;display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;padding:12px;border:1px solid #eceaf3;border-radius:14px;background:rgba(255,255,255,.82)}
.rag-model-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:#f1eeff;color:#674fd0;font-size:.9rem;font-weight:800}
.rag-model-item:nth-child(2) .rag-model-icon{background:#fff0f7;color:#d52d79}
.rag-model-item:nth-child(3) .rag-model-icon{background:#eafaff;color:#008da3}
.rag-model-item:nth-child(4) .rag-model-icon{background:#ecfbf5;color:#087f5b}
.rag-model-item b{display:block;font-size:.78rem;line-height:1.2;color:#24233e}
.rag-model-item span{display:block;margin-top:3px;font-size:.69rem;line-height:1.35;color:#70768b}
.rag-dot{display:grid;place-items:center;width:20px;height:20px;font-size:.72rem}
.rag-dot.ok{color:#0a9b70}.rag-dot.warn{color:#d08a00}.rag-dot.busy{color:#6c5cff}.rag-dot.idle{color:#a2a6b5}
.rag-privacy-strip{display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:11px 12px;border:1px solid #dff0ea;border-radius:13px;background:#f7fcfa}
.rag-privacy-strip>span{font-size:1rem;line-height:1.2}
.rag-privacy-strip b{display:block;font-size:.75rem;color:#087f5b}
.rag-privacy-strip small{display:block;margin-top:2px;font-size:.67rem;line-height:1.45;color:#667085}
@media(max-width:850px){.rag-grid{grid-template-columns:1fr}.rag-controls{grid-template-columns:1fr}.rag-model-grid{grid-template-columns:1fr}.rag-model-item{padding:11px}.rag-model-head{align-items:flex-start}.rag-local-badge{font-size:.58rem}}
@media(max-width:430px){.rag-model-head{gap:8px}.rag-model-head h3{font-size:1.12rem!important}.rag-kicker{font-size:.64rem}.rag-model-item{grid-template-columns:30px minmax(0,1fr) auto;gap:8px}.rag-model-icon{width:28px;height:28px}.rag-model-item span{font-size:.66rem}.rag-privacy-strip small{font-size:.64rem}}
`;document.head.appendChild(s)
}
function initDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,2);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE)){const st=d.createObjectStore(STORE,{keyPath:"id"});st.createIndex("source","source")}if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:"key"})};r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
function tx(mode){return db.transaction(STORE,mode).objectStore(STORE)}
function metaTx(mode){return db.transaction(META,mode).objectStore(META)}
function metaGet(key){return new Promise((res,rej)=>{const r=metaTx("readonly").get(key);r.onsuccess=()=>res(r.result?.value||null);r.onerror=()=>rej(r.error)})}
function metaSet(key,value){return new Promise((res,rej)=>{const r=metaTx("readwrite").put({key,value});r.onsuccess=res;r.onerror=()=>rej(r.error)})}
function deleteSources(sources){const set=new Set(sources);if(!set.size)return Promise.resolve();return new Promise((res,rej)=>{const t=tx("readwrite"),q=t.openCursor();q.onsuccess=()=>{const c=q.result;if(!c)return;if(set.has(c.value.source))c.delete();c.continue()};t.oncomplete=res;t.onerror=()=>rej(t.error)})}
function putMany(a){return new Promise((res,rej)=>{const t=tx("readwrite");a.forEach(x=>t.put(x));t.oncomplete=res;t.onerror=()=>rej(t.error)})}
function clearDB(){return new Promise((res,rej)=>{const r=tx("readwrite").clear();r.onsuccess=res;r.onerror=()=>rej(r.error)})}
function getAll(){return new Promise((res,rej)=>{const r=tx("readonly").getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)}
function splitText(text,size=900,overlap=140){text=text.replace(/\r/g,"").replace(/\n{3,}/g,"\n\n").trim();const out=[];for(let i=0;i<text.length;i+=size-overlap){let e=Math.min(text.length,i+size);if(e<text.length){const p=text.lastIndexOf("\n",e);if(p>i+500)e=p}const c=text.slice(i,e).trim();if(c)out.push(c);if(e>=text.length)break}return out}
function lexical(q,t){const a=new Set((q.toLowerCase().match(/[a-z0-9_]{2,}/g)||[]));const b=(t.toLowerCase().match(/[a-z0-9_]{2,}/g)||[]);if(!a.size)return 0;let n=0;for(const x of b)if(a.has(x))n++;return n/Math.sqrt(a.size*Math.max(1,b.length))}
function cosine(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}return d/(Math.sqrt(na)*Math.sqrt(nb)||1)}
async function loadTransformers(){if(window.__omniTransformers)return window.__omniTransformers;const m=await import(CDN);window.__omniTransformers=m;return m}
function setModelState(kind,state,text){const map={embed:["ragEmbedState","ragEmbedDot"],llm:["ragLLMState","ragLLMDot"],runtime:["ragRuntimeState","ragRuntimeDot"],storage:["ragStorageState","ragStorageDot"]};const ids=map[kind];if(!ids)return;const a=$(ids[0]),b=$(ids[1]);if(a)a.textContent=text;if(b)b.className="rag-dot "+state;b.textContent=state==="ok"?"●":state==="busy"?"◌":state==="warn"?"!":"○"}
function initRuntimeStatus(){const gpu=!!navigator.gpu;setModelState("runtime",gpu?"ok":"warn",gpu?"WebGPU available · faster local generation":"WebGPU unavailable · WASM fallback");setModelState("storage","ok","IndexedDB · browser-local")}
async function loadEmbedder(){if(embedder){setModelState("embed","ok","Ready · cached in this browser");return embedder}const m=await loadTransformers();setModelState("embed","busy","Downloading/loading model…");$("ragStatus").textContent="Loading local embedding model…";try{embedder=await m.pipeline("feature-extraction",MODEL_EMBED,{dtype:"q8"});setModelState("embed","ok","Ready · cached in this browser");return embedder}catch(e){setModelState("embed","warn","Unavailable · "+e.message);throw e}}
async function embed(text){const p=await loadEmbedder();const o=await p(text,{pooling:"mean",normalize:true});return Array.from(o.data)}
async function extractFile(f){
 const n=f.name.toLowerCase();
 if(n.endsWith(".pdf")&&window.pdfjsLib){const ar=await f.arrayBuffer();const pdf=await pdfjsLib.getDocument({data:ar}).promise;let t="";for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i),c=await pg.getTextContent();t+=c.items.map(x=>x.str).join(" ")+"\n"}return t}
 if(n.endsWith(".docx")&&window.JSZip){const z=await JSZip.loadAsync(await f.arrayBuffer());const xml=await z.file("word/document.xml").async("text");return xml.replace(/<w:tab[^>]*\/>/g,"\t").replace(/<\/w:p>/g,"\n").replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim()}
 return await f.text()
}
async function indexText(text,source,meta={}){
 const parts=splitText(text);if(!parts.length)return 0;const out=[];for(let i=0;i<parts.length;i++){const c=parts[i];$("ragStatus").textContent=`Embedding ${i+1}/${parts.length} — ${source}`;out.push({id:source+"#"+i+"-"+hash(c),source,text:c,meta,index:i,vector:await embed(c)})}await putMany(out);chunks=await getAll();return out.length}
async function addFiles(files){for(const f of files){try{const t=await extractFile(f);await indexText(t,f.name,{type:f.type,size:f.size});}catch(e){console.error(e);$("ragStatus").textContent="Could not index "+f.name+": "+e.message}}updateStats()}
async function search(q){if(!chunks.length)chunks=await getAll();if(!chunks.length)return[];const qv=await embed(q);return chunks.map(x=>{const v=cosine(qv,x.vector),l=lexical(q,x.text);return {...x,score:.78*v+.22*Math.min(1,l)}}).sort((a,b)=>b.score-a.score).slice(0,Number($("ragTopK").value||6))}
function renderResults(r){lastResults=r;const box=$("ragSources");box.innerHTML=r.length?r.map((x,i)=>{const m=String(x.source).match(/^Repository: (.+)$/);const title=m?esc(m[1]):esc(x.source);const link=m?`<a href="https://github.com/theraghavraman/omni_suite_light/blob/main/${m[1].split("/").map(encodeURIComponent).join("/")}" target="_blank" rel="noopener noreferrer">${title}</a>`:title;return `<div class="rag-source"><b>${i+1}. ${link}</b><small>Semantic/vector score ${x.score.toFixed(3)} · chunk ${x.index+1}</small><div style="margin-top:6px">${esc(x.text.slice(0,420))}${x.text.length>420?"…":""}</div></div>`}).join(""):"No relevant sources found."}
function esc(s){return String(s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
async function answer(){
 const q=$("ragQuery").value.trim();if(!q)return;
 $("ragAnswer").textContent="Retrieving relevant knowledge…";$("ragSources").innerHTML="";
 try{const r=await search(q);renderResults(r);if(!r.length){$("ragAnswer").textContent="No indexed knowledge found. Add documents or refresh the repository knowledge base.";return}
 const context=r.map((x,i)=>`[Source ${i+1}: ${x.source}]\n${x.text}`).join("\n\n");
 if($("ragUseLLM").value==="true"){try{$("ragAnswer").textContent="Running the local small LLM…";const m=await loadTransformers();if(!generator){setModelState("llm","busy","Loading local model…");generator=await m.pipeline("text-generation",MODEL_LLM,{dtype:"q4",device:navigator.gpu?"webgpu":"wasm"});setModelState("llm","ok",navigator.gpu?"Ready · WebGPU":"Ready · WASM");}const prompt=`Use ONLY the supplied sources. If the answer is not supported, say you don't know.\n\nSOURCES:\n${context}\n\nQUESTION: ${q}\nANSWER:`;const o=await generator([{role:"user",content:prompt}],{max_new_tokens:120,temperature:.2,do_sample:false});const g=Array.isArray(o)?o[0]?.generated_text:null;const raw=Array.isArray(g)?(g[g.length-1]?.content||""):typeof g==="string"?g:String(g||o);$("ragAnswer").textContent=raw.includes("ANSWER:")?raw.split("ANSWER:").pop().trim():raw.replace(prompt,"").trim()}catch(e){$("ragAnswer").textContent="Local LLM unavailable on this browser/device. Retrieved context is shown below.\n\n"+r.map(x=>x.text).join("\n\n");setModelState("llm","warn","Unavailable · retrieval-only fallback");$("ragStatus").textContent="LLM fallback: "+e.message}}else{$("ragAnswer").textContent="Retrieved context (LLM disabled):\n\n"+r.map(x=>x.text).join("\n\n")}}
 catch(e){$("ragAnswer").textContent="RAG error: "+e.message;$("ragStatus").textContent="Error"}}
async function refreshRepo(){
 const status=$("ragStatus");status.textContent="Checking Omni Suite repository version…";
 try{
  const cr=await fetch("https://api.github.com/repos/theraghavraman/omni_suite_light/commits/main",{cache:"no-store"});
  if(!cr.ok)throw new Error("GitHub commit metadata unavailable");
  const commit=await cr.json(), commitSha=commit.sha, commitDate=commit.commit?.author?.date||commit.commit?.committer?.date||"";
  const previous=await metaGet(REPO_KEY);
  const INDEX_VERSION=2;
  if(previous?.indexVersion===INDEX_VERSION&&previous?.commitSha===commitSha){status.textContent=`Repository knowledge is up to date · ${previous.filesCount||0} files · ${chunks.filter(x=>x.meta?.repository).length} chunks · commit ${commitSha.slice(0,7)}`;updateStats();return}
  status.textContent="Reading complete repository file map…";
  const tree=await fetch("https://api.github.com/repos/theraghavraman/omni_suite_light/git/trees/main?recursive=1",{cache:"no-store"});
  if(!tree.ok)throw new Error("GitHub repository tree unavailable");
  const j=await tree.json();
  const files=(j.tree||[]).filter(x=>x.type==="blob"&&(/\.(html?|css|js|mjs|json|md|mdx|txt|py|sql|yaml|yml|csv|xml|svg|toml|ini|sh|ps1|bat|cmd|rst)$/i.test(x.path)||/(^|\/)(Dockerfile|Makefile|\.gitignore|\.gitattributes|requirements\.txt|Procfile)$/i.test(x.path))&&!/(node_modules|vendor\/|dist\/|build\/|coverage\/)/i.test(x.path));
  const treeMap=Object.fromEntries(files.map(x=>[x.path,x.sha]));
  const oldMap=previous?.files||{};
  const removed=Object.keys(oldMap).filter(p=>!treeMap[p]);
  await deleteSources(removed.map(p=>"Repository: "+p));
  const nextMap={...oldMap};
  removed.forEach(p=>delete nextMap[p]);
  let changed=0,failed=0,totalNewChunks=0;
  for(const x of files){
   if(oldMap[x.path]===x.sha)continue;
   try{
    await deleteSources(["Repository: "+x.path]);
    const rr=await fetch("https://raw.githubusercontent.com/theraghavraman/omni_suite_light/main/"+x.path,{cache:"no-store"});
    if(!rr.ok){failed++;continue}
    const t=await rr.text();if(t.length>300000){failed++;continue}
    totalNewChunks+=await indexText(t,"Repository: "+x.path,{repository:true,path:x.path,blobSha:x.sha,commitSha});
    nextMap[x.path]=x.sha;
    changed++;
   }catch(e){failed++}
  }
  await metaSet(REPO_KEY,{indexVersion:INDEX_VERSION,commitSha,commitDate,files:nextMap,filesCount:Object.keys(nextMap).length,changedAt:new Date().toISOString(),failed});
  chunks=await getAll();updateStats();
  status.textContent=`Repository indexed locally · ${files.length} repository files · ${chunks.filter(x=>x.meta?.repository).length} chunks · ${changed} updated · commit ${commitSha.slice(0,7)}${failed?" · "+failed+" skipped":""}`;
 }catch(e){status.textContent="Repository refresh failed: "+e.message}
}
async function updateRepoStatus(){
 const m=await metaGet(REPO_KEY).catch(()=>null),box=$("ragRepoStatus");if(!box)return;
 if(!m){box.innerHTML="<b>Repository knowledge</b><span>Not indexed yet · use Refresh Repository Knowledge</span>";return}
 box.innerHTML=`<b>Repository knowledge</b><span>● Up to date · ${m.filesCount||0} files · ${chunks.filter(x=>x.meta?.repository).length} chunks · commit ${String(m.commitSha).slice(0,7)}</span><small>Last checked ${m.changedAt?new Date(m.changedAt).toLocaleString():"unknown"}${m.failed?" · "+m.failed+" skipped":""}</small>`;
}
function updateStats(){$("ragChunks").textContent=chunks.length;$("ragDocs").textContent=new Set(chunks.map(x=>x.source)).size;$("ragIndex").textContent=chunks.length?"Local IndexedDB":"Empty";updateRepoStatus()}
function bind(){
 css();initRuntimeStatus();$("ragFiles").onchange=e=>addFiles([...e.target.files]);
 const d=$("ragDrop");d.onclick=()=>$("ragFiles").click();["dragover"].forEach(x=>d.addEventListener(x,e=>{e.preventDefault();d.classList.add("drag")}));d.addEventListener("dragleave",()=>d.classList.remove("drag"));d.addEventListener("drop",e=>{e.preventDefault();d.classList.remove("drag");addFiles([...e.dataTransfer.files])});
 $("ragAsk").onclick=answer;$("ragQuery").addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter")answer()});
 $("ragRepo").onclick=refreshRepo;$("ragClear").onclick=async()=>{await clearDB();chunks=[];updateStats();$("ragAnswer").textContent="Local knowledge index cleared."};
 $("ragEmbed").onclick=async()=>{try{await loadEmbedder();$("ragStatus").textContent="Semantic embedding model ready in this browser."}catch(e){$("ragStatus").textContent="Embedding model could not load: "+e.message}};
 $("ragQuery").addEventListener("input",()=>{$("ragStatus").textContent="Ready — semantic + vector hybrid retrieval."});
}
async function start(){await initDB();chunks=await getAll();updateStats();bind();$("ragStatus").textContent=chunks.length?"Local RAG index ready.":"Ready — add documents to create a private knowledge base."}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();