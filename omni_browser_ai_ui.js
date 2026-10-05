/* Omni Suite — contextual Browser AI Assist
 * Adds one consistent AI Assist control to every studio without changing
 * deterministic conversion paths. All models are lazy-loaded and cached.
 */
(()=>{"use strict";
const A=()=>window.OmniBrowserAI;
const PANELS={
 tabRAGStudio:["Summarize RAG content","Explain this retrieved knowledge","Find key points"],
 tabLanguageStudio:["Explain this language task","Rewrite this text clearly"],
 tabPdf:["Summarize PDF","Explain extracted PDF text","Find key points"],
 tabWord:["Summarize document","Rewrite selected text","Extract key points"],
 tabEpub:["Summarize book content","Summarize chapter text","Extract themes"],
 tabImages:["Describe image","Detect objects","Remove background","Estimate depth"],
 tabOcr:["Advanced OCR","Extract entities from OCR text","Summarize OCR text"],
 tabAudio:["Transcribe audio","Summarize transcript","Extract entities"],
 tabVideo:["Transcribe video audio","Summarize transcript","Describe current text"],
 tabCompress:["Explain compression choice","Recommend a compression strategy"],
 tabData:["Profile dataset","Explain columns","Suggest data-quality checks"],
 tabLocal:["Explain Local Engine status","Diagnose this Local Engine output"],
 tabVizInterchange:["Explain BI data","Summarize interchange result"],
 tabCodeStudio:["Explain code","Review code","Suggest improvements"],
 tabUniversalData:["Explain detected data","Suggest transformation","Profile data"],
 tabDatabaseStudio:["Explain SQL","Review SQL","Suggest SQL improvements"],
 tabDataClean:["Profile data quality","Suggest cleaning steps","Explain anomalies"],
 tabBatchLab:["Explain batch result","Suggest batch strategy"],
 tabLocalDoctor:["Explain diagnostics","Suggest likely fixes"],
 tabDiagnostics:["Explain diagnostic output","Suggest troubleshooting steps"],
 tabAllTests:["Explain failed tests","Suggest fixes for failures"]
};
const LABELS={tabRAGStudio:"Private RAG",tabLanguageStudio:"Language Engine",tabPdf:"PDF Suite",tabWord:"Office Studio",tabEpub:"EPUB Studio",tabImages:"Image Tools",tabOcr:"Image to Text / OCR",tabAudio:"Audio Studio",tabVideo:"Video Studio",tabCompress:"Compressor",tabData:"Data Studio",tabLocal:"Local Engine",tabVizInterchange:"BI Interchange",tabCodeStudio:"Code Studio",tabUniversalData:"Universal Data",tabDatabaseStudio:"Database Studio",tabDataClean:"Data Clean",tabBatchLab:"Batch Lab",tabLocalDoctor:"System Doctor",tabDiagnostics:"Diagnostics",tabAllTests:"All Tests"};
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function css(){
 if(document.getElementById("omni-browser-ai-css"))return;
 const s=document.createElement("style");s.id="omni-browser-ai-css";s.textContent=`
.omni-browser-ai{margin:0 0 16px;padding:12px 14px;border:1px solid rgba(108,92,255,.18);border-radius:16px;background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(247,245,255,.92));box-shadow:0 10px 24px rgba(74,58,150,.08);position:relative;z-index:3}
.omni-browser-ai-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.omni-browser-ai-title{display:flex;align-items:center;gap:8px;font-size:.78rem;font-weight:900;color:#29264a}
.omni-browser-ai-title span{padding:4px 7px;border-radius:999px;background:#ecfbf5;color:#087f5b;font-size:.58rem;letter-spacing:.05em}
.omni-browser-ai-sub{margin-top:3px;font-size:.67rem;color:#747b91}
.omni-browser-ai-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}
.omni-browser-ai-actions button{border:1px solid #ddd9f3;background:#fff;color:#5546a9;border-radius:10px;padding:7px 9px;font-size:.67rem;font-weight:800;cursor:pointer}
.omni-browser-ai-actions button:hover{background:#f1efff;transform:translateY(-1px)}
.omni-browser-ai-actions button:disabled{opacity:.5;cursor:wait}
.omni-browser-ai-output{display:none;margin-top:9px}
.omni-browser-ai-output.open{display:block}
.omni-browser-ai-output textarea{width:100%;min-height:120px;border:1px solid #e1dff0;border-radius:11px;padding:10px;background:#fff;color:#2b2a45;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.omni-browser-ai-status{margin-top:7px;font-size:.67rem;color:#69728a;min-height:16px}
.omni-browser-ai-status.busy{color:#6c5cff}.omni-browser-ai-status.ok{color:#087f5b}.omni-browser-ai-status.err{color:#b42318}
.omni-browser-ai-meta{font-size:.6rem;color:#8b90a2;margin-top:7px}
`;document.head.appendChild(s)
}
function visibleText(panel){
 const parts=[];
 panel.querySelectorAll("textarea,input[type=text],input:not([type]),[contenteditable=true],.output,.result,.status,[class*='output'],[class*='result'],[class*='status']").forEach(el=>{
   if(el.closest(".omni-browser-ai"))return;
   const v=("value"in el?el.value:el.textContent)||"";
   if(v.trim() && el.offsetParent!==null)parts.push(v.trim());
 });
 const txt=parts.join("\n\n");
 return txt.slice(0,9000);
}
function firstFile(panel,kind){
 const inputs=[...panel.querySelectorAll('input[type="file"]')];
 const withFile=inputs.filter(x=>x.files&&x.files.length);
 if(kind==="image")return withFile.find(x=>String(x.accept||"").includes("image"))?.files?.[0]||withFile.find(x=>x.files[0]?.type?.startsWith("image/"))?.files?.[0]||null;
 if(kind==="audio")return withFile.find(x=>String(x.accept||"").includes("audio"))?.files?.[0]||withFile.find(x=>/^audio\//.test(x.files[0]?.type||""))?.files?.[0]||null;
 if(kind==="pdf")return withFile.find(x=>String(x.accept||"").includes("pdf"))?.files?.[0]||withFile.find(x=>/\.pdf$/i.test(x.files[0]?.name||"")||x.files[0]?.type==="application/pdf")?.files?.[0]||null;
 return withFile[0]?.files?.[0]||null;
}
async function extractPdfText(file){
 if(!file)throw new Error("Choose a PDF in PDF Suite first.");
 if(!window.pdfjsLib?.getDocument)throw new Error("PDF text extraction is not available in this browser session.");
 const data=await file.arrayBuffer();
 const pdf=await window.pdfjsLib.getDocument({data}).promise;
 const pages=[];
 for(let n=1;n<=pdf.numPages;n++){
   const page=await pdf.getPage(n);
   const tc=await page.getTextContent();
   const text=tc.items.map(x=>x.str||"").join(" ").replace(/\s+/g," ").trim();
   if(text)pages.push("PAGE "+n+"\n"+text);
 }
 const joined=pages.join("\n\n");
 if(!joined.trim())throw new Error("This PDF has no selectable text. It may be a scanned/image-only PDF; run OCR first.");
 return {text:joined.slice(0,30000),pages:pages.length,totalPages:pdf.numPages};
}
async function contextFor(panel){
 if(panel.id==="tabPdf"){
   const file=firstFile(panel,"pdf");
   const extracted=await extractPdfText(file);
   return {text:extracted.text,meta:"Using extracted text from "+extracted.pages+" of "+extracted.totalPages+" PDF page(s)."};
 }
 return {text:visibleText(panel),meta:"Using visible Studio context."};
}
function pdfChunks(text,size=1600){
 const NL=String.fromCharCode(10);
 const clean=String(text||"").replace(/\u0000/g," ").replace(/[ \t]+/g," ").replace(new RegExp(NL+"{3,}","g"),NL+NL).trim();
 if(!clean)return [];
 const pages=clean.split(new RegExp("(?=PAGE \\d+"+NL+")","g")).filter(Boolean);
 const chunks=[];
 pages.forEach(page=>{
   if(page.length<=size){chunks.push(page);return;}
   const paras=page.split(new RegExp(NL+NL+"+")).filter(Boolean);let cur="";
   paras.forEach(p=>{if((cur+NL+NL+p).length>size&&cur){chunks.push(cur);cur=p}else cur=cur?cur+NL+NL+p:p});
   if(cur)chunks.push(cur);
 });
 return chunks.length?chunks:[clean.slice(0,size)];
}
async function pdfGenerate(text,instruction){
 const NL=String.fromCharCode(10);
 const chunks=pdfChunks(text);
 if(!chunks.length)throw new Error("The PDF contains no usable text.");
 const perChunk=[];
 for(let i=0;i<chunks.length;i++){
   perChunk.push(await A().generate(instruction+NL+NL+"DOCUMENT SECTION "+(i+1)+" OF "+chunks.length+":"+NL+chunks[i],{model:"summarizer",maxInput:2200,maxNewTokens:120}));
 }
 if(perChunk.length===1)return perChunk[0];
 const combined=perChunk.map((x,i)=>"SECTION "+(i+1)+" SUMMARY:"+NL+x).join(NL+NL);
 return await A().generate(instruction+NL+NL+"Combine these section summaries into one final answer. Remove duplicates and preserve concrete facts."+NL+NL+combined,{model:"summarizer",maxInput:2600,maxNewTokens:160});
}
function imageUrl(file){return URL.createObjectURL(file)}
function downloadBlob(blob,name){
 const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)
}
function wavBlob(audio,sr){
 const data=audio instanceof Float32Array?audio:Float32Array.from(audio);
 const buf=new ArrayBuffer(44+data.length*2),v=new DataView(buf);
 const w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
 w(0,"RIFF");v.setUint32(4,36+data.length*2,true);w(8,"WAVE");w(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,data.length*2,true);
 for(let i=0;i<data.length;i++)v.setInt16(44+i*2,Math.max(-1,Math.min(1,data[i]))*32767,true);
 return new Blob([buf],{type:"audio/wav"});
}
async function run(action,panel,ui){
 const ai=A();if(!ai)throw new Error("Browser AI Engine has not loaded yet.");
 ui.out.classList.add("open");ui.status.className="omni-browser-ai-status busy";ui.status.textContent="Reading the selected Studio input…";
 let result="",ctx={text:"",meta:""},text="",file=null;
 try{
   ctx=await contextFor(panel);
   text=ctx.text;
   file=firstFile(panel,action.kind);
   if(action.kind==="image"&&!file)throw new Error("Choose an image in this Studio first.");
   if(action.kind==="audio"&&!file)throw new Error("Choose an audio or video file first.");
   if(action.kind==="text"&&!text)throw new Error("Enter or generate some text in this Studio first.");
   ui.status.textContent="Loading the isolated browser model… first use may take a moment.";
   if(action.op==="summarize")result=await ai.summarize(text);
   else if(action.op==="pdfGenerate")result=await pdfGenerate(text,action.prompt);
   else if(action.op==="generate")result=await ai.generate(action.prompt+"\n\nSTUDIO CONTEXT:\n"+text,{model:action.model||"general",maxNewTokens:220});
   else if(action.op==="embed"){const v=await ai.embed(text);result="Embedding generated locally.\nDimensions: "+v.length+"\nFirst values: "+v.slice(0,12).map(x=>x.toFixed(4)).join(", ")}
   else if(action.op==="caption"){const u=imageUrl(file);try{result=await ai.caption(u)}finally{URL.revokeObjectURL(u)}}
   else if(action.op==="detect"){const u=imageUrl(file);try{const d=await ai.detect(u);result=d.length?d.map(x=>x.label+" — "+(x.score*100).toFixed(1)+"%").join("\n"):"No confident objects detected."}finally{URL.revokeObjectURL(u)}}
   else if(action.op==="background"){const u=imageUrl(file);try{const b=await ai.removeBackground(u);downloadBlob(b,"omni-background-removed.png");result="Background removed. PNG download started."}finally{URL.revokeObjectURL(u)}}
   else if(action.op==="depth"){const u=imageUrl(file);try{const d=await ai.depth(u);const b=d?.depth?.toBlob?await d.depth.toBlob():(d?.depth?.toCanvas?await new Promise(r=>d.depth.toCanvas().toBlob(r,"image/png")):null);if(b)downloadBlob(b,"omni-depth-map.png");result=b?"Depth map generated. PNG download started.":"Depth map generated, but this browser did not expose an image export method."}finally{URL.revokeObjectURL(u)}}
   else if(action.op==="asr"){const u=imageUrl(file);try{result=await ai.transcribe(u)}finally{URL.revokeObjectURL(u)}}
   else if(action.op==="tts"){const o=await ai.speak(text);const b=wavBlob(o.audio,o.sampling_rate||44100);downloadBlob(b,"omni-speech.wav");result="Speech generated. WAV download started."}
   else if(action.op==="ocr"){const u=imageUrl(file);try{result=await ai.advancedOcr(u)}finally{URL.revokeObjectURL(u)}}
   else if(action.op==="ner"){const d=await ai.entities(text);result=d.length?d.map(x=>x.word+" — "+x.entity_group+" ("+(Number(x.score||0)*100).toFixed(1)+"%)").join("\n"):"No entities detected."}
   else if(action.op==="docqa"){const q=window.prompt("Ask a question about the selected document image:","What is the main subject of this document?");if(!q)throw new Error("Document question cancelled.");const u=imageUrl(file);try{result=await ai.docQa(u,q)}finally{URL.revokeObjectURL(u)}}
   ui.textarea.value=result;ui.status.className="omni-browser-ai-status ok";ui.status.textContent="Done · model cached in this browser. "+ctx.meta;
 }catch(e){ui.textarea.value="";ui.status.className="omni-browser-ai-status err";ui.status.textContent="AI Assist failed: "+(e?.message||e)}
}
function actionDefs(panelId){
 const common={text:true};
 const map={
  tabRAGStudio:[["Summarize","summarize"],["Explain","generate","Explain the following retrieved knowledge in clear, practical language."],["Semantic vector","embed"]],
  tabLanguageStudio:[["Explain task","generate","Explain this language task and suggest a clear next step."],["Rewrite","generate","Rewrite the following text clearly while preserving meaning."]],
  tabPdf:[["Summarize PDF","pdfGenerate","Create a concise, factual summary of this PDF. Organize the answer with a short overview followed by the most important sections or facts. Use only information present in the PDF.","pdf"],["Explain","pdfGenerate","Explain this PDF content for a non-expert. Use short headings and bullets where useful. Do not invent information and do not repeat phrases.","pdf"],["Key points","pdfGenerate","Extract the most important facts from this PDF as concise bullet points. Include names, dates, roles, skills, numbers and other concrete details when present. Do not invent or repeat facts.","pdf"]],
  tabWord:[["Summarize","summarize"],["Rewrite","generate","Rewrite the following document text for clarity and professionalism."],["Key points","generate","Extract the key points from this document."]],
  tabEpub:[["Summarize","summarize"],["Themes","generate","Identify the major themes, ideas and recurring concepts in this book text."]],
  tabImages:[["Describe image","caption","image"],["Detect objects","detect","image"],["Remove background","background","image"],["Depth map","depth","image"]],
  tabOcr:[["Advanced OCR","ocr","image"],["Entities","ner"],["Summarize OCR","summarize"]],
  tabAudio:[["Transcribe","asr","audio"],["Summarize transcript","summarize"],["Entities","ner"]],
  tabVideo:[["Transcribe audio","asr","audio"],["Summarize transcript","summarize"],["Explain result","generate","Explain this video-processing result and identify any useful next steps."]],
  tabCompress:[["Explain choice","generate","Explain the current compression/conversion result and why the selected format or settings make sense."],["Recommend","generate","Recommend a sensible compression strategy for the current file and explain the trade-offs."]],
  tabData:[["Profile data","generate","Profile this dataset text. Identify columns, likely types, missing-value risks, duplicates, outliers and useful next checks."],["Explain columns","generate","Explain the columns in this dataset and what each appears to represent."],["Semantic vector","embed"]],
  tabLocal:[["Explain status","generate","Explain the Local Engine status/output below and identify actionable fixes if anything is unhealthy."],["Diagnose","generate","Diagnose the following Local Engine output and rank the most likely causes."]],
  tabVizInterchange:[["Explain BI data","generate","Explain this BI/interchange result and the important data-engineering implications."],["Summarize","summarize"]],
  tabCodeStudio:[["Explain code","generate","Explain the following code line by line at a practical level, then summarize its purpose."],["Review code","generate","Review this code for bugs, edge cases, maintainability and performance issues."],["Improve","generate","Suggest concrete improvements to this code without changing its intended behavior."]],
  tabUniversalData:[["Explain data","generate","Explain the detected data structure and what the user can safely do with it."],["Suggest transform","generate","Suggest useful browser-first transformations for this data and explain the expected outputs."],["Profile","generate","Profile this data for structure, types, missing values and conversion risks."]],
  tabDatabaseStudio:[["Explain SQL","generate","Explain the following SQL query, including joins, filters, grouping and likely output."],["Review SQL","generate","Review this SQL for correctness, edge cases and performance risks."],["Improve SQL","generate","Suggest a cleaner or more efficient version of this SQL and explain the changes."]],
  tabDataClean:[["Quality profile","generate","Profile the data for quality issues such as missing values, duplicates, inconsistent types, invalid formats and anomalies."],["Cleaning plan","generate","Create a practical step-by-step data-cleaning plan for this data."],["Semantic vector","embed"]],
  tabBatchLab:[["Explain batch","generate","Explain this batch-processing result and suggest the next action."],["Strategy","generate","Suggest a reliable batch-processing strategy for the current workload."]],
  tabLocalDoctor:[["Explain diagnostics","generate","Explain these System Doctor diagnostics and rank the likely root causes."],["Fix plan","generate","Create a concise troubleshooting plan from these diagnostics."]],
  tabDiagnostics:[["Explain diagnostics","generate","Explain these browser/runtime diagnostics and distinguish warnings from actionable failures."],["Troubleshoot","generate","Suggest a prioritized troubleshooting plan for these diagnostics."]],
  tabAllTests:[["Explain failures","generate","Explain the failed tests below and identify the most likely root cause for each."],["Fix plan","generate","Create a prioritized fix plan for the failed tests."]]
 };
 return (map[panelId]||[]).map(x=>({label:x[0],op:x[1],kind:x[3]||x[2]||"text",prompt:x[1]==="generate"?x[2]:""}));
}
function add(panel){
 if(!panel||panel.querySelector(".omni-browser-ai"))return;
 const id=panel.id,actions=actionDefs(id);if(!actions.length)return;
 const card=document.createElement("section");card.className="omni-browser-ai";
 card.innerHTML=`<div class="omni-browser-ai-head"><div><div class="omni-browser-ai-title">✨ AI Assist <span>LAZY • BROWSER-LOCAL</span></div><div class="omni-browser-ai-sub">Models stay unloaded until you click an action. Loaded models are cached for reuse.</div></div><div class="omni-browser-ai-meta" id="omni-ai-meta-${id}">0 models loaded</div></div><div class="omni-browser-ai-actions"></div><div class="omni-browser-ai-output"><textarea readonly aria-label="Browser AI result"></textarea><div class="omni-browser-ai-status">Ready · no browser model loaded.</div></div>`;
 const actionsEl=card.querySelector(".omni-browser-ai-actions"),out={out:card.querySelector(".omni-browser-ai-output"),textarea:card.querySelector("textarea"),status:card.querySelector(".omni-browser-ai-status")};
 actions.forEach(a=>{const b=document.createElement("button");b.type="button";b.textContent=a.label;b.onclick=async()=>{actionsEl.querySelectorAll("button").forEach(x=>x.disabled=true);try{await run(a,panel,out)}finally{actionsEl.querySelectorAll("button").forEach(x=>x.disabled=false);refreshMeta(card)}};actionsEl.appendChild(b)});
 panel.insertBefore(card,panel.firstElementChild);
}
function refreshMeta(card){
 const s=A()?.status?.();const m=card.querySelector(".omni-browser-ai-meta");if(m)m.textContent=(s?.runtime?.models_loaded||0)+" model"+((s?.runtime?.models_loaded||0)===1?"":"s")+" loaded";
}
function init(){
 css();
 Object.keys(PANELS).forEach(id=>add(document.getElementById(id)));
 const obs=new MutationObserver(()=>Object.keys(PANELS).forEach(id=>add(document.getElementById(id))));
 obs.observe(document.body,{childList:true,subtree:true});
 window.addEventListener("omni-browser-ai-refresh",()=>document.querySelectorAll(".omni-browser-ai").forEach(refreshMeta));
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();