/* Redmark Forge — Office Tools (v2)
 * Browser-only Word / Excel / PowerPoint / Notepad workspace.
 *
 * Open-source engines (loaded on demand through omni_vendor_loader.js, local vendor/ first):
 *   mammoth (BSD-2-Clause)        DOCX → HTML with formatting and images
 *   docx (MIT)                    HTML → DOCX with runs, lists, tables, images, links
 *   DOMPurify (Apache-2.0/MPL-2.0) sanitises opened/pasted HTML
 *   ExcelJS (MIT)                 XLSX read/write with styles, formulas, widths, merges
 *   SheetJS CE (Apache-2.0)       XLS/XLSB/ODS/CSV/TSV/FODS read/write
 *   fast-formula-parser (MIT) + Formula.js (MIT)   spreadsheet formula evaluation
 *   PptxGenJS (MIT)               PPTX/PPSX/POTX export
 * ODT/PDF/Markdown/Text output reuses the existing Omni document engine (omni_browser_docs.js).
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const root=()=>$('tabOfficeTools');
const isActive=()=>!!root()?.classList.contains('active');
const ext=n=>{const m=/\.([^.\/\\]+)$/.exec(String(n||''));return m?m[1].toLowerCase():'';};
const base=n=>String(n||'document').replace(/\.[^.\/\\]+$/,'')||'document';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=(m,e=false)=>{try{if(typeof window.omniNotify==='function')return window.omniNotify(m,e);}catch(_){}(e?console.warn:console.log)('[Office Tools] '+m);};
const lib=n=>window.OMNI_VENDOR?window.OMNI_VENDOR.load(n):Promise.reject(new Error('Library loader (omni_vendor_loader.js) is missing.'));
const store={get(k){try{return localStorage.getItem(k);}catch(_){return null;}},set(k,v){try{localStorage.setItem(k,v);return true;}catch(_){return false;}},del(k){try{localStorage.removeItem(k);}catch(_){}}};
const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
function readAsDataURL(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob);});}
function dataURLtoBytes(u){const m=/^data:([^;,]+)?(;base64)?,(.*)$/s.exec(u||'');if(!m)return null;const raw=m[2]?atob(m[3]):decodeURIComponent(m[3]);const b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);return {mime:(m[1]||'application/octet-stream').toLowerCase(),bytes:b};}
function loadImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Image could not be decoded'));i.src=src;});}
/* Downscale very large pictures so documents stay light. */
async function normaliseImageFile(file,maxW=1800){
  const url=await readAsDataURL(file);
  if(!/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i.test(file.type||''))throw new Error('Unsupported image type');
  if(/svg|gif/i.test(file.type))return url;
  const img=await loadImage(url);if(img.naturalWidth<=maxW)return url;
  const c=document.createElement('canvas');c.width=maxW;c.height=Math.round(img.naturalHeight*maxW/img.naturalWidth);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  return c.toDataURL(/png/i.test(file.type)?'image/png':'image/jpeg',.9);
}
/* Convert any data-URL image to PNG/JPEG bytes (docx/pdf writers accept a limited set). */
async function imageBytes(src,allowed=['image/png','image/jpeg']){
  let d=dataURLtoBytes(src);
  if(!d){try{const r=await fetch(src);const b=await r.blob();src=await readAsDataURL(b);d=dataURLtoBytes(src);}catch(_){return null;}}
  if(!d)return null;
  let img=null;try{img=await loadImage(src);}catch(_){return null;}
  if(d.mime==='image/jpg')d.mime='image/jpeg';
  if(!allowed.includes(d.mime)){const c=document.createElement('canvas');c.width=img.naturalWidth||1;c.height=img.naturalHeight||1;c.getContext('2d').drawImage(img,0,0);const png=dataURLtoBytes(c.toDataURL('image/png'));d={mime:'image/png',bytes:png.bytes};}
  return {...d,width:img.naturalWidth||1,height:img.naturalHeight||1};
}
const cssColorCtx=document.createElement('canvas').getContext('2d');
function toHex(c){if(!c||c==='transparent'||/rgba\([^)]*,\s*0\)$/.test(c))return null;cssColorCtx.fillStyle='#000';cssColorCtx.fillStyle=c;const v=cssColorCtx.fillStyle;if(/^#[0-9a-f]{6}$/i.test(v))return v.slice(1).toUpperCase();const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(v);if(!m||(m[4]!==undefined&&+m[4]===0))return null;return [m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('').toUpperCase();}
function printHTML(title,body,css){
  const f=document.createElement('iframe');f.setAttribute('aria-hidden','true');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';document.body.appendChild(f);
  const d=f.contentDocument;d.open();d.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>'+css+'</style></head><body>'+body+'</body></html>');d.close();
  const go=()=>{try{f.contentWindow.focus();f.contentWindow.print();}catch(e){notify('Printing failed: '+e.message,true);}setTimeout(()=>f.remove(),60000);};
  Promise.all([...d.images].map(i=>i.complete?0:new Promise(r=>{i.onload=i.onerror=r;}))).then(()=>setTimeout(go,60));
}

/* =====================================================================
 * Shared document state + file handling
 * ===================================================================== */
const MODES=['word','excel','powerpoint','notepad'];
const LABELS={word:'Word / Writer',excel:'Excel / Calc',powerpoint:'PowerPoint / Impress',notepad:'Notepad'};
const docs={word:{name:'Untitled.docx',dirty:false,handle:null},excel:{name:'Book1.xlsx',dirty:false,handle:null},powerpoint:{name:'Presentation.pptx',dirty:false,handle:null},notepad:{name:'Untitled.txt',dirty:false,handle:null}};
let mode='word';
const SAVE_FORMATS={
  word:[['docx','Word document (.docx)'],['odt','OpenDocument text (.odt)'],['rtf','Rich Text (.rtf)'],['pdf','PDF (.pdf)'],['html','Web page (.html)'],['md','Markdown (.md)'],['txt','Plain text (.txt)']],
  excel:[['xlsx','Excel workbook (.xlsx)'],['xls','Excel 97-2003 (.xls)'],['xlsb','Excel binary (.xlsb)'],['ods','OpenDocument spreadsheet (.ods)'],['fods','Flat ODS (.fods)'],['csv','CSV — active sheet (.csv)'],['tsv','TSV — active sheet (.tsv)'],['html','Web page — active sheet (.html)']],
  powerpoint:[['pptx','PowerPoint (.pptx)'],['ppsx','PowerPoint show (.ppsx)'],['potx','PowerPoint template (.potx)'],['pdf','PDF via print dialog'],['json','Redmark deck project (.json)']],
  notepad:[['*','Keep the extension in the file name']]
};
const OPEN_ACCEPT='.doc,.docx,.docm,.dotx,.dotm,.odt,.ott,.fodt,.rtf,.md,.markdown,.html,.htm,.xhtml,.pdf,.xls,.xlsx,.xlsm,.xlsb,.xlt,.xltx,.xltm,.ods,.ots,.fods,.csv,.tsv,.ppt,.pptx,.pptm,.ppsx,.potx,.potm,.odp,.json,.txt,.text,.log,.ini,.cfg,.conf,.env,.bat,.cmd,.ps1,.sh,.py,.js,.ts,.css,.sql,.xml,.yaml,.yml,.toml,.csv';
const ROUTE={
  word:new Set(['docx','docm','dotx','dotm','odt','ott','fodt','rtf','md','markdown','html','htm','xhtml','pdf']),
  excel:new Set(['xls','xlsx','xlsm','xlsb','xlt','xltx','xltm','ods','ots','fods','csv','tsv']),
  powerpoint:new Set(['pptx','pptm','ppsx','potx','potm'])
};
const NEEDS_LOCAL=new Set(['doc','dot','ppt','pps','pot','odp','otp','fodp','key','pages','numbers']);

function setMode(next){
  if(!MODES.includes(next))return;
  mode=next;
  MODES.forEach(t=>{const b=$('ot-'+t);if(b){b.classList.toggle('active',t===next);b.setAttribute('aria-selected',String(t===next));}$('ot-panel-'+t)?.classList.toggle('active',t===next);});
  $('ot-mode-label').textContent=LABELS[next];
  if(next==='excel'){ensureWorkbook();renderSheetTabs();renderGrid();ensureFormulaEngine();}
  if(next==='powerpoint'){if(!P.deck.slides.length)newDeck(true);renderDeck();}
  updateStatus();
}
function updateStatus(){
  const d=docs[mode];const st=$('ot-save-state');if(!st)return;
  st.textContent=d.dirty?'● Unsaved changes':'✓ Saved / ready';st.classList.toggle('dirty',d.dirty);
  $('ot-docname').textContent=d.name;$('ot-docname').title=d.name;
  if(mode==='notepad'&&$('ot-note-name').value!==d.name)$('ot-note-name').value=d.name;
}
function markDirty(m=mode){docs[m].dirty=true;if(m===mode)updateStatus();scheduleDraft(m);}
function markClean(m=mode){docs[m].dirty=false;if(m===mode)updateStatus();scheduleDraft(m);}
function confirmDiscard(m){return !docs[m].dirty||confirm('Discard unsaved changes in '+LABELS[m]+' ('+docs[m].name+')?');}

const FS_OK=typeof window.showSaveFilePicker==='function'&&window.isSecureContext&&window.self===window.top;
async function writeFile(m,blob,name,{saveAs=false}={}){
  const d=docs[m];
  if(FS_OK){
    try{
      let h=(!saveAs&&d.handle&&ext(d.handle.name)===ext(name))?d.handle:null;
      if(!h)h=await window.showSaveFilePicker({suggestedName:name});
      const w=await h.createWritable();await w.write(blob);await w.close();
      d.handle=h;return h.name||name;
    }catch(e){if(e&&e.name==='AbortError')return null;console.warn('File System Access save failed, downloading instead',e);}
  }
  download(blob,name);return name;
}
async function pickFile(){
  if(typeof window.showOpenFilePicker==='function'&&window.isSecureContext&&window.self===window.top){
    try{const [h]=await window.showOpenFilePicker({multiple:false});const f=await h.getFile();return {file:f,handle:h};}
    catch(e){if(e&&e.name==='AbortError')return null;}
  }
  return new Promise(res=>{const i=$('ot-file');i.value='';i.accept=OPEN_ACCEPT;i.onchange=()=>res(i.files?.[0]?{file:i.files[0],handle:null}:null);i.click();});
}
async function openFile(file,handle=null){
  if(!file)return;
  const e=ext(file.name);
  if(NEEDS_LOCAL.has(e)){notify('.'+e+' is a legacy/binary format the browser cannot edit. Convert it to '+(/^p|odp|key/.test(e)?'PPTX':'DOCX')+' in Office Studio (Local Engine) first, then open it here.',true);return;}
  const target=ROUTE.word.has(e)?'word':ROUTE.excel.has(e)?'excel':ROUTE.powerpoint.has(e)?'powerpoint':(e==='json'&&await looksLikeDeck(file))?'powerpoint':'notepad';
  if(!confirmDiscard(target))return;
  try{
    setBusy(true,'Opening '+file.name+'…');
    if(target==='word')await wordOpen(file);
    else if(target==='excel')await sheetOpen(file);
    else if(target==='powerpoint')await deckOpen(file);
    else await noteOpen(file);
    docs[target].name=target==='powerpoint'&&e==='json'?base(file.name)+'.pptx':file.name;
    docs[target].handle=handle&&(target!=='word'||['docx','odt','rtf','html','htm','md','txt'].includes(e))?handle:null;
    setMode(target);markClean(target);
    notify('Opened '+file.name+' in '+LABELS[target]+'.');
  }catch(err){console.error(err);notify('Could not open '+file.name+': '+(err.message||err),true);}
  finally{setBusy(false);}
}
async function looksLikeDeck(file){try{const t=await file.slice(0,400).text();return /"redmarkDeck"\s*:/.test(t);}catch(_){return false;}}
let busyTimer=null;
function setBusy(on,msg){const r=$('ot-root');if(!r)return;clearTimeout(busyTimer);if(on){busyTimer=setTimeout(()=>{r.classList.add('busy');r.dataset.busy=msg||'Working…';},150);}else{r.classList.remove('busy');}}

async function saveCurrent(opts={}){
  const m=mode,d=docs[m];
  let name=opts.name||d.name,fmt=(opts.format&&opts.format!=='*')?opts.format:ext(name);
  if(m==='notepad'){name=opts.name||$('ot-note-name').value||d.name;fmt=ext(name);}
  const allowed=SAVE_FORMATS[m].map(x=>x[0]);
  if(m!=='notepad'&&!allowed.includes(fmt)){fmt=allowed[0];}
  if(m!=='notepad')name=base(name)+'.'+fmt;
  try{
    setBusy(true,'Saving…');
    let blob=null,print=false;
    if(m==='word')({blob,print}=await wordExport(fmt));
    else if(m==='excel')blob=await sheetExport(fmt);
    else if(m==='powerpoint')({blob,print}=await deckExport(fmt));
    else blob=noteExport();
    if(print){notify('Choose “Save as PDF” in the print dialog.');return;}
    const saved=await writeFile(m,blob,name,{saveAs:!!opts.saveAs});
    if(!saved)return;
    if(m!=='excel'||!['csv','tsv','html'].includes(fmt)){d.name=saved;}
    markClean(m);if(m==='notepad')$('ot-note-name').value=d.name;
    notify('Saved '+saved+'.');
  }catch(err){console.error(err);notify('Save failed: '+(err.message||err),true);}
  finally{setBusy(false);}
}
function saveAsDialog(){
  const dlg=$('ot-saveas-dialog'),m=mode,d=docs[m];
  const sel=$('ot-saveas-format'),nameIn=$('ot-saveas-name');
  sel.innerHTML=SAVE_FORMATS[m].map(([v,l])=>'<option value="'+v+'">'+esc(l)+'</option>').join('');
  const cur=ext(m==='notepad'?$('ot-note-name').value:d.name);
  if(SAVE_FORMATS[m].some(x=>x[0]===cur))sel.value=cur;
  nameIn.value=m==='notepad'?($('ot-note-name').value||d.name):base(d.name);
  const note=()=>{const f=sel.value;$('ot-saveas-note').textContent=
    m==='excel'&&['csv','tsv','html'].includes(f)?'Only the active sheet is exported in this format.':
    m==='excel'&&f!=='xlsx'?'Cell colours/fonts are kept only in .xlsx; values, formulas and widths are kept here.':
    m==='word'&&['md','txt'].includes(f)?'Plain formats keep text structure but not colours or fonts.':
    m==='powerpoint'&&f==='pdf'?'Opens the print dialog — choose “Save as PDF”.':'';};
  sel.onchange=note;note();
  if(typeof dlg.showModal!=='function'){const n=prompt('Save as (include extension)',m==='notepad'?nameIn.value:d.name);if(n)saveCurrent({name:n,format:m==='notepad'?'*':ext(n),saveAs:true});return;}
  dlg.returnValue='';dlg.showModal();setTimeout(()=>nameIn.select(),30);
  nameIn.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();dlg.close('ok');}};
  dlg.onclose=()=>{if(dlg.returnValue!=='ok')return;const n=nameIn.value.trim();if(!n)return;saveCurrent({name:n,format:sel.value,saveAs:true});};
}
function newDoc(){
  if(!confirmDiscard(mode))return;
  if(mode==='word')newWord();else if(mode==='excel')newWorkbook();else if(mode==='powerpoint')newDeck();else newNote();
}
function printCurrent(){
  if(mode==='word')wordPrint();else if(mode==='excel')sheetPrint();else if(mode==='powerpoint')deckPrint();else notePrint();
}

/* ---------- drafts (auto-recovery) ---------- */
const DRAFT_KEY=m=>'redmark-office-draft-'+m;
const draftTimers={};
function scheduleDraft(m){clearTimeout(draftTimers[m]);draftTimers[m]=setTimeout(()=>saveDraft(m),1200);}
function saveDraft(m){
  let content;
  try{
    if(m==='word')content=$('ot-word-editor').innerHTML;
    else if(m==='notepad')content=$('ot-note-editor').value;
    else if(m==='powerpoint')content=JSON.stringify(P.deck);
    else if(m==='excel'){if(!X.wb)return;content=JSON.stringify(X.wb);}
  }catch(_){return;}
  if(content&&content.length>4.5e6){store.del(DRAFT_KEY(m));return;}
  if(!store.set(DRAFT_KEY(m),JSON.stringify({name:docs[m].name,dirty:docs[m].dirty,content,at:Date.now()})))store.del(DRAFT_KEY(m));
}
function loadDraft(m){try{const x=JSON.parse(store.get(DRAFT_KEY(m))||'null');return x&&x.content!=null?x:null;}catch(_){return null;}}

/* =====================================================================
 * WORD / WRITER
 * ===================================================================== */
const ED=()=>$('ot-word-editor');
let wordRange=null;
const PURIFY_CFG={ALLOWED_TAGS:['p','br','b','strong','i','em','u','s','strike','del','sub','sup','span','font','a','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tfoot','tr','td','th','caption','colgroup','col','img','blockquote','pre','code','hr','div','figure','figcaption','mark','small','big'],ALLOWED_ATTR:['href','src','alt','title','colspan','rowspan','style','align','width','height','color','face','size','class','data-page-break','start','type'],ALLOW_DATA_ATTR:false,ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml);base64,|#)/i};
const STYLE_KEEP=new Set(['font-weight','font-style','text-decoration','text-decoration-line','color','background-color','background','font-size','font-family','text-align','width','vertical-align','margin-left','padding-left']);
async function sanitize(html){
  const DP=await lib('dompurify');
  const clean=DP.sanitize(html,{...PURIFY_CFG,RETURN_DOM_FRAGMENT:true});
  clean.querySelectorAll('[style]').forEach(el=>{const keep=[];for(const prop of [...el.style]){if(STYLE_KEEP.has(prop)&&!/^mso-/i.test(prop)){const v=el.style.getPropertyValue(prop);if(!/expression|url\(/i.test(v))keep.push(prop+':'+v);}}if(keep.length)el.setAttribute('style',keep.join(';'));else el.removeAttribute('style');});
  clean.querySelectorAll('[class]').forEach(el=>{const c=el.classList.contains('ot-page-break')?'ot-page-break':'';if(c)el.className=c;else el.removeAttribute('class');});
  clean.querySelectorAll('img').forEach(i=>{i.style.maxWidth='100%';});
  const div=document.createElement('div');div.appendChild(clean);return div.innerHTML;
}
function wordSaveRange(){const s=getSelection();if(s&&s.rangeCount){const r=s.getRangeAt(0);if(ED().contains(r.commonAncestorContainer))wordRange=r.cloneRange();}}
function wordRestoreRange(){const ed=ED();if(document.activeElement!==ed)ed.focus({preventScroll:true});if(wordRange&&ed.contains(wordRange.commonAncestorContainer)){const s=getSelection();s.removeAllRanges();s.addRange(wordRange);}}
const wordChanged=()=>{markDirty('word');updateWordCount();};
function wcmd(cmd,val=null){
  wordRestoreRange();
  try{document.execCommand('styleWithCSS',false,['foreColor','hiliteColor','backColor'].includes(cmd));}catch(_){}
  let ok=false;try{ok=document.execCommand(cmd,false,val);}catch(_){}
  if(!ok&&cmd==='hiliteColor'){try{document.execCommand('backColor',false,val);}catch(_){}}
  normaliseFontTags();wordSaveRange();
  if(cmd!=='undo'&&cmd!=='redo')wordChanged();else{markDirty('word');updateWordCount();}
  refreshWordToolbar();
}
const PX_FOR_FONT_SIZE={1:'8pt',2:'10pt',3:'12pt',4:'14pt',5:'18pt',6:'24pt',7:'36pt'};
function normaliseFontTags(){
  ED().querySelectorAll('font').forEach(f=>{
    const s=document.createElement('span');
    if(f.getAttribute('face'))s.style.fontFamily=f.getAttribute('face');
    if(f.getAttribute('color'))s.style.color=f.getAttribute('color');
    if(f.getAttribute('size'))s.style.fontSize=f.dataset.pt||PX_FOR_FONT_SIZE[f.getAttribute('size')]||'12pt';
    while(f.firstChild)s.appendChild(f.firstChild);f.replaceWith(s);
  });
}
/* Apply an inline style to the selection (or to the next typed text when collapsed). */
function applyInlineStyle(prop,value){
  wordRestoreRange();const sel=getSelection();if(!sel.rangeCount)return;
  const r=sel.getRangeAt(0);
  if(r.collapsed){
    const span=document.createElement('span');span.style.setProperty(prop,value);span.textContent='\u200B';r.insertNode(span);
    const nr=document.createRange();nr.setStart(span.firstChild,1);nr.collapse(true);sel.removeAllRanges();sel.addRange(nr);
  }else{
    try{document.execCommand('styleWithCSS',false,false);}catch(_){}
    document.execCommand(prop==='font-family'?'fontName':'fontSize',false,prop==='font-family'?value:'7');
    ED().querySelectorAll(prop==='font-family'?'font[face]':'font[size="7"]').forEach(f=>{if(prop==='font-size')f.dataset.pt=value;});
    normaliseFontTags();
  }
  wordSaveRange();wordChanged();
}
function refreshWordToolbar(){
  if(!isActive()||mode!=='word')return;
  document.querySelectorAll('#ot-panel-word [data-cmd]').forEach(b=>{const c=b.dataset.cmd;if(['bold','italic','underline','strikeThrough','subscript','superscript','insertUnorderedList','insertOrderedList','justifyLeft','justifyCenter','justifyRight','justifyFull'].includes(c)){let on=false;try{on=document.queryCommandState(c);}catch(_){}b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));}});
  const s=getSelection();if(!s||!s.rangeCount)return;let n=s.anchorNode;if(!n||!ED().contains(n))return;if(n.nodeType===3)n=n.parentElement;
  const blk=n.closest('h1,h2,h3,h4,h5,h6,blockquote,pre,p,li,td,th');const tag=blk?blk.tagName.toLowerCase():'p';const bs=$('ot-block');if(bs)bs.value=['h1','h2','h3','h4','blockquote','pre'].includes(tag)?tag:'p';
  const cs=getComputedStyle(n);const fam=(cs.fontFamily||'').split(',')[0].replace(/["']/g,'').trim();const fs=$('ot-font');if(fs&&[...fs.options].some(o=>o.value===fam))fs.value=fam;
  const pt=Math.round(parseFloat(cs.fontSize)*0.75);const ss=$('ot-size');if(ss&&[...ss.options].some(o=>+o.value===pt))ss.value=String(pt);
}
function updateWordCount(){const t=ED()?.innerText||'';const w=(t.match(/[^\s\u200B]+/g)||[]).length;const c=t.replace(/[\n\u200B]/g,'').length;const el=$('ot-word-count');if(el)el.textContent=w.toLocaleString()+' words • '+c.toLocaleString()+' characters';}
function newWord(){ED().innerHTML='<h1>Untitled Document</h1><p><br></p>';docs.word.name='Untitled.docx';docs.word.handle=null;markClean('word');setMode('word');updateWordCount();const r=document.createRange();r.selectNodeContents(ED().lastChild);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);ED().focus();}
function safeUrl(u){u=String(u||'').trim();if(!u)return '';if(/^(https?:|mailto:|tel:|#)/i.test(u))return u;if(/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u))return 'https://'+u;return '';}
function insertLink(){
  wordSaveRange();const u=safeUrl(prompt('Link address (https://…, mailto:…)','https://'));if(!u){return;}
  wordRestoreRange();const s=getSelection();
  if(s.rangeCount&&s.getRangeAt(0).collapsed){document.execCommand('insertHTML',false,'<a href="'+esc(u)+'">'+esc(u)+'</a>&nbsp;');}
  else document.execCommand('createLink',false,u);
  wordChanged();
}
function pickImage(cb){const i=document.createElement('input');i.type='file';i.accept='image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';i.onchange=async()=>{const f=i.files?.[0];if(f)cb(f);};i.click();}
async function insertImageFile(f){
  try{const url=await normaliseImageFile(f);wordRestoreRange();document.execCommand('insertHTML',false,'<img src="'+url+'" alt="'+esc(f.name||'image')+'" style="max-width:100%">');wordChanged();}
  catch(e){notify('Could not insert image: '+e.message,true);}
}
function insertTable(){
  wordSaveRange();const spec=prompt('Table size — rows × columns','3x3');if(!spec)return;
  const m=/^\s*(\d+)\s*[x×,* ]\s*(\d+)\s*$/i.exec(spec);if(!m)return notify('Enter a size like 3x4.',true);
  const r=clamp(+m[1],1,200),c=clamp(+m[2],1,30);
  let h='<table><tbody>';for(let y=0;y<r;y++){h+='<tr>';for(let x=0;x<c;x++)h+=y===0?'<th><br></th>':'<td><br></td>';h+='</tr>';}h+='</tbody></table><p><br></p>';
  wordRestoreRange();document.execCommand('insertHTML',false,h);wordChanged();
}
function tableOp(op){
  wordRestoreRange();const s=getSelection();let n=s.anchorNode;if(n&&n.nodeType===3)n=n.parentElement;
  const cell=n&&ED().contains(n)?n.closest('td,th'):null;if(!cell)return notify('Place the cursor inside a table cell first.',true);
  const row=cell.parentElement,table=cell.closest('table'),idx=[...row.children].indexOf(cell);
  const blank=tag=>{const c=document.createElement(tag);c.innerHTML='<br>';return c;};
  if(op==='row-above'||op==='row-below'){const nr=document.createElement('tr');[...row.children].forEach(()=>nr.appendChild(blank('td')));op==='row-above'?row.before(nr):row.after(nr);}
  else if(op==='col-left'||op==='col-right'){[...table.rows].forEach(tr=>{const ref=tr.children[Math.min(idx,tr.children.length-1)];if(!ref)return;const c=blank(ref.tagName.toLowerCase());op==='col-left'?ref.before(c):ref.after(c);});}
  else if(op==='del-row'){if(table.rows.length<=1)table.remove();else row.remove();}
  else if(op==='del-col'){[...table.rows].forEach(tr=>tr.children[idx]?.remove());if(!table.rows[0]||!table.rows[0].children.length)table.remove();}
  else if(op==='del-table')table.remove();
  wordChanged();
}
/* Find & replace inside the document */
function textNodes(rootEl){const out=[];const w=document.createTreeWalker(rootEl,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))out.push(n);return out;}
function wordFind(q,{caseSensitive=false,select=true}={}){
  if(!q)return false;const nodes=textNodes(ED());if(!nodes.length)return false;
  const norm=s=>caseSensitive?s:s.toLowerCase();const needle=norm(q);
  const s=getSelection();let startNode=null,startOff=0;
  if(s.rangeCount&&ED().contains(s.anchorNode)){const r=s.getRangeAt(0);startNode=r.endContainer;startOff=r.endOffset;}
  let i=startNode?nodes.indexOf(startNode):0;if(i<0){i=0;startOff=0;}
  for(let pass=0;pass<=nodes.length;pass++){
    const k=(i+pass)%nodes.length;const node=nodes[k];const from=pass===0?startOff:0;
    const at=norm(node.data).indexOf(needle,from);
    if(at>=0){if(select){const r=document.createRange();r.setStart(node,at);r.setEnd(node,at+q.length);s.removeAllRanges();s.addRange(r);node.parentElement?.scrollIntoView({block:'center',behavior:'smooth'});wordSaveRange();}return true;}
    if(pass===nodes.length-1&&k===nodes.length-1)startOff=0;
  }
  return false;
}
function wordReplace(q,rep,cs){const s=getSelection();if(s.rangeCount){const t=s.toString();if(t&&(cs?t===q:t.toLowerCase()===q.toLowerCase())&&ED().contains(s.anchorNode)){const r=s.getRangeAt(0);r.deleteContents();const tn=document.createTextNode(rep);r.insertNode(tn);r.setStartAfter(tn);r.collapse(true);s.removeAllRanges();s.addRange(r);wordChanged();}}return wordFind(q,{caseSensitive:cs});}
function wordReplaceAll(q,rep,cs){if(!q)return 0;const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),cs?'g':'gi');let n=0;textNodes(ED()).forEach(t=>{const v=t.data.replace(re,()=>{n++;return rep;});if(v!==t.data)t.data=v;});if(n)wordChanged();return n;}

/* ---------- open ---------- */
function modelToHtml(model){
  const runs=rs=>(rs||[]).map(r=>{let t=esc(r.text).replace(/\n/g,'<br>').replace(/\t/g,'&emsp;');if(r.code)t='<code>'+t+'</code>';if(r.italic)t='<em>'+t+'</em>';if(r.bold)t='<strong>'+t+'</strong>';if(r.underline)t='<u>'+t+'</u>';return t;}).join('');
  const out=[];
  if(model.title&&!(model.blocks||[]).some(b=>b.type==='heading'))out.push('<h1>'+esc(model.title)+'</h1>');
  (model.blocks||[]).forEach(b=>{
    if(b.type==='heading'){const l=clamp(b.level||1,1,6);out.push('<h'+l+'>'+runs(b.runs)+'</h'+l+'>');}
    else if(b.type==='para')out.push('<p>'+(runs(b.runs)||'<br>')+'</p>');
    else if(b.type==='code')out.push('<pre>'+esc(b.text||'')+'</pre>');
    else if(b.type==='pagebreak')out.push('<hr class="ot-page-break" data-page-break="true">');
    else if(b.type==='list'){const tag=b.ordered?'ol':'ul';let html='',depth=-1;(b.items||[]).forEach(it=>{const lv=clamp(it.level||0,0,8);while(depth<lv){html+='<'+tag+'>';depth++;}while(depth>lv){html+='</'+tag+'>';depth--;}html+='<li>'+runs(it.runs)+'</li>';});while(depth>=0){html+='</'+tag+'>';depth--;}out.push(html);}
    else if(b.type==='table')out.push('<table><tbody>'+(b.rows||[]).map((r,i)=>'<tr>'+r.map(c=>{const tg=b.header&&i===0?'th':'td';return '<'+tg+'>'+(esc(c).replace(/\n/g,'<br>')||'<br>')+'</'+tg+'>';}).join('')+'</tr>').join('')+'</tbody></table>');
    else if(b.type==='image'&&b.bytes){let bin='';const u=b.bytes instanceof Uint8Array?b.bytes:new Uint8Array(b.bytes);for(let i=0;i<u.length;i+=0x8000)bin+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));out.push('<p><img src="data:'+(b.mime||'image/png')+';base64,'+btoa(bin)+'" style="max-width:100%"></p>');}
    else if(b.type==='slide')out.push('<h2>'+esc(b.title||'Slide')+'</h2><ul>'+(b.items||[]).map(i=>'<li>'+esc(i.text||'')+'</li>').join('')+'</ul>');
  });
  return out.join('')||'<p><br></p>';
}
async function wordOpen(file){
  const e=ext(file.name);let html;
  if(['docx','docm','dotx','dotm'].includes(e)){
    const M=await lib('mammoth');
    const res=await M.convertToHtml({arrayBuffer:await file.arrayBuffer()},{
      styleMap:['u => u','strike => s',"p[style-name='Title'] => h1:fresh","p[style-name='Subtitle'] => h2:fresh","p[style-name='Quote'] => blockquote:fresh","p[style-name='Intense Quote'] => blockquote:fresh","r[style-name='Strong'] => strong"],
      convertImage:M.images.imgElement(img=>img.read('base64').then(b=>({src:'data:'+img.contentType+';base64,'+b})))
    });
    html=res.value;
    const warn=(res.messages||[]).filter(m=>m.type==='warning').length;
    if(warn)console.info('mammoth warnings',res.messages);
  }else if(e==='html'||e==='htm'||e==='xhtml'){
    const doc=new DOMParser().parseFromString(await file.text(),'text/html');html=doc.body?doc.body.innerHTML:'';
  }else if(e==='pdf'){
    if(!window.OMNI_DOCS?.pdfToModel)throw new Error('PDF reader is not loaded.');
    html=modelToHtml(await window.OMNI_DOCS.pdfToModel(file,{images:true,text:true}));
  }else{
    if(!window.OMNI_DOCS)throw new Error('Document engine is not loaded.');
    const model=await window.OMNI_DOCS.readDocument(file);if(!model)throw new Error('Unsupported document format.');
    html=modelToHtml(model);
  }
  ED().innerHTML=(await sanitize(html))||'<p><br></p>';
  updateWordCount();
}

/* ---------- export ---------- */
function stripZW(s){return String(s||'').replace(/\u200B/g,'');}
function blockAlign(el){const a=(el.style&&el.style.textAlign)||el.getAttribute?.('align')||'';return /center/i.test(a)?'center':/right|end/i.test(a)?'right':/justify/i.test(a)?'justify':'';}
function fmtFrom(el,parent){
  const f={...parent};const t=el.tagName?el.tagName.toLowerCase():'';const st=el.style||{};
  if(t==='b'||t==='strong'||t==='th')f.bold=true;if(t==='i'||t==='em'||t==='cite'||t==='var')f.italic=true;if(t==='u'||t==='ins')f.underline=true;if(t==='s'||t==='strike'||t==='del')f.strike=true;
  if(t==='sub')f.sub=true;if(t==='sup')f.sup=true;if(t==='code'||t==='kbd'||t==='samp'||t==='tt')f.code=true;if(t==='mark')f.highlight=f.highlight||'FFF59D';if(t==='a'&&el.getAttribute('href'))f.link=el.getAttribute('href');
  const fw=st.fontWeight;if(fw==='bold'||+fw>=600)f.bold=true;else if(fw==='normal'||(+fw&&+fw<600))f.bold=false;
  if(st.fontStyle==='italic')f.italic=true;else if(st.fontStyle==='normal')f.italic=false;
  const td=(st.textDecorationLine||st.textDecoration||'');if(/underline/.test(td))f.underline=true;if(/line-through/.test(td))f.strike=true;
  if(st.color){const h=toHex(st.color);if(h)f.color=h;}
  const bg=st.backgroundColor||'';if(bg){const h=toHex(bg);if(h&&h!=='FFFFFF')f.highlight=h;}
  if(st.fontSize){const v=parseFloat(st.fontSize);if(v){f.pt=/px$/.test(st.fontSize)?v*0.75:/em$/.test(st.fontSize)?(f.pt||12)*v:v;}}
  if(st.fontFamily)f.font=st.fontFamily.split(',')[0].replace(/["']/g,'').trim();
  if(/monospace|consolas|courier/i.test(st.fontFamily||''))f.code=true;
  return f;
}
const BLOCK_TAGS=new Set(['p','div','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tr','td','th','blockquote','pre','hr','figure','figcaption','section','article','header','footer']);
/* Intermediate representation shared by DOCX/RTF/ODT/PDF/MD/TXT writers */
function editorIR(){
  const out=[];
  const inline=(node,fmt,acc)=>{
    node.childNodes.forEach(c=>{
      if(c.nodeType===3){const t=stripZW(c.data).replace(/[\r\n]+/g,' ');if(t)acc.push({kind:'text',text:t,fmt});}
      else if(c.nodeType===1){const tg=c.tagName.toLowerCase();
        if(tg==='br')acc.push({kind:'br'});
        else if(tg==='img')acc.push({kind:'img',src:c.getAttribute('src'),w:c.width||c.naturalWidth,h:c.height||c.naturalHeight,pct:/%$/.test(c.style.width||'')?parseFloat(c.style.width):null});
        else if(BLOCK_TAGS.has(tg)&&tg!=='li')acc.push({kind:'nested',el:c});
        else inline(c,fmtFrom(c,fmt),acc);}
    });return acc;
  };
  const para=(el,extra,fmt)=>{const items=inline(el,fmt||fmtFrom(el,{}),[]);const flat=[];items.forEach(it=>{if(it.kind==='nested')walk(it.el,extra);else flat.push(it);});if(flat.length||!extra.skipEmpty)out.push({type:'para',items:flat,align:blockAlign(el),...extra});};
  const list=(el,level)=>{const ordered=el.tagName.toLowerCase()==='ol';const listId=Math.random().toString(36).slice(2);[...el.children].forEach(li=>{if(li.tagName.toLowerCase()!=='li')return;const items=[];const nested=[];li.childNodes.forEach(c=>{if(c.nodeType===1&&/^(ul|ol)$/i.test(c.tagName))nested.push(c);else if(c.nodeType===1&&/^(p|div)$/i.test(c.tagName)){inline(c,fmtFrom(c,{}),items);items.push({kind:'br'});}else{const tmp=document.createElement('span');tmp.appendChild(c.cloneNode(true));inline(tmp,{},items);}});while(items.length&&items[items.length-1].kind==='br')items.pop();out.push({type:'li',items:items.filter(i=>i.kind!=='nested'),ordered,level,listId,align:blockAlign(li)});nested.forEach(n=>list(n,level+1));});};
  const walk=(el,extra={})=>{
    const tg=el.tagName.toLowerCase();
    if(/^h[1-6]$/.test(tg))return para(el,{heading:+tg[1]},{...fmtFrom(el,{}),bold:true});
    if(tg==='p'||tg==='figcaption')return para(el,{...extra});
    if(tg==='blockquote'){if([...el.children].some(c=>BLOCK_TAGS.has(c.tagName.toLowerCase()))){[...el.childNodes].forEach(c=>{if(c.nodeType===1)walk(c,{quote:true});else if(c.textContent.trim())out.push({type:'para',items:[{kind:'text',text:c.textContent,fmt:{italic:true}}],quote:true});});}else para(el,{quote:true},{italic:true});return;}
    if(tg==='pre'){String(stripZW(el.innerText||el.textContent)).replace(/\n$/,'').split('\n').forEach(l=>out.push({type:'para',items:[{kind:'text',text:l,fmt:{code:true}}],code:true}));return;}
    if(tg==='ul'||tg==='ol')return list(el,0);
    if(tg==='hr'){out.push(el.classList.contains('ot-page-break')||el.dataset.pageBreak?{type:'pagebreak'}:{type:'rule'});return;}
    if(tg==='table'){const rows=[...el.rows].map(tr=>[...tr.cells].map(td=>({header:td.tagName==='TH',colspan:td.colSpan||1,rowspan:td.rowSpan||1,bg:toHex(td.style.backgroundColor||''),blocks:subIR(td)})));out.push({type:'table',rows});return;}
    if(tg==='img'){out.push({type:'para',items:inline({childNodes:[el]},{},[]),align:''});return;}
    if(tg==='div'||tg==='section'||tg==='article'||tg==='figure'||tg==='header'||tg==='footer'){
      if([...el.children].some(c=>BLOCK_TAGS.has(c.tagName.toLowerCase()))){let buf=[];const flush=()=>{if(buf.length){const sp=document.createElement('p');buf.forEach(n=>sp.appendChild(n.cloneNode(true)));para(sp,{...extra,align:blockAlign(el),skipEmpty:true});buf=[];}};el.childNodes.forEach(c=>{if(c.nodeType===1&&BLOCK_TAGS.has(c.tagName.toLowerCase())){flush();walk(c,extra);}else buf.push(c);});flush();}
      else para(el,{...extra});return;}
    para(el,extra);
  };
  const subIR=cell=>{const saved=out.splice(0,out.length);const tmp=document.createElement('div');tmp.innerHTML=cell.innerHTML;if(![...tmp.children].some(c=>BLOCK_TAGS.has(c.tagName.toLowerCase()))){para(tmp,{},fmtFrom(cell,{}));}else walkChildren(tmp);const res=out.splice(0,out.length);out.push(...saved);return res;};
  const walkChildren=parent=>{let buf=[];const flush=()=>{if(buf.length){const sp=document.createElement('p');buf.forEach(n=>sp.appendChild(n.cloneNode(true)));if(stripZW(sp.textContent).trim()||sp.querySelector('img,br'))para(sp,{});buf=[];}};parent.childNodes.forEach(c=>{if(c.nodeType===1&&(BLOCK_TAGS.has(c.tagName.toLowerCase())||c.tagName==='IMG')){flush();walk(c);}else if(c.nodeType===1||c.textContent.trim())buf.push(c);});flush();};
  walkChildren(ED());
  return out;
}
const runText=items=>items.map(i=>i.kind==='text'?i.text:i.kind==='br'?'\n':'').join('');
async function irToModel(ir){
  const blocks=[];let list=null;
  const runs=items=>items.filter(i=>i.kind!=='img').map(i=>i.kind==='br'?{text:'\n'}:{text:i.text,bold:!!i.fmt.bold,italic:!!i.fmt.italic,code:!!i.fmt.code,underline:!!i.fmt.underline});
  const imgs=async items=>{for(const i of items.filter(x=>x.kind==='img')){const d=await imageBytes(i.src);if(d)blocks.push({type:'image',bytes:d.bytes,mime:d.mime,width:d.width,height:d.height});}};
  const flatCell=bl=>bl.map(b=>b.type==='para'||b.type==='li'?runText(b.items):'').join('\n').trim();
  for(const b of ir){
    if(b.type!=='li')list=null;
    if(b.type==='para'){if(b.code){const prev=blocks[blocks.length-1];const line=runText(b.items);if(prev&&prev.type==='code'&&prev._open)prev.text+='\n'+line;else blocks.push({type:'code',text:line,_open:true});continue;}
      const r=runs(b.items);if(b.heading)blocks.push({type:'heading',level:b.heading,runs:r});else if(runText(b.items).trim())blocks.push({type:'para',runs:b.quote?r.map(x=>({...x,italic:true})):r});await imgs(b.items);}
    else if(b.type==='li'){if(!list||list.ordered!==b.ordered||list.listId!==b.listId&&b.level===0){list={type:'list',ordered:b.ordered,listId:b.listId,items:[]};blocks.push(list);}list.items.push({level:b.level,runs:runs(b.items)});}
    else if(b.type==='table')blocks.push({type:'table',rows:b.rows.map(r=>r.map(c=>flatCell(c.blocks))),header:b.rows[0]?.every(c=>c.header)??false});
    else if(b.type==='pagebreak')blocks.push({type:'pagebreak'});
    else if(b.type==='rule')blocks.push({type:'para',runs:[{text:'────────────────────'}]});
  }
  blocks.forEach(b=>{delete b._open;delete b.listId;});
  const h1=ED().querySelector('h1');return {title:stripZW(h1?.textContent||base(docs.word.name)).trim(),blocks};
}
async function buildDocx(ir){
  const D=await lib('docx');
  const AL={center:D.AlignmentType.CENTER,right:D.AlignmentType.RIGHT,justify:D.AlignmentType.JUSTIFIED,'':undefined};
  const HL=[null,D.HeadingLevel.HEADING_1,D.HeadingLevel.HEADING_2,D.HeadingLevel.HEADING_3,D.HeadingLevel.HEADING_4,D.HeadingLevel.HEADING_5,D.HeadingLevel.HEADING_6];
  const listInstances=new Map();let instanceSeq=0;
  const runOpts=f=>{const o={};if(f.bold)o.bold=true;if(f.italic)o.italics=true;if(f.underline)o.underline={type:D.UnderlineType.SINGLE};if(f.strike)o.strike=true;if(f.sub)o.subScript=true;if(f.sup)o.superScript=true;if(f.color)o.color=f.color;if(f.pt)o.size=Math.round(f.pt*2);if(f.code)o.font='Consolas';else if(f.font)o.font=f.font;if(f.highlight)o.shading={type:D.ShadingType.CLEAR,color:'auto',fill:f.highlight};return o;};
  const children=async items=>{
    const out=[];
    for(const it of items){
      if(it.kind==='br'){out.push(new D.TextRun({text:'',break:1}));continue;}
      if(it.kind==='img'){const d=await imageBytes(it.src,['image/png','image/jpeg','image/gif','image/bmp']);if(!d)continue;let w=it.pct?6.3*96*it.pct/100:(it.w||d.width),h=it.pct?w*d.height/d.width:(it.h||d.height);const maxW=6.3*96;if(w>maxW){h=h*maxW/w;w=maxW;}out.push(new D.ImageRun({type:d.mime==='image/jpeg'?'jpg':d.mime.split('/')[1],data:d.bytes,transformation:{width:Math.round(w),height:Math.round(h)}}));continue;}
      if(it.kind!=='text')continue;
      const f=it.fmt||{};
      if(f.link){const safe=safeUrl(f.link);if(safe&&!safe.startsWith('#')){out.push(new D.ExternalHyperlink({link:safe,children:[new D.TextRun({text:it.text,...runOpts(f),color:f.color||'0563C1',underline:{type:D.UnderlineType.SINGLE}})]}));continue;}}
      out.push(new D.TextRun({text:it.text,...runOpts(f)}));
    }
    return out;
  };
  const paraFrom=async b=>{
    const kids=await children(b.items||[]);
    const o={children:kids,alignment:AL[b.align||'']};
    if(b.heading)o.heading=HL[b.heading];
    if(b.quote)o.style='OTQuote';
    if(b.code)o.style='OTCode';
    if(b.type==='li'){let inst=listInstances.get(b.listId);if(inst==null){inst=++instanceSeq;listInstances.set(b.listId,inst);}o.numbering={reference:b.ordered?'ot-numbers':'ot-bullets',level:clamp(b.level,0,8),instance:inst};}
    return new D.Paragraph(o);
  };
  const blocksToDocx=async ir=>{
    const out=[];
    for(const b of ir){
      if(b.type==='para'||b.type==='li')out.push(await paraFrom(b));
      else if(b.type==='pagebreak')out.push(new D.Paragraph({children:[new D.PageBreak()]}));
      else if(b.type==='rule')out.push(new D.Paragraph({children:[],border:{bottom:{style:D.BorderStyle.SINGLE,size:6,color:'9CA3AF',space:1}}}));
      else if(b.type==='table'){
        const maxCols=Math.max(1,...b.rows.map(r=>r.reduce((a,c)=>a+(c.colspan||1),0)));
        const rows=[];for(let ri=0;ri<b.rows.length;ri++){const r=b.rows[ri];const cells=[];for(const c of r){let kids=await blocksToDocx(c.blocks);if(!kids.length)kids=[new D.Paragraph({children:[]})];const co={children:kids};if(c.colspan>1)co.columnSpan=c.colspan;if(c.rowspan>1)co.rowSpan=c.rowspan;if(c.bg)co.shading={type:D.ShadingType.CLEAR,color:'auto',fill:c.bg};else if(c.header)co.shading={type:D.ShadingType.CLEAR,color:'auto',fill:'F1F5F9'};cells.push(new D.TableCell(co));}if(cells.length)rows.push(new D.TableRow({children:cells,tableHeader:ri===0&&r.every(c=>c.header)}));}
        if(rows.length){out.push(new D.Table({rows,width:{size:100,type:D.WidthType.PERCENTAGE},columnWidths:Array(maxCols).fill(Math.floor(9638/maxCols))}));out.push(new D.Paragraph({children:[]}));}
      }
    }
    return out;
  };
  const bodyKids=await blocksToDocx(ir);
  const levels=(fmts)=>Array.from({length:9},(_,l)=>({level:l,format:fmts[l%fmts.length][0],text:fmts[l%fmts.length][1].replace('%n','%'+(l+1)),alignment:D.AlignmentType.LEFT,style:{paragraph:{indent:{left:720*(l+1),hanging:360}}}}));
  const doc=new D.Document({
    creator:'Redmark Forge Office Tools',title:base(docs.word.name),
    styles:{default:{document:{run:{font:'Arial',size:24}},heading1:{run:{size:40,bold:true,color:'1F2937'},paragraph:{spacing:{before:240,after:120}}},heading2:{run:{size:32,bold:true,color:'1F2937'},paragraph:{spacing:{before:200,after:100}}},heading3:{run:{size:28,bold:true},paragraph:{spacing:{before:160,after:80}}}},
      paragraphStyles:[{id:'OTQuote',name:'Quote',basedOn:'Normal',next:'Normal',run:{italics:true,color:'475569'},paragraph:{indent:{left:720},border:{left:{style:D.BorderStyle.SINGLE,size:18,color:'06B6D4',space:8}}}},{id:'OTCode',name:'Code',basedOn:'Normal',next:'Normal',run:{font:'Consolas',size:20},paragraph:{spacing:{before:0,after:0},shading:{type:D.ShadingType.CLEAR,color:'auto',fill:'F1F5F9'}}}]},
    numbering:{config:[{reference:'ot-bullets',levels:levels([[D.LevelFormat.BULLET,'•'],[D.LevelFormat.BULLET,'◦'],[D.LevelFormat.BULLET,'▪']])},{reference:'ot-numbers',levels:levels([[D.LevelFormat.DECIMAL,'%n.'],[D.LevelFormat.LOWER_LETTER,'%n.'],[D.LevelFormat.LOWER_ROMAN,'%n.']])}]},
    sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1134,right:1134,bottom:1134,left:1134}}},children:bodyKids.length?bodyKids:[new D.Paragraph({children:[]})]}]
  });
  return D.Packer.toBlob(doc);
}
function rtfEsc(s){return String(s).replace(/[\\{}]/g,m=>'\\'+m).replace(/[\u0080-\uffff]/g,ch=>{const c=ch.charCodeAt(0);return '\\u'+(c>32767?c-65536:c)+'?';});}
function buildRtf(ir){
  const colors=['000000'];const colorIx=h=>{if(!h)return 0;let i=colors.indexOf(h);if(i<0){colors.push(h);i=colors.length-1;}return i;};
  const run=it=>{if(it.kind==='br')return '\\line ';if(it.kind!=='text')return '';const f=it.fmt||{};let p='';if(f.bold)p+='\\b';if(f.italic)p+='\\i';if(f.underline)p+='\\ul';if(f.strike)p+='\\strike';if(f.sup)p+='\\super';if(f.sub)p+='\\sub';if(f.code)p+='\\f1';if(f.pt)p+='\\fs'+Math.round(f.pt*2);if(f.color)p+='\\cf'+colorIx(f.color);return '{'+p+' '+rtfEsc(it.text)+'}';};
  let body='';const counters={};
  for(const b of ir){
    const al=b.align==='center'?'\\qc':b.align==='right'?'\\qr':b.align==='justify'?'\\qj':'\\ql';
    if(b.type==='para'){const hs=b.heading?{1:40,2:32,3:28,4:26,5:24,6:22}[b.heading]:0;body+='\\pard'+al+(b.quote?'\\li720':'')+(b.code?'\\f1\\fs20':'')+(hs?'\\b\\fs'+hs:'')+' '+b.items.map(run).join('')+'\\par\n';}
    else if(b.type==='li'){const k=b.listId+':'+b.level;counters[k]=(counters[k]||0)+1;body+='\\pard\\li'+(720*(b.level+1))+'\\fi-360'+al+' '+(b.ordered?counters[k]+'.':'\\bullet')+'\\tab '+b.items.map(run).join('')+'\\par\n';}
    else if(b.type==='pagebreak')body+='\\page\n';
    else if(b.type==='rule')body+='\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n';
    else if(b.type==='table'){for(const r of b.rows){const n=r.length||1;body+='\\trowd\\trgaph108';for(let i=1;i<=n;i++)body+='\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx'+Math.round(9638*i/n);body+='\n';r.forEach(c=>{body+='\\pard\\intbl '+(c.header?'\\b ':'')+c.blocks.map(x=>(x.items||[]).map(run).join('')).join('\\line ')+(c.header?'\\b0':'')+'\\cell ';});body+='\\row\n';}}
  }
  const ctbl='{\\colortbl;'+colors.slice(1).map(h=>'\\red'+parseInt(h.slice(0,2),16)+'\\green'+parseInt(h.slice(2,4),16)+'\\blue'+parseInt(h.slice(4,6),16)+';').join('')+'}';
  return '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Arial;}{\\f1\\fmodern Courier New;}}'+ctbl+'\\fs24\n'+body+'}';
}
function wordHtmlDocument(){
  const css='body{font:12pt/1.6 Arial,Helvetica,sans-serif;color:#172033;max-width:46em;margin:2em auto;padding:0 1em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #9ca3af;padding:6px;vertical-align:top}th{background:#f1f5f9}blockquote{border-left:4px solid #06b6d4;margin:1em 0;padding-left:14px;color:#475569}pre{background:#f1f5f9;padding:10px;border-radius:6px;white-space:pre-wrap}img{max-width:100%}hr.ot-page-break{border:0;page-break-after:always;break-after:page}';
  return '<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Redmark Forge Office Tools"><title>'+esc(base(docs.word.name))+'</title><style>'+css+'</style></head><body>\n'+stripZW(ED().innerHTML)+'\n</body></html>';
}
async function wordExport(fmt){
  normaliseFontTags();
  if(fmt==='html')return {blob:new Blob([wordHtmlDocument()],{type:'text/html;charset=utf-8'})};
  const ir=editorIR();
  if(fmt==='docx')return {blob:await buildDocx(ir)};
  if(fmt==='rtf')return {blob:new Blob([buildRtf(ir)],{type:'application/rtf'})};
  if(!window.OMNI_DOCS)throw new Error('Document engine is not loaded.');
  const r=await window.OMNI_DOCS.writeDocument(await irToModel(ir),fmt);
  if(!r)throw new Error('Unsupported format: '+fmt);
  if(r.note)notify(r.note);
  return {blob:r.blob};
}
function wordPrint(){normaliseFontTags();printHTML(base(docs.word.name),stripZW(ED().innerHTML),'@page{margin:18mm}body{font:12pt/1.6 Arial,Helvetica,sans-serif;color:#000}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:5px;vertical-align:top}blockquote{border-left:3px solid #999;margin-left:0;padding-left:12px}pre{white-space:pre-wrap;background:#f4f4f4;padding:8px}img{max-width:100%}hr.ot-page-break{border:0;break-after:page;page-break-after:always}h1,h2,h3{break-after:avoid}');}

/* =====================================================================
 * EXCEL / CALC
 * ===================================================================== */
const X={wb:null,active:0,sel:{r:0,c:0,r2:0,c2:0},editing:null,renderRows:500,undo:[],redo:[],clip:null,parser:null,FP:null,calc:new Map(),stack:new Set(),engineLoading:null,dragSel:false,usedCache:new Map()};
const colName=c=>{let s='';c++;while(c>0){const m=(c-1)%26;s=String.fromCharCode(65+m)+s;c=Math.floor((c-1)/26);}return s;};
const colIndex=s=>{let n=0;for(const ch of s.toUpperCase())n=n*26+(ch.charCodeAt(0)-64);return n-1;};
const A1=(r,c)=>colName(c)+(r+1);
const parseA1=a=>{const m=/^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(a).trim());return m?{r:+m[2]-1,c:colIndex(m[1])}:null;};
const newSheet=name=>({name,cells:{},cols:{},merges:[],frozen:false,filter:null});
function ensureWorkbook(){if(!X.wb){X.wb={sheets:[newSheet('Sheet1')]};X.active=0;}}
const curSheet=()=>X.wb.sheets[X.active];
function usedRange(sh){let r=-1,c=-1;for(const k in sh.cells){const p=parseA1(k);if(p){if(p.r>r)r=p.r;if(p.c>c)c=p.c;}}return {r,c};}
const sheetByName=n=>X.wb.sheets.findIndex(s=>s.name.toLowerCase()===String(n||'').toLowerCase());
const isErr=v=>v&&typeof v==='object'&&typeof v.error==='string';
const serialFromDate=d=>(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds())-Date.UTC(1899,11,30))/86400000;
function parseInput(text){
  const t=String(text??'');
  if(t==='')return {v:null};
  if(t[0]==='='&&t.length>1)return {f:t.slice(1).trim()};
  if(t[0]==="'")return {v:t.slice(1),text:true};
  const s=t.trim();
  let m=/^([₹$€£¥])?\s*([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(%)?$/.exec(s);
  if(m&&!(m[1]&&m[3])){let v=+m[2].replace(/,/g,'');let nf=null;if(m[3]){v/=100;nf=/\./.test(m[2])?'0.00%':'0%';}else if(m[1])nf='"'+m[1]+'"#,##0.00';else if(/,/.test(m[2]))nf=/\./.test(m[2])?'#,##0.00':'#,##0';return {v,nf};}
  if(/^(true|false)$/i.test(s))return {v:/^t/i.test(s)};
  m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);if(m){const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(!isNaN(d))return {v:serialFromDate(d),nf:'yyyy-mm-dd'};}
  m=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);if(m&&+m[1]<24&&+m[2]<60)return {v:(+m[1]*3600+ +m[2]*60+(+m[3]||0))/86400,nf:m[3]?'hh:mm:ss':'hh:mm'};
  return {v:t};
}
async function ensureFormulaEngine(){
  if(X.parser)return X.parser;
  if(X.engineLoading)return X.engineLoading;
  X.engineLoading=(async()=>{
    const [FP,FJ]=await Promise.all([lib('formulaParser'),lib('formulajs').catch(()=>null)]);
    X.FP=FP;
    const parser=new FP({
      onCell:({sheet,row,col})=>{const si=sheet?sheetByName(sheet):X.active;if(si<0)return new FP.FormulaError('#REF!');const v=cellValue(si,row-1,col-1);return isErr(v)?new FP.FormulaError(v.error):v;},
      onRange:ref=>{const si=ref.sheet?sheetByName(ref.sheet):X.active;if(si<0)return [[new FP.FormulaError('#REF!')]];const u=usedRange(X.wb.sheets[si]);const r1=Math.min(ref.to.row,u.r+1),c1=Math.min(ref.to.col,u.c+1);const out=[];for(let r=ref.from.row;r<=Math.max(r1,ref.from.row);r++){const row=[];for(let c=ref.from.col;c<=Math.max(c1,ref.from.col);c++){const v=cellValue(si,r-1,c-1);row.push(isErr(v)?new FP.FormulaError(v.error):v);}out.push(row);}return out;}
    });
    /* Formula.js fills functions fast-formula-parser does not implement (XLOOKUP, SUMIFS, MATCH, TEXTJOIN…). */
    if(FJ){
      const ctxFns=new Set([...(parser.funsNeedContext||[]),...(parser.funsNeedContextAndNoDataRetrieve||[])]);
      const flat={};Object.keys(FJ).forEach(k=>{const v=FJ[k];if(typeof v==='function')flat[k.toUpperCase()]=v;if(v&&(typeof v==='object'||typeof v==='function'))Object.keys(v).forEach(s=>{if(typeof v[s]==='function'&&/^[A-Z]/.test(s))flat[(k+'.'+s).toUpperCase()]=v[s];});});
      [['STDEV','STDEV.S'],['STDEVP','STDEV.P'],['VAR','VAR.S'],['VARP','VAR.P'],['PERCENTILE','PERCENTILE.INC'],['QUARTILE','QUARTILE.INC'],['RANK','RANK.EQ'],['MODE','MODE.SNGL'],['PERCENTRANK','PERCENTRANK.INC']].forEach(([a,b])=>{if(!flat[a]&&flat[b])flat[a]=flat[b];});
      const unwrap=x=>{if(x&&typeof x==='object'&&'value' in x){const v=x.value;if(Array.isArray(v))return v.map(r=>Array.isArray(r)?r.map(c=>c instanceof FP.FormulaError?new Error(c.error||c._error):c):r);return v instanceof FP.FormulaError?new Error(v.error||v._error):v;}return x;};
      Object.entries(flat).forEach(([name,fn])=>{
        if(ctxFns.has(name))return;
        const builtin=parser.functions[name];
        parser.functions[name]=(...args)=>{
          if(builtin){const r=builtin(...args);if(r!==undefined)return r;}
          let r;try{r=fn(...args.map(unwrap));}catch(e){throw new FP.FormulaError('#VALUE!');}
          if(r instanceof Error)throw new FP.FormulaError(/^#/.test(r.message)?r.message:'#VALUE!');
          if(Array.isArray(r)){let x=r;while(Array.isArray(x))x=x[0];return x??0;}
          return r===undefined?0:r;
        };
      });
    }
    /* Modern lookup/text functions missing from both engines (single-cell results; no spill). */
    const val=x=>x&&typeof x==='object'&&'value' in x?(x.omitted?undefined:x.value):x;
    const flat2=v=>Array.isArray(v)?v.flat(Infinity):[v];
    const eqL=(a,b)=>typeof a==='string'&&typeof b==='string'?a.toLowerCase()===b.toLowerCase():a===b;
    const wild=p=>new RegExp('^'+String(p).replace(/~([*?])/g,'\u0001$1').replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/(^|[^\u0001])\*/g,'$1.*').replace(/(^|[^\u0001])\?/g,'$1.').replace(/\u0001/g,'\\')+'$','i');
    const findIdx=(look,arr,mode,search)=>{const n=arr.length;const order=search<0?[...Array(n).keys()].reverse():[...Array(n).keys()];if(mode===2){const re=wild(look);for(const i of order)if(re.test(String(arr[i]??'')))return i;return -1;}let best=-1;for(const i of order){const v=arr[i];if(eqL(v,look))return i;if(v==null||typeof v!==typeof look)continue;if(mode===-1&&v<look&&(best<0||v>arr[best]))best=i;if(mode===1&&v>look&&(best<0||v<arr[best]))best=i;}return best;};
    const custom={
      XLOOKUP:(look,la,ra,nf,mm,sm)=>{const L=val(la),R=val(ra);const arr=flat2(L);const i=findIdx(val(look),arr,+val(mm)||0,+val(sm)||1);if(i<0){const d=val(nf);if(d!==undefined&&d!==null)return d;throw new FP.FormulaError('#N/A');}const rows=Array.isArray(R)?R:[[R]];const vertical=Array.isArray(L)&&L.length>1;const out=vertical?rows[i]?.[0]:rows[0]?.[i];return out??0;},
      XMATCH:(look,la,mm,sm)=>{const i=findIdx(val(look),flat2(val(la)),+val(mm)||0,+val(sm)||1);if(i<0)throw new FP.FormulaError('#N/A');return i+1;},
      TEXTBEFORE:(t,d,n)=>{const s=String(val(t)??''),dl=String(val(d)??'');const k=+val(n)||1;if(!dl)return '';let pos=-1;if(k>0){for(let j=0;j<k;j++){pos=s.indexOf(dl,pos+1);if(pos<0)throw new FP.FormulaError('#N/A');}}else{pos=s.length;for(let j=0;j<-k;j++){pos=s.lastIndexOf(dl,pos-1);if(pos<0)throw new FP.FormulaError('#N/A');}}return s.slice(0,pos);},
      TEXTAFTER:(t,d,n)=>{const s=String(val(t)??''),dl=String(val(d)??'');const k=+val(n)||1;if(!dl)return s;let pos=-1;if(k>0){for(let j=0;j<k;j++){pos=s.indexOf(dl,pos+1);if(pos<0)throw new FP.FormulaError('#N/A');}}else{pos=s.length;for(let j=0;j<-k;j++){pos=s.lastIndexOf(dl,pos-1);if(pos<0)throw new FP.FormulaError('#N/A');}}return s.slice(pos+dl.length);}
    };
    const refValues=(si,r0,c0,r1,c1)=>{if(r0<0||c0<0)throw new FP.FormulaError('#REF!');if(r0===r1&&c0===c1){const v=cellValue(si,r0,c0);if(isErr(v))throw new FP.FormulaError(v.error);return v??0;}const out=[];for(let r=r0;r<=r1;r++){const row=[];for(let c=c0;c<=c1;c++){const v=cellValue(si,r,c);row.push(isErr(v)?new FP.FormulaError(v.error):v);}out.push(row);}return out;};
    const sheetIdx=name=>{const i=name?sheetByName(name):X.active;if(i<0)throw new FP.FormulaError('#REF!');return i;};
    custom.INDIRECT=(t)=>{const s=String(val(t)??'').trim();const m=/^(?:'((?:[^']|'')+)'!|([^!'\s]+)!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(s);if(!m)throw new FP.FormulaError('#REF!');const si=sheetIdx(m[1]?m[1].replace(/''/g,"'"):m[2]);const c0=colIndex(m[3]),r0=+m[4]-1,c1=m[5]?colIndex(m[5]):c0,r1=m[6]?+m[6]-1:r0;return refValues(si,Math.min(r0,r1),Math.min(c0,c1),Math.max(r0,r1),Math.max(c0,c1));};
    custom.OFFSET=(ref,rows,cols,h,w)=>{const rf=ref&&ref.ref;if(!rf)throw new FP.FormulaError('#VALUE!');const si=sheetIdx(rf.sheet);const from=rf.from||rf,to=rf.to||rf;const hh=val(h)!=null?+val(h):to.row-from.row+1,ww=val(w)!=null?+val(w):to.col-from.col+1;if(hh<1||ww<1)throw new FP.FormulaError('#REF!');const r0=from.row-1+(+val(rows)||0),c0=from.col-1+(+val(cols)||0);return refValues(si,r0,c0,r0+hh-1,c0+ww-1);};
    if(Array.isArray(parser.funsPreserveRef)&&!parser.funsPreserveRef.includes('OFFSET'))parser.funsPreserveRef.push('OFFSET');
    ['funsNeedContext','funsNeedContextAndNoDataRetrieve'].forEach(k=>{if(Array.isArray(parser[k]))parser[k]=parser[k].filter(n=>!(n in custom));});
    Object.assign(parser.functions,custom);
    X.parser=parser;X.calc.clear();
    if(mode==='excel')renderGrid();
    return parser;
  })().catch(e=>{X.engineLoading=null;notify('Formula engine unavailable: '+e.message+' Formulas will show their last saved values.',true);});
  return X.engineLoading;
}
function cellValue(si,r,c){
  const sh=X.wb.sheets[si];if(!sh)return {error:'#REF!'};
  const cell=sh.cells[A1(r,c)];if(!cell)return null;
  if(cell.f==null)return cell.v??null;
  const key=si+'!'+r+':'+c;
  if(X.calc.has(key))return X.calc.get(key);
  if(!X.parser)return cell.cached??null;
  if(X.stack.has(key))return {error:'#CIRC!'};
  X.stack.add(key);let v;
  try{v=X.parser.parse(cell.f,{sheet:sh.name,row:r+1,col:c+1},false);}
  catch(e){v=errorFrom(e);}
  finally{X.stack.delete(key);}
  v=normResult(v);X.calc.set(key,v);return v;
}
function errorFrom(e){
  if(X.FP&&e instanceof X.FP.FormulaError){const d=e.details&&(e.details.error||e.details._error);const own=e.error||e._error;return {error:(own==='#ERROR!'&&d)?d:(own||d||'#VALUE!')};}
  const m=String(e&&e.message||e);
  if(/not implemented/i.test(m))return {error:'#NAME?'};
  if(e&&(e.error||e._error))return {error:e.error||e._error};
  return {error:'#ERROR!'};
}
function normResult(v){
  if(v==null)return 0;
  if(X.FP&&v instanceof X.FP.FormulaError)return {error:v.error||v._error};
  if(v&&typeof v==='object'&&(v._error||v.error))return {error:v._error||v.error};
  if(Array.isArray(v)){let x=v;while(Array.isArray(x))x=x[0];return normResult(x);}
  if(typeof v==='number'&&!isFinite(v))return {error:'#NUM!'};
  if(v instanceof Date)return serialFromDate(v);
  return v;
}
function formatValue(v,nf){
  if(v==null||v==='')return '';
  if(isErr(v))return v.error;
  if(typeof v==='boolean')return v?'TRUE':'FALSE';
  if(typeof v==='number'){
    if(nf&&nf!=='General'&&nf!=='@'&&window.XLSX?.SSF){try{return XLSX.SSF.format(nf,v);}catch(_){}}
    if(Number.isInteger(v)&&Math.abs(v)<1e15)return String(v);
    const a=Math.abs(v);if(a!==0&&(a<1e-9||a>=1e15))return v.toExponential(5).replace(/\.?0+e/,'E');
    return String(parseFloat(v.toPrecision(12)));
  }
  return String(v);
}
function cellInputText(cell){if(!cell)return '';if(cell.f!=null)return '='+cell.f;const v=cell.v;if(v==null)return '';if(typeof v==='boolean')return v?'TRUE':'FALSE';if(isErr(v))return v.error;if(typeof v==='number'&&cell.nf&&/[yd]/.test(cell.nf)&&!/[#0]/.test(cell.nf))return formatValue(v,cell.nf);if(typeof v==='string'&&cell.text)return "'"+v;return String(v);}

/* Reference rewriting for copy/paste, sort and insert/delete (string literals are skipped). */
const REF_RE=/(?<![A-Za-z0-9_.$])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(!])/g;
function mapRefs(f,fn){
  return String(f).split(/("(?:[^"]|"")*")/).map((part,i)=>{if(i%2)return part;let lastSheet=null,lastEnd=-1;return part.replace(REF_RE,(all,sh,cAbs,col,rAbs,row,off)=>{let sheet=sh?sh.slice(0,-1).replace(/^'|'$/g,'').replace(/''/g,"'"):null;if(!sheet&&off===lastEnd+1&&part[lastEnd]===':')sheet=lastSheet;const c=colIndex(col);if(c>16383)return all;const res=fn({sheet,c,r:+row-1,cAbs:!!cAbs,rAbs:!!rAbs});lastSheet=sheet;lastEnd=off+all.length;if(res==null)return all;if(res==='#REF!')return '#REF!';return (sh||'')+(res.cAbs?'$':'')+colName(res.c)+(res.rAbs?'$':'')+(res.r+1);});}).join('');
}
const translateFormula=(f,dr,dc)=>mapRefs(f,ref=>{const r=ref.rAbs?ref.r:ref.r+dr,c=ref.cAbs?ref.c:ref.c+dc;if(r<0||c<0)return '#REF!';return {...ref,r,c};});
function shiftFormula(f,ownerSheet,targetSheet,axis,at,delta){
  return mapRefs(f,ref=>{const sheet=ref.sheet||ownerSheet;if(sheet.toLowerCase()!==targetSheet.toLowerCase())return null;const k=axis==='r'?ref.r:ref.c;
    if(delta<0&&k>=at&&k<at-delta)return '#REF!';if(k<at)return null;const nk=k+delta;return axis==='r'?{...ref,r:nk}:{...ref,c:nk};});
}

/* ---------- undo ---------- */
function xSnapshot(){try{const s=JSON.stringify(X.wb);if(s.length>8e6)return null;return {wb:s,active:X.active,sel:{...X.sel}};}catch(_){return null;}}
function xMutate(fn,{render=true}={}){
  const snap=xSnapshot();if(snap){X.undo.push(snap);if(X.undo.length>60)X.undo.shift();X.redo=[];}
  fn();X.calc.clear();markDirty('excel');if(render){renderGrid();}
}
function xUndoRedo(from,to){const s=from.pop();if(!s)return;const cur=xSnapshot();if(cur)to.push(cur);X.wb=JSON.parse(s.wb);X.active=Math.min(s.active,X.wb.sheets.length-1);X.sel=s.sel;X.calc.clear();markDirty('excel');renderSheetTabs();renderGrid();}

/* ---------- grid ---------- */
const GRID=()=>$('ot-sheet-grid');
const selRange=()=>({r0:Math.min(X.sel.r,X.sel.r2),r1:Math.max(X.sel.r,X.sel.r2),c0:Math.min(X.sel.c,X.sel.c2),c1:Math.max(X.sel.c,X.sel.c2)});
function rowVisible(sh,r){if(!sh.filter||r===0||!sh.filter.q)return true;const v=cellValue(X.active,r,sh.filter.c);return formatValue(v,sh.cells[A1(r,sh.filter.c)]?.nf).toLowerCase().includes(sh.filter.q.toLowerCase());}
function cellStyleAttr(cell,v){
  const s=cell?.s||{};const st=[];
  if(s.b)st.push('font-weight:700');if(s.i)st.push('font-style:italic');if(s.u)st.push('text-decoration:underline');
  if(s.color)st.push('color:'+s.color);if(s.fill)st.push('background:'+s.fill);
  const al=s.al||(typeof v==='number'?'right':typeof v==='boolean'||isErr(v)?'center':'');if(al)st.push('text-align:'+al);
  return st.length?' style="'+st.join(';')+'"':'';
}
function renderGrid(){
  const g=GRID();if(!g||!X.wb)return;
  const sh=curSheet();const u=usedRange(sh);
  const nRows=Math.max(u.r+1+30,100,X.sel.r+2,X.sel.r2+2),nCols=Math.max(u.c+1+5,26,X.sel.c+2,X.sel.c2+2);
  const showRows=Math.min(nRows,X.renderRows);
  const prevScroll={t:g.scrollTop,l:g.scrollLeft};
  let tw=46;for(let c=0;c<nCols;c++)tw+=sh.cols[c]||96;
  let h='<table class="ot-grid'+(sh.frozen?' frozen':'')+'" style="width:'+tw+'px"><colgroup><col style="width:46px">';
  for(let c=0;c<nCols;c++)h+='<col style="width:'+(sh.cols[c]||96)+'px">';
  h+='</colgroup><thead><tr><th class="corner" title="Select all"></th>';
  for(let c=0;c<nCols;c++)h+='<th class="colhead" data-col="'+c+'">'+colName(c)+'<span class="ot-colresize" data-col="'+c+'"></span></th>';
  h+='</tr></thead><tbody>';
  for(let r=0;r<showRows;r++){
    if(!rowVisible(sh,r))continue;
    h+='<tr><th class="rowhead" data-row="'+r+'">'+(r+1)+'</th>';
    for(let c=0;c<nCols;c++){const cell=sh.cells[A1(r,c)];const v=cell?cellValue(X.active,r,c):null;const txt=cell?formatValue(v,cell.nf):'';h+='<td data-r="'+r+'" data-c="'+c+'"'+(cell?cellStyleAttr(cell,v):'')+(isErr(v)?' class="err"':'')+'>'+esc(txt)+'</td>';}
    h+='</tr>';
  }
  h+='</tbody></table>';
  if(nRows>showRows)h+='<div class="ot-more"><button type="button" class="ot-btn sm" id="ot-x-more">Show '+Math.min(1000,nRows-showRows)+' more rows ('+(nRows-showRows).toLocaleString()+' hidden)</button></div>';
  g.innerHTML=h;g.scrollTop=prevScroll.t;g.scrollLeft=prevScroll.l;
  $('ot-x-more')?.addEventListener('click',()=>{X.renderRows+=1000;renderGrid();});
  paintSelection();
  const fz=$('ot-x-freeze');if(fz)fz.checked=!!sh.frozen;
  const fi=$('ot-x-filter');if(fi&&document.activeElement!==fi)fi.value=sh.filter?.q||'';
}
function tdAt(r,c){return GRID()?.querySelector('td[data-r="'+r+'"][data-c="'+c+'"]');}
function paintSelection(){
  const g=GRID();if(!g)return;
  g.querySelectorAll('td.sel,td.active,th.hl').forEach(e=>e.classList.remove('sel','active','hl'));
  const {r0,r1,c0,c1}=selRange();
  const multi=r0!==r1||c0!==c1;
  if(multi&&(r1-r0+1)*(c1-c0+1)<=200000){g.querySelectorAll('tbody td').forEach(td=>{const r=+td.dataset.r,c=+td.dataset.c;if(r>=r0&&r<=r1&&c>=c0&&c<=c1)td.classList.add('sel');});}
  g.querySelectorAll('th.colhead').forEach(th=>{const c=+th.dataset.col;if(c>=c0&&c<=c1)th.classList.add('hl');});
  g.querySelectorAll('th.rowhead').forEach(th=>{const r=+th.dataset.row;if(r>=r0&&r<=r1)th.classList.add('hl');});
  const a=tdAt(X.sel.r,X.sel.c);if(a)a.classList.add('active');
  const sh=curSheet(),cell=sh.cells[A1(X.sel.r,X.sel.c)];
  const nm=$('ot-cell-name');if(nm&&document.activeElement!==nm)nm.value=multi?A1(r0,c0)+':'+A1(r1,c1):A1(X.sel.r,X.sel.c);
  const fb=$('ot-formula');if(fb&&document.activeElement!==fb)fb.value=cellInputText(cell);
  const nfSel=$('ot-x-numfmt');if(nfSel){const nf=cell?.nf||'';nfSel.value=[...nfSel.options].some(o=>o.value===nf)?nf:'';}
  document.querySelectorAll('#ot-panel-excel [data-xs]').forEach(b=>b.classList.toggle('on',!!cell?.s?.[b.dataset.xs]));
  updateSheetStats();
}
function updateSheetStats(){
  const el=$('ot-sheet-stats');if(!el)return;const {r0,r1,c0,c1}=selRange();
  if(r0===r1&&c0===c1){el.textContent='';return;}
  let n=0,sum=0,cnt=0;const sh=curSheet();
  for(const k in sh.cells){const p=parseA1(k);if(!p||p.r<r0||p.r>r1||p.c<c0||p.c>c1)continue;const v=cellValue(X.active,p.r,p.c);if(v!=null&&v!=='')cnt++;if(typeof v==='number'){n++;sum+=v;}}
  el.textContent=n?'Count '+cnt+' • Sum '+formatValue(sum)+' • Average '+formatValue(sum/n):'Count '+cnt;
}
function scrollCellIntoView(r,c){const td=tdAt(r,c);if(!td){if(r>=X.renderRows){X.renderRows=r+500;renderGrid();}return;}const g=GRID();const tr=td.getBoundingClientRect(),gr=g.getBoundingClientRect();const head=g.querySelector('thead')?.getBoundingClientRect().height||28;const rowHeadW=46;
  if(tr.top<gr.top+head)g.scrollTop-=gr.top+head-tr.top;else if(tr.bottom>gr.bottom)g.scrollTop+=tr.bottom-gr.bottom+2;
  if(tr.left<gr.left+rowHeadW)g.scrollLeft-=gr.left+rowHeadW-tr.left;else if(tr.right>gr.right)g.scrollLeft+=tr.right-gr.right+2;}
function selectCell(r,c,extend=false){r=clamp(r,0,1048575);c=clamp(c,0,16383);if(extend){X.sel.r2=r;X.sel.c2=c;}else X.sel={r,c,r2:r,c2:c};
  const sh=curSheet();const u=usedRange(sh);if(r>Math.max(u.r+30,99)||c>Math.max(u.c+5,25)){renderGrid();}else paintSelection();
  scrollCellIntoView(extend?X.sel.r2:r,extend?X.sel.c2:c);}
function setCellFromInput(r,c,text,{sheet=curSheet()}={}){
  const k=A1(r,c);const old=sheet.cells[k];const p=parseInput(text);
  if(p.v==null&&p.f==null){if(old&&(old.s||old.nf)){sheet.cells[k]={s:old.s,nf:old.nf};}else delete sheet.cells[k];return;}
  const cell={};if(old?.s)cell.s=old.s;cell.nf=old?.nf||p.nf;if(!cell.nf)delete cell.nf;
  if(p.f!=null){cell.f=p.f.replace(/^\+/,'');}else{cell.v=p.v;if(p.text)cell.text=true;}
  sheet.cells[k]=cell;
}
function commitEdit(move){
  const ed=X.editing;if(!ed)return;X.editing=null;
  const val=ed.input.value;
  if(val!==ed.original){xMutate(()=>setCellFromInput(ed.r,ed.c,val),{render:false});if(/^=/.test(val))ensureFormulaEngine();}
  renderGrid();
  if(move){const [dr,dc]=move;selectCell(X.sel.r+dr,X.sel.c+dc);}
  GRID().focus({preventScroll:true});
}
function cancelEdit(){if(!X.editing)return;X.editing=null;renderGrid();GRID().focus({preventScroll:true});}
function startEdit(initial){
  const r=X.sel.r,c=X.sel.c;const td=tdAt(r,c);if(!td)return;
  const cell=curSheet().cells[A1(r,c)];const original=cellInputText(cell);
  const input=document.createElement('input');input.className='ot-cell-input';input.value=initial!=null?initial:original;input.spellcheck=false;input.autocomplete='off';
  td.textContent='';td.appendChild(input);input.focus();if(initial==null)input.setSelectionRange(input.value.length,input.value.length);
  X.editing={r,c,input,original};
  const fb=$('ot-formula');input.addEventListener('input',()=>{if(fb)fb.value=input.value;});
  input.addEventListener('keydown',e=>{
    e.stopPropagation();
    if(e.key==='Enter'){e.preventDefault();commitEdit(e.shiftKey?[-1,0]:[1,0]);}
    else if(e.key==='Tab'){e.preventDefault();commitEdit(e.shiftKey?[0,-1]:[0,1]);}
    else if(e.key==='Escape'){e.preventDefault();cancelEdit();}
    else if((e.key==='ArrowUp'||e.key==='ArrowDown')&&initial!=null&&!/^=/.test(input.value)){e.preventDefault();commitEdit(e.key==='ArrowUp'?[-1,0]:[1,0]);}
  });
  input.addEventListener('blur',()=>{setTimeout(()=>{if(X.editing&&X.editing.input===input&&document.activeElement!==$('ot-formula'))commitEdit(null);},0);});
}
function forEachSel(fn){const {r0,r1,c0,c1}=selRange();for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)fn(r,c);}
function applyCellStyle(patch){
  const sh=curSheet();const {r0,r1,c0,c1}=selRange();if((r1-r0+1)*(c1-c0+1)>500000)return notify('Selection too large to format.',true);
  xMutate(()=>forEachSel((r,c)=>{const k=A1(r,c);const cell=sh.cells[k]||{};const s={...(cell.s||{})};Object.entries(patch).forEach(([p,v])=>{if(v==null||v===false||v==='')delete s[p];else s[p]=v;});if(Object.keys(s).length)cell.s=s;else delete cell.s;if(cell.v==null&&cell.f==null&&!cell.s&&!cell.nf)delete sh.cells[k];else sh.cells[k]=cell;}));
}
function toggleStyle(key){const cell=curSheet().cells[A1(X.sel.r,X.sel.c)];applyCellStyle({[key]:!cell?.s?.[key]});}
function setNumFmt(nf){const sh=curSheet();xMutate(()=>forEachSel((r,c)=>{const k=A1(r,c);const cell=sh.cells[k]||{};if(nf)cell.nf=nf;else delete cell.nf;if(cell.v==null&&cell.f==null&&!cell.s&&!cell.nf)delete sh.cells[k];else sh.cells[k]=cell;}));}
function clearSelection(contentsOnly=true){const sh=curSheet();xMutate(()=>forEachSel((r,c)=>{const k=A1(r,c);const cell=sh.cells[k];if(!cell)return;if(contentsOnly&&(cell.s||cell.nf)){delete cell.v;delete cell.f;delete cell.cached;delete cell.text;if(!cell.s&&!cell.nf)delete sh.cells[k];}else delete sh.cells[k];}));}
function selectionTSV(){const {r0,r1,c0,c1}=selRange();const lines=[];for(let r=r0;r<=r1;r++){const row=[];for(let c=c0;c<=c1;c++){const cell=curSheet().cells[A1(r,c)];let t=cell?formatValue(cellValue(X.active,r,c),cell.nf):'';if(/[\t\n"]/.test(t))t='"'+t.replace(/"/g,'""')+'"';row.push(t);}lines.push(row.join('\t'));}return lines.join('\n');}
function parseTSV(text){const rows=[];let row=[],f='',q=false;text=String(text).replace(/\r\n?/g,'\n');if(text.endsWith('\n'))text=text.slice(0,-1);for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=ch;}else if(ch==='"'&&f==='')q=true;else if(ch==='\t'){row.push(f);f='';}else if(ch==='\n'){row.push(f);rows.push(row);row=[];f='';}else f+=ch;}row.push(f);rows.push(row);return rows;}
function copySelection(e,cut){
  const tsv=selectionTSV();const {r0,r1,c0,c1}=selRange();const sh=curSheet();
  const cells=[];for(let r=r0;r<=r1;r++){const row=[];for(let c=c0;c<=c1;c++)row.push(sh.cells[A1(r,c)]?JSON.parse(JSON.stringify(sh.cells[A1(r,c)])):null);cells.push(row);}
  X.clip={tsv,cells,r0,c0};
  if(e&&e.clipboardData){e.clipboardData.setData('text/plain',tsv);e.preventDefault();}
  if(cut)clearSelection(false);
}
function pasteText(text){
  const sh=curSheet();const r0=Math.min(X.sel.r,X.sel.r2),c0=Math.min(X.sel.c,X.sel.c2);
  if(X.clip&&text===X.clip.tsv){const {cells,r0:sr,c0:sc}=X.clip;const dr=r0-sr,dc=c0-sc;xMutate(()=>cells.forEach((row,i)=>row.forEach((cell,j)=>{const k=A1(r0+i,c0+j);if(!cell){delete sh.cells[k];return;}const n=JSON.parse(JSON.stringify(cell));if(n.f!=null)n.f=translateFormula(n.f,dr,dc);sh.cells[k]=n;})));X.sel={r:r0,c:c0,r2:r0+cells.length-1,c2:c0+cells[0].length-1};paintSelection();return;}
  const rows=parseTSV(text);if(rows.length*Math.max(...rows.map(r=>r.length))>500000)return notify('Clipboard data is too large to paste.',true);
  xMutate(()=>rows.forEach((row,i)=>row.forEach((v,j)=>setCellFromInput(r0+i,c0+j,v))));
  X.sel={r:r0,c:c0,r2:r0+rows.length-1,c2:c0+Math.max(...rows.map(r=>r.length))-1};paintSelection();
  if(rows.some(r=>r.some(v=>/^=/.test(v))))ensureFormulaEngine();
}
function moveCellsAxis(axis,at,delta){
  const sh=curSheet();const moved={};
  for(const [k,cell] of Object.entries(sh.cells)){const p=parseA1(k);const v=axis==='r'?p.r:p.c;
    if(delta<0&&v>=at&&v<at-delta)continue;
    const nv=v>=at?v+delta:v;if(nv<0)continue;moved[axis==='r'?A1(nv,p.c):A1(p.r,nv)]=cell;}
  sh.cells=moved;
  X.wb.sheets.forEach(s=>{for(const cell of Object.values(s.cells))if(cell.f!=null)cell.f=shiftFormula(cell.f,s.name,sh.name,axis,at,delta);});
  if(axis==='c'){const cols={};Object.entries(sh.cols).forEach(([c,w])=>{c=+c;if(delta<0&&c>=at&&c<at-delta)return;cols[c>=at?c+delta:c]=w;});sh.cols=cols;}
  sh.merges=[];
}
function insertRows(){const {r0,r1}=selRange();const n=r1-r0+1;xMutate(()=>moveCellsAxis('r',r0,n));}
function insertCols(){const {c0,c1}=selRange();const n=c1-c0+1;xMutate(()=>moveCellsAxis('c',c0,n));}
function deleteRows(){const {r0,r1}=selRange();xMutate(()=>moveCellsAxis('r',r0,-(r1-r0+1)));}
function deleteCols(){const {c0,c1}=selRange();xMutate(()=>moveCellsAxis('c',c0,-(c1-c0+1)));}
function cmpValues(a,b){const rank=v=>v==null||v===''?3:typeof v==='number'?0:typeof v==='string'?1:2;const ra=rank(a),rb=rank(b);if(ra!==rb)return ra-rb;if(ra===0)return a-b;if(ra===1)return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});return 0;}
function sortRange(desc){
  const sh=curSheet();let {r0,r1,c0,c1}=selRange();const u=usedRange(sh);if(u.r<0)return;
  const key=X.sel.c;
  if(r0===r1){c0=0;c1=u.c;r1=u.r;r0=0;const header=[...Array(c1+1).keys()].some(c=>typeof cellValue(X.active,0,c)==='string')&&[...Array(c1+1).keys()].every(c=>{const v=cellValue(X.active,0,c);return v==null||typeof v==='string';});if(header)r0=1;}
  if(r1<=r0)return;
  xMutate(()=>{
    const rows=[];for(let r=r0;r<=r1;r++){const row={r,cells:{}};for(let c=c0;c<=c1;c++){const k=A1(r,c);if(sh.cells[k])row.cells[c]=sh.cells[k];}row.key=cellValue(X.active,r,key);rows.push(row);}
    rows.sort((a,b)=>{const ea=a.key==null||a.key==='',eb=b.key==null||b.key==='';if(ea||eb)return ea-eb;const d=cmpValues(a.key,b.key);return desc?-d:d;});
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)delete sh.cells[A1(r,c)];
    rows.forEach((row,i)=>{const nr=r0+i;Object.entries(row.cells).forEach(([c,cell])=>{const n={...cell};if(n.f!=null)n.f=translateFormula(n.f,nr-row.r,0);sh.cells[A1(nr,+c)]=n;});});
  });
}
function renderSheetTabs(){
  const box=$('ot-sheet-tablist');if(!box||!X.wb)return;
  box.innerHTML=X.wb.sheets.map((s,i)=>'<button type="button" class="ot-sheet-tab'+(i===X.active?' active':'')+'" data-i="'+i+'" title="Double-click to rename">'+esc(s.name)+'</button>').join('');
  box.querySelectorAll('.ot-sheet-tab').forEach(b=>{b.onclick=()=>{if(X.editing)commitEdit(null);X.active=+b.dataset.i;X.sel={r:0,c:0,r2:0,c2:0};X.renderRows=500;renderSheetTabs();renderGrid();};b.ondblclick=renameSheet;});
}
function validSheetName(n,except){n=String(n||'').trim();if(!n||n.length>31||/[\\\/?*\[\]:]/.test(n))return 'Sheet names must be 1–31 characters and cannot contain \\ / ? * [ ] :';if(X.wb.sheets.some((s,i)=>i!==except&&s.name.toLowerCase()===n.toLowerCase()))return 'A sheet with that name already exists.';return null;}
function addSheet(){let i=X.wb.sheets.length+1;while(X.wb.sheets.some(s=>s.name==='Sheet'+i))i++;xMutate(()=>{X.wb.sheets.push(newSheet('Sheet'+i));X.active=X.wb.sheets.length-1;X.sel={r:0,c:0,r2:0,c2:0};});renderSheetTabs();}
function renameSheet(){const sh=curSheet();const n=prompt('Rename sheet',sh.name);if(n==null)return;const err=validSheetName(n,X.active);if(err)return notify(err,true);const old=sh.name;const nn=n.trim();
  xMutate(()=>{sh.name=nn;const q=s=>/^[A-Za-z_][\w.]*$/.test(s)?s:"'"+s.replace(/'/g,"''")+"'";X.wb.sheets.forEach(s=>{for(const cell of Object.values(s.cells))if(cell.f!=null)cell.f=String(cell.f).split(/("(?:[^"]|"")*")/).map((p,i)=>i%2?p:p.replace(/(?<![\w.])('(?:[^']|'')+'|[A-Za-z_][\w.]*)!/g,(m,name)=>name.replace(/^'|'$/g,'').replace(/''/g,"'").toLowerCase()===old.toLowerCase()?q(nn)+'!':m)).join('');});});renderSheetTabs();}
function deleteSheet(){if(X.wb.sheets.length<2)return notify('A workbook needs at least one sheet.',true);if(!confirm('Delete sheet “'+curSheet().name+'”? This cannot be undone with Save, but Ctrl+Z works.'))return;xMutate(()=>{X.wb.sheets.splice(X.active,1);X.active=Math.max(0,X.active-1);});renderSheetTabs();}
function newWorkbook(){X.wb={sheets:[newSheet('Sheet1')]};X.active=0;X.sel={r:0,c:0,r2:0,c2:0};X.undo=[];X.redo=[];X.calc.clear();X.renderRows=500;docs.excel.name='Book1.xlsx';docs.excel.handle=null;markClean('excel');setMode('excel');}

/* ---------- spreadsheet import / export ---------- */
async function sheetOpen(file){
  const e=ext(file.name);let wb=null;
  if(['xlsx','xlsm','xltx','xltm'].includes(e)){try{wb=await readWithExcelJS(await file.arrayBuffer());}catch(err){console.warn('ExcelJS could not read this file, trying SheetJS',err);}}
  if(!wb)wb=await readWithSheetJS(file,e);
  if(!wb.sheets.length)wb.sheets.push(newSheet('Sheet1'));
  X.wb=wb;X.active=0;X.sel={r:0,c:0,r2:0,c2:0};X.undo=[];X.redo=[];X.calc.clear();X.renderRows=500;
  if(wb.sheets.some(s=>Object.values(s.cells).some(c=>c.f!=null)))ensureFormulaEngine();
}
async function readWithExcelJS(buf){
  const E=await lib('exceljs');const book=new E.Workbook();await book.xlsx.load(buf);
  const out={sheets:[]};const hex=a=>a&&/^[0-9A-F]{8}$/i.test(a)?'#'+a.slice(2):null;
  book.eachSheet(ws=>{
    if(ws.state==='veryHidden')return;
    const sh=newSheet(ws.name);
    ws.eachRow({includeEmpty:false},(row,rn)=>{row.eachCell({includeEmpty:false},(cell,cn)=>{
      if(cell.isMerged&&cell.master&&cell.master!==cell)return;
      const c={};let v=cell.value;
      if(v instanceof Date){c.v=serialFromDate(v);c.nf=cell.numFmt&&cell.numFmt!=='General'?cell.numFmt:'yyyy-mm-dd';}
      else if(v&&typeof v==='object'){
        if('formula' in v||'sharedFormula' in v){c.f=cell.formula||v.formula;let res=v.result;if(res instanceof Date)res=serialFromDate(res);else if(res&&typeof res==='object'&&res.error)res={error:res.error};c.cached=res??null;if(!c.f){delete c.f;c.v=c.cached;}}
        else if(v.richText)c.v=v.richText.map(t=>t.text).join('');
        else if('hyperlink' in v){c.v=typeof v.text==='string'?v.text:(v.text?.richText||[]).map(t=>t.text).join('');}
        else if('error' in v)c.v={error:v.error};
        else c.v=String(cell.text??'');
      }else c.v=v;
      if(!c.nf&&cell.numFmt&&cell.numFmt!=='General')c.nf=cell.numFmt;
      const s={};const f=cell.font||{};if(f.bold)s.b=true;if(f.italic)s.i=true;if(f.underline)s.u=true;const fc=hex(f.color?.argb);if(fc&&fc!=='#000000')s.color=fc;
      const fill=cell.fill;if(fill&&fill.type==='pattern'&&fill.pattern==='solid'){const bg=hex(fill.fgColor?.argb);if(bg&&bg!=='#FFFFFF')s.fill=bg;}
      const al=cell.alignment?.horizontal;if(['left','center','right'].includes(al))s.al=al;
      if(Object.keys(s).length)c.s=s;
      if(c.v===undefined&&c.f==null&&!c.s)return;
      sh.cells[A1(rn-1,cn-1)]=c;
    });});
    (ws.columns||[]).forEach((col,i)=>{if(col&&col.width&&Math.abs(col.width-9)>.5)sh.cols[i]=Math.round(clamp(col.width,2,120)*7+8);});
    sh.merges=(ws.model?.merges||[]).slice();
    sh.frozen=!!(ws.views||[]).find(v=>v.state==='frozen');
    out.sheets.push(sh);
  });
  return out;
}
async function readWithSheetJS(file,e){
  const XL=await lib('xlsx');let book;
  if(e==='csv'||e==='tsv'){const text=(await decodeBytes(await file.arrayBuffer())).text;book=XL.read(text,{type:'string',FS:e==='tsv'?'\t':undefined,cellFormula:true,cellNF:true});}
  else book=XL.read(await file.arrayBuffer(),{type:'array',cellFormula:true,cellNF:true,cellStyles:true});
  const out={sheets:[]};
  book.SheetNames.forEach(name=>{const ws=book.Sheets[name];const sh=newSheet(name);
    Object.keys(ws).forEach(k=>{if(k[0]==='!')return;const x=ws[k];const c={};
      if(x.f)c.f=x.f;
      const val=x.t==='e'?{error:x.w||'#N/A'}:x.t==='d'?serialFromDate(new Date(x.v)):x.t==='z'?null:x.v;
      if(c.f){c.cached=val;}else c.v=val;
      if(x.z&&x.z!=='General')c.nf=x.z;
      if(c.v==null&&c.f==null)return;sh.cells[k.replace(/\$/g,'')]=c;});
    (ws['!cols']||[]).forEach((col,i)=>{if(col&&(col.wpx||col.wch))sh.cols[i]=Math.round(col.wpx||col.wch*7+8);});
    sh.merges=(ws['!merges']||[]).map(m=>XL.utils.encode_range(m));
    out.sheets.push(sh);});
  return out;
}
function exportValue(si,k,cell){const p=parseA1(k);return cell.f!=null?cellValue(si,p.r,p.c):cell.v;}
async function sheetExport(fmt){
  if(!X.wb)throw new Error('No workbook is open.');
  if(X.wb.sheets.some(s=>Object.values(s.cells).some(c=>c.f!=null)))await ensureFormulaEngine();
  X.calc.clear();
  if(fmt==='xlsx'){
    const E=await lib('exceljs');const book=new E.Workbook();book.creator='Redmark Forge Office Tools';book.created=new Date();
    X.wb.sheets.forEach((sh,si)=>{
      const ws=book.addWorksheet(sh.name,{views:sh.frozen?[{state:'frozen',xSplit:1,ySplit:1}]:[]});
      Object.entries(sh.cols).forEach(([c,w])=>{ws.getColumn(+c+1).width=Math.max(1,(w-8)/7);});
      for(const [k,c] of Object.entries(sh.cells)){
        const cell=ws.getCell(k);const val=exportValue(si,k,c);
        if(c.f!=null){const res=isErr(val)?{error:val.error}:val;cell.value={formula:c.f,result:res};}
        else if(isErr(c.v))cell.value={error:c.v.error};
        else if(c.v!=null)cell.value=c.v;
        if(c.nf)cell.numFmt=c.nf;
        const s=c.s;if(s){const font={};if(s.b)font.bold=true;if(s.i)font.italic=true;if(s.u)font.underline=true;if(s.color)font.color={argb:'FF'+s.color.slice(1).toUpperCase()};if(Object.keys(font).length)cell.font=font;if(s.fill)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+s.fill.slice(1).toUpperCase()}};if(s.al)cell.alignment={horizontal:s.al};}
      }
      (sh.merges||[]).forEach(m=>{try{ws.mergeCells(m);}catch(_){}});
    });
    const buf=await book.xlsx.writeBuffer();
    return new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const XL=await lib('xlsx');
  const toWS=(sh,si)=>{const ws={};const u=usedRange(sh);
    for(const [k,c] of Object.entries(sh.cells)){const v=exportValue(si,k,c);const x={};
      if(isErr(v)){x.t='e';x.v=({'#NULL!':0,'#DIV/0!':7,'#VALUE!':15,'#REF!':23,'#NAME?':29,'#NUM!':36,'#N/A':42}[v.error]??15);x.w=v.error;}
      else if(typeof v==='number'){x.t='n';x.v=v;}else if(typeof v==='boolean'){x.t='b';x.v=v;}else if(v==null||v===''){if(c.f==null)continue;x.t='s';x.v='';}else{x.t='s';x.v=String(v);}
      if(c.f!=null)x.f=c.f;if(c.nf){x.z=c.nf;}ws[k]=x;}
    ws['!ref']=u.r<0?'A1':XL.utils.encode_range({s:{r:0,c:0},e:{r:u.r,c:u.c}});
    const cols=[];Object.entries(sh.cols).forEach(([c,w])=>{cols[+c]={wpx:w};});if(cols.length)ws['!cols']=cols;
    if(sh.merges?.length)ws['!merges']=sh.merges.map(m=>XL.utils.decode_range(m));
    return ws;};
  if(fmt==='csv'||fmt==='tsv'){const ws=toWS(curSheet(),X.active);const text=XL.utils.sheet_to_csv(ws,{FS:fmt==='tsv'?'\t':',',blankrows:true});return new Blob(['\ufeff'+text],{type:fmt==='tsv'?'text/tab-separated-values;charset=utf-8':'text/csv;charset=utf-8'});}
  if(fmt==='html'){const ws=toWS(curSheet(),X.active);return new Blob([XL.utils.sheet_to_html(ws,{header:'<!doctype html><html><head><meta charset="utf-8"><title>'+esc(curSheet().name)+'</title><style>table{border-collapse:collapse;font:13px Arial}td{border:1px solid #ccc;padding:4px 6px}</style></head><body>'})],{type:'text/html;charset=utf-8'});}
  const book=XL.utils.book_new();X.wb.sheets.forEach((sh,si)=>XL.utils.book_append_sheet(book,toWS(sh,si),sh.name.slice(0,31)));
  const bookType={xls:'biff8',xlsb:'xlsb',ods:'ods',fods:'fods'}[fmt];if(!bookType)throw new Error('Unsupported spreadsheet format: '+fmt);
  const out=XL.write(book,{bookType,type:'array',compression:true});
  const mime={xls:'application/vnd.ms-excel',xlsb:'application/vnd.ms-excel.sheet.binary.macroEnabled.12',ods:'application/vnd.oasis.opendocument.spreadsheet',fods:'application/vnd.oasis.opendocument.spreadsheet'}[fmt];
  return new Blob([out],{type:mime});
}
function sheetPrint(){
  const sh=curSheet();const u=usedRange(sh);if(u.r<0)return notify('This sheet is empty.',true);
  let h='<h3>'+esc(sh.name)+'</h3><table>';
  for(let r=0;r<=u.r;r++){if(!rowVisible(sh,r))continue;h+='<tr>';for(let c=0;c<=u.c;c++){const cell=sh.cells[A1(r,c)];const v=cell?cellValue(X.active,r,c):null;h+='<td'+(cell?cellStyleAttr(cell,v):'')+'>'+esc(cell?formatValue(v,cell.nf):'')+'</td>';}h+='</tr>';}
  printHTML(sh.name,h+'</table>','@page{size:landscape;margin:12mm}body{font:10pt Arial,sans-serif}table{border-collapse:collapse}td{border:1px solid #bbb;padding:3px 6px;white-space:nowrap}tr{break-inside:avoid}');
}

/* =====================================================================
 * POWERPOINT / IMPRESS
 * ===================================================================== */
const THEMES={
  light:{bg:'FFFFFF',title:'1C1B3A',text:'334155',accent:'2563EB'},
  ocean:{bg:'0B3D5C',title:'FFFFFF',text:'D6ECF7',accent:'38BDF8'},
  sunset:{bg:'FFF4EC',title:'9A3412',text:'431407',accent:'F97316'},
  forest:{bg:'F0F7F1',title:'14532D',text:'1F3A2A',accent:'16A34A'},
  dark:{bg:'0F172A',title:'F8FAFC',text:'CBD5E1',accent:'A78BFA'},
  mono:{bg:'FAFAFA',title:'111111',text:'333333',accent:'111111'}
};
const P={deck:{redmarkDeck:2,theme:'light',slides:[]},cur:0,presenting:false,presIdx:0};
const slideId=()=>'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const blankSlide=(layout='content')=>({id:slideId(),layout,title:layout==='title'?'Presentation title':layout==='section'?'Section title':'Slide title',body:layout==='title'?'Subtitle — presenter name':layout==='section'?'':'First point\nSecond point\n\tSupporting detail',body2:layout==='two'?'Right column point':'',notes:'',image:null});
function newDeck(silent){P.deck={redmarkDeck:2,theme:'light',slides:[blankSlide('title'),blankSlide('content')]};P.cur=0;if(!silent){docs.powerpoint.name='Presentation.pptx';docs.powerpoint.handle=null;markClean('powerpoint');setMode('powerpoint');}}
const curSlide=()=>P.deck.slides[P.cur];
const bodyLines=t=>String(t||'').split('\n').map(l=>{const m=/^(\t|  )*/.exec(l)[0];const level=(m.match(/\t|  /g)||[]).length;return {level:Math.min(level,4),text:l.slice(m.length).replace(/^[•\-*]\s+/,'')};}).filter(l=>l.text.trim());
function slideHTML(s,{editable=false}={}){
  const th=THEMES[P.deck.theme]||THEMES.light;
  const vars='--bg:#'+th.bg+';--tc:#'+th.title+';--fc:#'+th.text+';--ac:#'+th.accent;
  const ta=(f,cls,ph)=>editable?'<textarea class="'+cls+'" data-f="'+f+'" placeholder="'+ph+'" spellcheck="true">'+esc(s[f]||'')+'</textarea>':'<div class="'+cls+'">'+(f==='title'?esc(s[f]||''):list(s[f]))+'</div>';
  const list=t=>{const ls=bodyLines(t);if(!ls.length)return '';if(s.layout==='title'||s.layout==='section')return ls.map(l=>esc(l.text)).join('<br>');return '<ul>'+ls.map(l=>'<li class="lv'+l.level+'">'+esc(l.text)+'</li>').join('')+'</ul>';};
  const img=s.image?'<div class="ot-sl-img"><img src="'+s.image.src+'" alt=""></div>':(editable&&['image','blank'].includes(s.layout)?'<div class="ot-sl-img ph">Click “🖼 Image” to add a picture</div>':'');
  let inner='';
  if(s.layout==='blank')inner=img;
  else if(s.layout==='title'||s.layout==='section')inner=ta('title','ot-sl-title','Title')+ta('body','ot-sl-sub','Subtitle')+(s.image?img:'');
  else if(s.layout==='two')inner=ta('title','ot-sl-title','Title')+'<div class="ot-sl-cols">'+ta('body','ot-sl-body','Left column — one point per line')+ta('body2','ot-sl-body','Right column — one point per line')+'</div>';
  else if(s.layout==='image')inner=ta('title','ot-sl-title','Title')+img+ta('body','ot-sl-caption','Caption (optional)');
  else inner=ta('title','ot-sl-title','Title')+'<div class="ot-sl-cols'+(s.image?' with-img':'')+'">'+ta('body','ot-sl-body','One point per line — Tab to indent')+(s.image?img:'')+'</div>';
  return '<div class="ot-sl ot-ly-'+s.layout+'" style="'+vars+'">'+inner+'</div>';
}
/* Slide rendering CSS is shared by the editor stage, thumbnails, slide show and print. */
const SLIDE_CSS=`.ot-sl{width:1280px;height:720px;transform-origin:0 0;position:relative;box-sizing:border-box;padding:56px 72px 48px;background:var(--bg);color:var(--fc);font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;gap:18px;overflow:hidden}
.ot-sl *{box-sizing:border-box}
.ot-sl:not(.ot-ly-title):not(.ot-ly-section):not(.ot-ly-blank)::before{content:"";position:absolute;left:0;top:0;right:0;height:12px;background:var(--ac)}
.ot-sl-title{font:700 52px/1.12 'Calibri Light',Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:var(--tc);margin:0}
.ot-sl-sub{font-size:30px;line-height:1.35;color:var(--fc)}
.ot-sl-body{font-size:30px;line-height:1.4;flex:1;min-height:0;overflow:hidden}
.ot-sl-body ul{margin:0;padding-left:1.1em}.ot-sl-body li{margin:.18em 0}.ot-sl-body li::marker{color:var(--ac)}
.ot-sl-body li.lv1{margin-left:1.2em;font-size:.88em}.ot-sl-body li.lv2{margin-left:2.4em;font-size:.8em}.ot-sl-body li.lv3,.ot-sl-body li.lv4{margin-left:3.4em;font-size:.74em}
.ot-sl-cols{display:flex;gap:40px;flex:1;min-height:0}.ot-sl-cols>*{flex:1;min-width:0}
.ot-sl-cols.with-img>.ot-sl-body{flex:1.25}
.ot-sl-img{display:flex;align-items:center;justify-content:center;flex:1;min-height:0}.ot-sl-img img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px}
.ot-sl-img.ph{border:3px dashed color-mix(in srgb,var(--fc) 35%,transparent);border-radius:14px;font-size:26px;opacity:.7}
.ot-sl-caption{font-size:22px;font-style:italic;text-align:center;opacity:.85}
.ot-sl.ot-ly-title,.ot-sl.ot-ly-section{justify-content:center}
.ot-sl.ot-ly-title{text-align:center;align-items:stretch;border-bottom:48px solid var(--ac)}
.ot-sl.ot-ly-title .ot-sl-title{font-size:72px}
.ot-sl.ot-ly-title .ot-sl-img{flex:0 0 140px;order:-1}
.ot-sl.ot-ly-section{border-left:18px solid var(--ac);padding-left:96px}
.ot-sl.ot-ly-section .ot-sl-title{font-size:64px}
.ot-sl.ot-ly-blank{padding:0}
.ot-sl textarea{display:block;width:100%;border:2px dashed transparent;border-radius:10px;background:transparent;color:inherit;font:inherit;resize:none;outline:0;padding:4px 8px;margin:0;overflow:hidden}
.ot-sl textarea:hover{border-color:color-mix(in srgb,var(--fc) 25%,transparent)}
.ot-sl textarea:focus{border-color:var(--ac);background:color-mix(in srgb,var(--bg) 85%,var(--ac) 15%)}
.ot-sl textarea.ot-sl-body{height:100%;overflow:auto;tab-size:2.2em}
.ot-sl textarea::placeholder{color:currentColor;opacity:.45}`;
function fitStage(){const st=$('ot-stage');if(!st)return;const w=st.clientWidth;const sl=st.querySelector('.ot-sl');if(sl)sl.style.transform='scale('+(w/1280)+')';st.style.height=(w*9/16)+'px';}
function renderDeck(){
  const thumbs=$('ot-thumbs'),stage=$('ot-stage');if(!thumbs||!stage)return;
  P.cur=clamp(P.cur,0,P.deck.slides.length-1);
  thumbs.innerHTML=P.deck.slides.map((s,i)=>'<li class="ot-thumb'+(i===P.cur?' active':'')+'" draggable="true" data-i="'+i+'" tabindex="0" aria-label="Slide '+(i+1)+'"><span class="n">'+(i+1)+'</span><div class="ot-thumb-view">'+slideHTML(s)+'</div></li>').join('');
  thumbs.querySelectorAll('.ot-thumb').forEach(li=>{
    li.onclick=()=>{P.cur=+li.dataset.i;renderDeck();};
    li.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();P.cur=+li.dataset.i;renderDeck();}};
    li.ondragstart=e=>{e.dataTransfer.setData('text/plain',li.dataset.i);e.dataTransfer.effectAllowed='move';};
    li.ondragover=e=>{e.preventDefault();li.classList.add('drop');};li.ondragleave=()=>li.classList.remove('drop');
    li.ondrop=e=>{e.preventDefault();li.classList.remove('drop');const from=+e.dataTransfer.getData('text/plain'),to=+li.dataset.i;if(isNaN(from)||from===to)return;const [s]=P.deck.slides.splice(from,1);P.deck.slides.splice(to,0,s);P.cur=to;markDirty('powerpoint');renderDeck();};
  });
  const s=curSlide();stage.innerHTML=slideHTML(s,{editable:true});
  stage.querySelectorAll('textarea[data-f]').forEach(t=>{
    const auto=()=>{if(t.classList.contains('ot-sl-title')||t.classList.contains('ot-sl-sub')||t.classList.contains('ot-sl-caption')){t.style.height='auto';t.style.height=Math.max(t.scrollHeight,40)+'px';}};auto();
    t.addEventListener('input',()=>{s[t.dataset.f]=t.value;auto();markDirty('powerpoint');refreshThumb(P.cur);});
    t.addEventListener('keydown',e=>{if(e.key==='Tab'&&t.classList.contains('ot-sl-body')){e.preventDefault();const a=t.selectionStart,b=t.selectionEnd,v=t.value;const ls=v.lastIndexOf('\n',a-1)+1;if(e.shiftKey){if(v.slice(ls).startsWith('\t')){t.value=v.slice(0,ls)+v.slice(ls+1);t.selectionStart=t.selectionEnd=Math.max(ls,a-1);}}else{t.value=v.slice(0,ls)+'\t'+v.slice(ls);t.selectionStart=a+1;t.selectionEnd=b+1;}t.dispatchEvent(new Event('input'));}});
  });
  $('ot-slide-layout').value=s.layout;$('ot-deck-theme').value=P.deck.theme;
  const n=$('ot-slide-notes');if(n&&document.activeElement!==n)n.value=s.notes||'';
  fitStage();
  thumbs.querySelector('.ot-thumb.active')?.scrollIntoView({block:'nearest'});
}
const refreshThumb=debounce(i=>{const li=$('ot-thumbs')?.querySelector('.ot-thumb[data-i="'+i+'"] .ot-thumb-view');if(li&&P.deck.slides[i])li.innerHTML=slideHTML(P.deck.slides[i]);},250);
function deckMutate(fn){fn();markDirty('powerpoint');renderDeck();}
async function setSlideImage(file){
  try{const src=await normaliseImageFile(file,2400);const img=await loadImage(src);deckMutate(()=>{const s=curSlide();s.image={src,w:img.naturalWidth,h:img.naturalHeight};if(s.layout==='title'||s.layout==='section'||s.layout==='two')s.layout='content';});}
  catch(e){notify('Could not add image: '+e.message,true);}
}
/* PPTX import (text, levels, notes, first picture per slide) */
async function deckOpen(file){
  const e=ext(file.name);
  if(e==='json'){const x=JSON.parse(await file.text());if(!x||!Array.isArray(x.slides))throw new Error('Not a Redmark deck project.');P.deck={redmarkDeck:2,theme:THEMES[x.theme]?x.theme:'light',slides:x.slides.map(s=>({...blankSlide(s.layout||'content'),...s,id:slideId()}))};P.cur=0;return;}
  const Z=window.JSZip||await lib('jszip');const z=await Z.loadAsync(await file.arrayBuffer());
  const X_=s=>new DOMParser().parseFromString(s,'application/xml');
  const A='http://schemas.openxmlformats.org/drawingml/2006/main',PN='http://schemas.openxmlformats.org/presentationml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relsOf=async path=>{const dir=path.replace(/[^/]+$/,''),fn=path.split('/').pop();const f=z.file(dir+'_rels/'+fn+'.rels');const map={};if(!f)return map;for(const r of X_(await f.async('text')).getElementsByTagName('Relationship')){const t=r.getAttribute('Target');map[r.getAttribute('Id')]={type:r.getAttribute('Type')||'',target:r.getAttribute('TargetMode')==='External'?null:new URL(t,'http://x/'+dir).pathname.slice(1)};}return map;};
  let order=[];
  const presPath='ppt/presentation.xml';const pres=z.file(presPath);
  if(pres){const rels=await relsOf(presPath);for(const s of X_(await pres.async('text')).getElementsByTagNameNS(PN,'sldId')){const id=s.getAttributeNS(R,'id');if(rels[id]?.target)order.push(rels[id].target);}}
  if(!order.length)order=Object.keys(z.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>+a.match(/\d+/)[0]-+b.match(/\d+/)[0]);
  const paraText=p=>[...p.childNodes].map(n=>n.localName==='r'||n.localName==='fld'?([...n.getElementsByTagNameNS(A,'t')].map(t=>t.textContent).join('')):n.localName==='br'?' ':'').join('');
  const slides=[];
  for(const path of order){
    const f=z.file(path);if(!f)continue;const d=X_(await f.async('text'));const rels=await relsOf(path);
    let title='',sub='',isTitle=false,isSection=false;const shapes=[];const EMU=914400;
    for(const sp of d.getElementsByTagNameNS(PN,'sp')){
      const ph=sp.getElementsByTagNameNS(PN,'ph')[0];const type=ph?.getAttribute('type')||(ph?'body':'');
      if(['dt','ftr','sldNum','hdr'].includes(type))continue;
      const tx=sp.getElementsByTagNameNS(PN,'txBody')[0];if(!tx)continue;
      const paras=[...tx.getElementsByTagNameNS(A,'p')].map(p=>({level:+(p.getElementsByTagNameNS(A,'pPr')[0]?.getAttribute('lvl')||0),text:paraText(p),ctr:p.getElementsByTagNameNS(A,'pPr')[0]?.getAttribute('algn')==='ctr'})).filter(x=>x.text.trim());
      if(!paras.length)continue;
      const off=sp.getElementsByTagNameNS(A,'off')[0];const sizes=[...tx.getElementsByTagNameNS(A,'rPr'),...tx.getElementsByTagNameNS(A,'defRPr'),...tx.getElementsByTagNameNS(A,'endParaRPr')].map(r=>+r.getAttribute('sz')||0);
      shapes.push({type,paras,x:+(off?.getAttribute('x')||0)/EMU,y:+(off?.getAttribute('y')||0)/EMU,sz:Math.max(0,...sizes)/100,ctr:paras.every(p=>p.ctr)});
    }
    const txt=sh=>sh.paras.map(x=>'\t'.repeat(Math.min(x.level,4))+x.text).join('\n');
    let tShape=shapes.find(s=>s.type==='title'||s.type==='ctrTitle');
    if(tShape){if(tShape.type==='ctrTitle')isTitle=true;}
    else if(shapes.length){/* files without placeholders (e.g. generated decks): the largest text is the title */
      const big=[...shapes].sort((a,b)=>b.sz-a.sz||a.y-b.y)[0];const top=[...shapes].sort((a,b)=>a.y-b.y)[0];
      tShape=big.sz>=26&&big.paras.length<=2?big:(top.paras.length===1&&top.y<1.6?top:null);
      if(tShape&&tShape.y>1.5){if(tShape.ctr)isTitle=true;else isSection=true;}
    }
    if(tShape)title=tShape.paras.map(x=>x.text).join(' ');
    const subShape=shapes.find(s=>s.type==='subTitle');if(subShape){sub=subShape.paras.map(x=>x.text).join('\n');isTitle=true;}
    const rest=shapes.filter(s=>s!==tShape&&s!==subShape).sort((a,b)=>Math.abs(a.y-b.y)<0.3?a.x-b.x:a.y-b.y);
    if((isTitle||isSection)&&!subShape&&rest.length){sub=rest.map(r=>r.paras.map(x=>x.text).join('\n')).join('\n');rest.length=0;}
    const bodies=rest.map(txt);
    for(const tbl of d.getElementsByTagNameNS(A,'tbl')){bodies.push([...tbl.getElementsByTagNameNS(A,'tr')].map(tr=>[...tr.getElementsByTagNameNS(A,'tc')].map(tc=>tc.textContent.trim()).join(' | ')).join('\n'));}
    let image=null;
    for(const pic of d.getElementsByTagNameNS(PN,'pic')){const blip=pic.getElementsByTagNameNS(A,'blip')[0];const rid=blip?.getAttributeNS(R,'embed');const t=rid&&rels[rid]?.target;const mf=t&&z.file(t);if(mf&&/\.(png|jpe?g|gif|bmp|webp)$/i.test(t)){const b64=await mf.async('base64');const mime='image/'+(t.split('.').pop().toLowerCase().replace('jpg','jpeg'));const src='data:'+mime+';base64,'+b64;try{const im=await loadImage(src);image={src,w:im.naturalWidth,h:im.naturalHeight};}catch(_){}break;}}
    let notes='';const nRel=Object.values(rels).find(r=>/notesSlide$/.test(r.type));if(nRel?.target&&z.file(nRel.target)){const nd=X_(await z.file(nRel.target).async('text'));for(const sp of nd.getElementsByTagNameNS(PN,'sp')){const ph=sp.getElementsByTagNameNS(PN,'ph')[0];if(ph?.getAttribute('type')==='body'){notes=[...sp.getElementsByTagNameNS(A,'p')].map(paraText).join('\n').trim();break;}}}
    const layout=isTitle?'title':isSection?'section':bodies.length>=2?'two':image&&!bodies.length?(title?'image':'blank'):'content';
    slides.push({id:slideId(),layout,title,body:(isTitle||isSection)?sub:(bodies[0]||''),body2:layout==='two'?bodies.slice(1).join('\n'):'',notes,image});
  }
  if(!slides.length)throw new Error('No slides were found in this presentation.');
  let theme='light';try{const first=z.file(order[0]);const bg=first&&X_(await first.async('text')).getElementsByTagNameNS(PN,'bg')[0];const clr=bg&&bg.getElementsByTagNameNS(A,'srgbClr')[0]?.getAttribute('val');if(clr){const hit=Object.entries(THEMES).find(([,t])=>t.bg.toUpperCase()===clr.toUpperCase());if(hit)theme=hit[0];}}catch(_){}
  P.deck={redmarkDeck:2,theme,slides};P.cur=0;
}
function containBox(img,x,y,w,h){if(!img||!img.w||!img.h)return {x,y,w,h};const r=Math.min(w/img.w,h/img.h);const iw=img.w*r,ih=img.h*r;return {x:x+(w-iw)/2,y:y+(h-ih)/2,w:iw,h:ih};}
async function buildPptx(kind){
  const PG=await lib('pptxgenjs');const ppt=new PG();const th=THEMES[P.deck.theme]||THEMES.light;
  ppt.layout='LAYOUT_WIDE';ppt.author='Redmark Forge Office Tools';ppt.title=base(docs.powerpoint.name);
  const W=13.333;
  const bullets=(t,size)=>{const ls=bodyLines(t);return ls.length?ls.map(l=>({text:l.text,options:{bullet:l.level?{indent:18}:true,indentLevel:l.level,fontSize:Math.max(12,size-l.level*2),breakLine:true}})):[{text:''}];};
  const textOpts=(o)=>({fontFace:'Calibri',color:th.text,valign:'top',margin:4,fit:'shrink',...o});
  P.deck.slides.forEach(s=>{
    const sl=ppt.addSlide();sl.background={color:th.bg};
    const accentBar=()=>sl.addShape(ppt.ShapeType.rect,{x:0,y:0,w:W,h:0.12,fill:{color:th.accent},line:{color:th.accent,width:0}});
    const title=(o)=>sl.addText(s.title||'',{fontFace:'Calibri Light',bold:true,color:th.title,fontSize:32,valign:'middle',margin:2,fit:'shrink',x:0.6,y:0.35,w:W-1.2,h:1.0,...o});
    const pic=(x,y,w,h)=>{if(!s.image)return;const b=containBox(s.image,x,y,w,h);sl.addImage({data:s.image.src,...b});};
    if(s.layout==='title'){sl.addShape(ppt.ShapeType.rect,{x:0,y:6.9,w:W,h:0.6,fill:{color:th.accent},line:{color:th.accent,width:0}});title({x:0.8,y:2.2,w:W-1.6,h:1.6,fontSize:44,align:'center'});sl.addText(s.body||'',textOpts({x:1.2,y:3.9,w:W-2.4,h:1.2,fontSize:22,align:'center'}));pic(W/2-1.25,0.5,2.5,1.5);}
    else if(s.layout==='section'){sl.addShape(ppt.ShapeType.rect,{x:0.6,y:2.7,w:0.15,h:2.1,fill:{color:th.accent},line:{color:th.accent,width:0}});title({x:1.0,y:2.6,w:W-2,h:1.4,fontSize:40});sl.addText(s.body||'',textOpts({x:1.0,y:4.0,w:W-2,h:0.9,fontSize:22}));}
    else if(s.layout==='two'){accentBar();title();sl.addText(bullets(s.body,22),textOpts({x:0.7,y:1.55,w:5.85,h:5.45}));sl.addText(bullets(s.body2,22),textOpts({x:6.8,y:1.55,w:5.85,h:5.45}));}
    else if(s.layout==='image'){accentBar();title();pic(0.7,1.5,W-1.4,4.9);if((s.body||'').trim())sl.addText(s.body,textOpts({x:0.7,y:6.5,w:W-1.4,h:0.6,fontSize:14,align:'center',italic:true}));}
    else if(s.layout==='blank'){pic(0,0,W,7.5);}
    else{accentBar();title();sl.addText(bullets(s.body,22),textOpts({x:0.7,y:1.55,w:s.image?6.6:W-1.4,h:5.45}));pic(7.6,1.55,5.1,5.2);}
    if((s.notes||'').trim())sl.addNotes(s.notes);
  });
  let blob=await ppt.write({outputType:'blob'});
  if(kind==='ppsx'||kind==='potx'){
    const Z=window.JSZip||await lib('jszip');const z=await Z.loadAsync(blob);const ct=await z.file('[Content_Types].xml').async('text');
    z.file('[Content_Types].xml',ct.replace('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',kind==='ppsx'?'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml':'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml'));
    blob=await z.generateAsync({type:'blob',compression:'DEFLATE',mimeType:kind==='ppsx'?'application/vnd.openxmlformats-officedocument.presentationml.slideshow':'application/vnd.openxmlformats-officedocument.presentationml.template'});
  }
  return blob;
}
async function deckExport(fmt){
  if(fmt==='pdf'){deckPrint();return {print:true};}
  if(fmt==='json')return {blob:new Blob([JSON.stringify(P.deck,null,1)],{type:'application/json'})};
  return {blob:await buildPptx(fmt)};
}
const DECK_PRINT_CSS='@page{size:13.333in 7.5in;margin:0}html,body{margin:0}.pg{width:1280px;height:720px;overflow:hidden;break-after:page;page-break-after:always;position:relative}.pg:last-child{break-after:auto;page-break-after:auto}';
function deckPrint(){const css=SLIDE_CSS+DECK_PRINT_CSS;printHTML(base(docs.powerpoint.name),P.deck.slides.map(s=>'<div class="pg">'+slideHTML(s)+'</div>').join(''),css+'*{-webkit-print-color-adjust:exact;print-color-adjust:exact}');}
function present(from){
  const v=$('ot-present-view');if(!v)return;P.presenting=true;P.presIdx=clamp(from??P.cur,0,P.deck.slides.length-1);v.hidden=false;
  const show=()=>{const box=$('ot-present-slide');box.innerHTML=slideHTML(P.deck.slides[P.presIdx]);const sc=Math.min(innerWidth/1280,innerHeight/720);const sl=box.querySelector('.ot-sl');sl.style.transform='scale('+sc+')';box.style.width=1280*sc+'px';box.style.height=720*sc+'px';$('ot-present-hud').textContent=(P.presIdx+1)+' / '+P.deck.slides.length+'   ←/→ navigate • Esc exit';};
  P.presShow=show;show();v.focus();
  try{v.requestFullscreen?.().catch(()=>{});}catch(_){}
}
function presentStep(d){if(!P.presenting)return;const n=P.presIdx+d;if(n<0)return;if(n>=P.deck.slides.length)return endPresent();P.presIdx=n;P.presShow();}
function endPresent(){if(!P.presenting)return;P.presenting=false;$('ot-present-view').hidden=true;if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});P.cur=P.presIdx;renderDeck();}

/* =====================================================================
 * NOTEPAD
 * ===================================================================== */
const NOTE=()=>$('ot-note-editor');
async function decodeBytes(buf){
  const b=new Uint8Array(buf);
  if(b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF)return {text:new TextDecoder('utf-8').decode(b.subarray(3)),enc:'utf8bom'};
  if(b[0]===0xFF&&b[1]===0xFE)return {text:new TextDecoder('utf-16le').decode(b.subarray(2)),enc:'utf16le'};
  if(b[0]===0xFE&&b[1]===0xFF)return {text:new TextDecoder('utf-16be').decode(b.subarray(2)),enc:'utf16le'};
  try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(b),enc:'utf8'};}catch(_){return {text:new TextDecoder('windows-1252').decode(b),enc:'utf8'};}
}
async function noteOpen(file){
  if(file.size>50*1024*1024)throw new Error('File is larger than 50 MB — too large for the browser text editor.');
  const r=await decodeBytes(await file.arrayBuffer());
  if(/\u0000/.test(r.text.slice(0,4096))&&r.enc!=='utf16le')throw new Error('This looks like a binary file, not text.');
  $('ot-note-eol').value=/\r\n/.test(r.text)?'crlf':'lf';$('ot-note-enc').value=r.enc;
  NOTE().value=r.text.replace(/\r\n?/g,'\n');$('ot-note-name').value=file.name;updateNoteStatus();
}
function noteExport(){
  let t=NOTE().value;if($('ot-note-eol').value==='crlf')t=t.replace(/\r?\n/g,'\r\n');
  const enc=$('ot-note-enc').value;const name=$('ot-note-name').value||'Untitled.txt';
  const mime={json:'application/json',html:'text/html',htm:'text/html',css:'text/css',js:'text/javascript',xml:'application/xml',csv:'text/csv',md:'text/markdown',svg:'image/svg+xml'}[ext(name)]||'text/plain';
  if(enc==='utf16le'){const u=new Uint8Array(2+t.length*2);u[0]=0xFF;u[1]=0xFE;for(let i=0;i<t.length;i++){const c=t.charCodeAt(i);u[2+i*2]=c&255;u[3+i*2]=c>>8;}return new Blob([u],{type:mime});}
  return new Blob([(enc==='utf8bom'?'\ufeff':'')+t],{type:mime+';charset=utf-8'});
}
function newNote(){NOTE().value='';$('ot-note-name').value='Untitled.txt';docs.notepad.name='Untitled.txt';docs.notepad.handle=null;$('ot-note-eol').value=/Win/i.test(navigator.platform||'')?'crlf':'lf';$('ot-note-enc').value='utf8';markClean('notepad');setMode('notepad');updateNoteStatus();NOTE().focus();}
function updateNoteStatus(){const t=NOTE();if(!t)return;const pos=t.selectionStart;const before=t.value.slice(0,pos);const ln=before.split('\n').length,col=pos-before.lastIndexOf('\n');$('ot-note-pos').textContent='Ln '+ln+', Col '+col;const v=t.value;$('ot-note-stats').textContent=v.length.toLocaleString()+' characters • '+((v.match(/\S+/g)||[]).length).toLocaleString()+' words • '+(v?v.split('\n').length:0).toLocaleString()+' lines';}
function noteFind(q,cs,from){const t=NOTE();if(!q)return false;const hay=cs?t.value:t.value.toLowerCase(),n=cs?q:q.toLowerCase();let i=hay.indexOf(n,from??t.selectionEnd);if(i<0)i=hay.indexOf(n,0);if(i<0)return false;t.focus();t.setSelectionRange(i,i+q.length);const lines=t.value.slice(0,i).split('\n').length;t.scrollTop=Math.max(0,(lines-5)*parseFloat(getComputedStyle(t).lineHeight||'20'));updateNoteStatus();return true;}
function noteReplace(q,r,cs){const t=NOTE();const sel=t.value.slice(t.selectionStart,t.selectionEnd);if(sel&&(cs?sel===q:sel.toLowerCase()===q.toLowerCase())){t.setRangeText(r,t.selectionStart,t.selectionEnd,'end');markDirty('notepad');}return noteFind(q,cs);}
function noteReplaceAll(q,r,cs){if(!q)return 0;const t=NOTE();const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),cs?'g':'gi');let n=0;const v=t.value.replace(re,()=>{n++;return r;});if(n){t.value=v;markDirty('notepad');updateNoteStatus();}return n;}
function notePrint(){printHTML($('ot-note-name').value||'Text','<pre>'+esc(NOTE().value)+'</pre>','@page{margin:15mm}pre{font:10pt/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}');}

/* =====================================================================
 * Wiring
 * ===================================================================== */
function wireFindBar(prefix,{find,replace,replaceAll}){
  const bar=$(prefix),q=$(prefix+'-q'),r=$(prefix+'-r'),cs=$(prefix+'-case'),msg=$(prefix+'-msg');
  const say=t=>{msg.textContent=t;};
  $(prefix+'-next').onclick=()=>say(find(q.value,cs.checked)?'':'No matches');
  $(prefix+'-rep').onclick=()=>say(replace(q.value,r.value,cs.checked)?'':'No more matches');
  $(prefix+'-all').onclick=()=>{const n=replaceAll(q.value,r.value,cs.checked);say(n?n+' replaced':'No matches');};
  $(prefix+'-close').onclick=()=>{bar.hidden=true;};
  q.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();say(find(q.value,cs.checked)?'':'No matches');}if(e.key==='Escape')bar.hidden=true;};
  r.onkeydown=e=>{if(e.key==='Escape')bar.hidden=true;};
  return ()=>{bar.hidden=false;const s=mode==='word'?getSelection().toString():NOTE().value.slice(NOTE().selectionStart,NOTE().selectionEnd);if(s&&s.length<200&&!/\n/.test(s))q.value=s;q.focus();q.select();say('');};
}
function wire(){
  const r=root();if(!r||r.dataset.otWired)return;r.dataset.otWired='1';
  $('ot-file').accept=OPEN_ACCEPT;
  if(!$('ot-deck-css')){const st=document.createElement('style');st.id='ot-deck-css';st.textContent=SLIDE_CSS;document.head.appendChild(st);}
  MODES.forEach(t=>$('ot-'+t)?.addEventListener('click',()=>{if(X.editing)commitEdit(null);setMode(t);}));
  $('ot-open').onclick=async()=>{const p=await pickFile();if(p)openFile(p.file,p.handle);};
  $('ot-new').onclick=newDoc;$('ot-save').onclick=()=>saveCurrent();$('ot-saveas').onclick=saveAsDialog;$('ot-print').onclick=printCurrent;

  /* Word */
  const ed=ED();
  document.querySelectorAll('#ot-panel-word .ot-ribbon button').forEach(b=>b.addEventListener('mousedown',e=>e.preventDefault()));
  document.querySelectorAll('#ot-panel-word [data-cmd]').forEach(b=>b.addEventListener('click',()=>wcmd(b.dataset.cmd)));
  $('ot-block').onchange=e=>{wcmd('formatBlock','<'+e.target.value+'>');};
  $('ot-font').onchange=e=>applyInlineStyle('font-family',e.target.value);
  $('ot-size').onchange=e=>applyInlineStyle('font-size',e.target.value+'pt');
  ['ot-block','ot-font','ot-size','ot-forecolor','ot-hilite','ot-table-op'].forEach(id=>$(id)?.addEventListener('mousedown',wordSaveRange));
  $('ot-forecolor').oninput=e=>wcmd('foreColor',e.target.value);
  $('ot-hilite').oninput=e=>wcmd('hiliteColor',e.target.value);
  $('ot-link').onclick=insertLink;
  $('ot-image').onclick=()=>{wordSaveRange();pickImage(insertImageFile);};
  $('ot-table').onclick=insertTable;
  $('ot-table-op').onchange=e=>{const v=e.target.value;e.target.value='';if(v)tableOp(v);};
  $('ot-hr').onclick=()=>wcmd('insertHorizontalRule');
  $('ot-pagebreak').onclick=()=>{wordRestoreRange();document.execCommand('insertHTML',false,'<hr class="ot-page-break" data-page-break="true"><p><br></p>');wordChanged();};
  $('ot-word-zoom').onchange=e=>{ed.style.zoom=e.target.value;};
  ed.addEventListener('input',()=>{wordChanged();});
  ed.addEventListener('keyup',()=>{wordSaveRange();refreshWordToolbar();});
  ed.addEventListener('mouseup',()=>{wordSaveRange();refreshWordToolbar();});
  ed.addEventListener('dblclick',e=>{if(e.target.tagName==='IMG'){const w=prompt('Image width as % of the page (10–100)',parseInt(e.target.style.width)||100);if(w==null)return;const n=clamp(+w||100,5,100);e.target.style.width=n+'%';e.target.style.height='auto';wordChanged();}});
  ed.addEventListener('paste',async e=>{
    const dt=e.clipboardData;if(!dt)return;const html=dt.getData('text/html');const imgs=[...(dt.files||[])].filter(f=>/^image\//.test(f.type));
    if(imgs.length&&!html){e.preventDefault();wordSaveRange();for(const f of imgs)await insertImageFile(f);return;}
    if(html){e.preventDefault();wordSaveRange();let clean;try{clean=await sanitize(html.replace(/<!--[\s\S]*?-->/g,''));}catch(_){clean=esc(dt.getData('text/plain')).replace(/\n/g,'<br>');}wordRestoreRange();document.execCommand('insertHTML',false,clean);wordChanged();}
  });
  ed.addEventListener('drop',e=>{const f=[...(e.dataTransfer?.files||[])].filter(x=>/^image\//.test(x.type));if(f.length){e.preventDefault();const r=document.caretRangeFromPoint?.(e.clientX,e.clientY);if(r){const s=getSelection();s.removeAllRanges();s.addRange(r);wordSaveRange();}f.forEach(insertImageFile);}});
  ed.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&(e.ctrlKey||e.metaKey)){const u=safeUrl(a.getAttribute('href'));if(u)window.open(u,'_blank','noopener');}});
  document.addEventListener('selectionchange',()=>{if(mode==='word'&&isActive()&&ed.contains(getSelection()?.anchorNode))wordSaveRange();});
  const openWordFind=wireFindBar('ot-word-find',{find:(q,cs)=>wordFind(q,{caseSensitive:cs}),replace:wordReplace,replaceAll:wordReplaceAll});
  $('ot-find-toggle').onclick=openWordFind;

  /* Excel */
  const g=GRID();
  g.addEventListener('mousedown',e=>{
    if(e.target.classList.contains('ot-colresize')){e.preventDefault();const c=+e.target.dataset.col;const sx=e.clientX;const sh=curSheet();const w0=sh.cols[c]||96;const col=g.querySelectorAll('col')[c+1];const tbl=g.querySelector('table');const tw0=tbl?parseFloat(tbl.style.width)||0:0;const mv=ev=>{const w=clamp(w0+ev.clientX-sx,24,800);if(col)col.style.width=w+'px';if(tbl)tbl.style.width=(tw0+w-w0)+'px';sh.cols[c]=w;};const up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);markDirty('excel');};addEventListener('mousemove',mv);addEventListener('mouseup',up);return;}
    const td=e.target.closest('td[data-r]');const th=e.target.closest('th');
    if(td&&X.editing&&td.contains(X.editing.input))return;
    if(X.editing)commitEdit(null);
    if(td){e.preventDefault();g.focus({preventScroll:true});selectCell(+td.dataset.r,+td.dataset.c,e.shiftKey);X.dragSel=true;return;}
    if(th){e.preventDefault();g.focus({preventScroll:true});const u=usedRange(curSheet());
      if(th.classList.contains('corner')){X.sel={r:0,c:0,r2:Math.max(u.r,0),c2:Math.max(u.c,0)};}
      else if(th.dataset.col!=null){const c=+th.dataset.col;if(e.shiftKey){X.sel.c2=c;X.sel.r=0;}else X.sel={r:0,c,r2:Math.max(u.r,0),c2:c};X.sel.r2=Math.max(u.r,X.sel.r2,0);}
      else if(th.dataset.row!=null){const r=+th.dataset.row;if(e.shiftKey){X.sel.r2=r;X.sel.c=0;}else X.sel={r,c:0,r2:r,c2:Math.max(u.c,0)};X.sel.c2=Math.max(u.c,X.sel.c2,0);}
      paintSelection();}
  });
  g.addEventListener('mouseover',e=>{if(!X.dragSel||!(e.buttons&1))return;const td=e.target.closest('td[data-r]');if(td){X.sel.r2=+td.dataset.r;X.sel.c2=+td.dataset.c;paintSelection();}});
  addEventListener('mouseup',()=>{X.dragSel=false;});
  g.addEventListener('dblclick',e=>{const td=e.target.closest('td[data-r]');if(td&&!X.editing){selectCell(+td.dataset.r,+td.dataset.c);startEdit();}});
  g.addEventListener('keydown',e=>{
    if(X.editing)return;
    const mod=e.ctrlKey||e.metaKey,k=e.key;
    const sh=curSheet();
    const jump=(dr,dc)=>{let r=X.sel.r2,c=X.sel.c2;const has=(r,c)=>{const cell=sh.cells[A1(r,c)];return cell&&(cell.v!=null||cell.f!=null);};const u=usedRange(sh);if(!mod)return [r+dr,c+dc];const lim=dr?Math.max(u.r,0):Math.max(u.c,0);let nr=r+dr,nc=c+dc;if(has(r,c)&&has(nr,nc)){while(nr+dr>=0&&nc+dc>=0&&has(nr+dr,nc+dc)&&(dr?nr+dr<=lim:nc+dc<=lim)){nr+=dr;nc+=dc;}return [nr,nc];}while(nr>=0&&nc>=0&&(dr?nr<=lim:nc<=lim)&&!has(nr,nc)){nr+=dr;nc+=dc;}if(nr<0||nc<0)return [Math.max(nr,0),Math.max(nc,0)];if(dr?nr>lim:nc>lim)return dr?[lim,nc]:[nr,lim];return [nr,nc];};
    const arrows={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
    if(arrows[k]){e.preventDefault();const [r,c]=jump(...arrows[k]);if(e.shiftKey){selectCell(r,c,true);}else selectCell(r,c);return;}
    if(k==='Enter'){e.preventDefault();if(e.shiftKey)selectCell(X.sel.r-1,X.sel.c);else selectCell(X.sel.r+1,X.sel.c);return;}
    if(k==='Tab'){e.preventDefault();selectCell(X.sel.r,X.sel.c+(e.shiftKey?-1:1));return;}
    if(k==='Home'){e.preventDefault();selectCell(mod?0:X.sel.r,0);return;}
    if(k==='End'&&mod){e.preventDefault();const u=usedRange(sh);selectCell(Math.max(u.r,0),Math.max(u.c,0));return;}
    if(k==='PageDown'||k==='PageUp'){e.preventDefault();selectCell(X.sel.r+(k==='PageDown'?20:-20),X.sel.c,e.shiftKey);return;}
    if(k==='F2'){e.preventDefault();startEdit();return;}
    if(k==='Delete'||k==='Backspace'){e.preventDefault();clearSelection(true);return;}
    if(mod&&k.toLowerCase()==='z'){e.preventDefault();e.shiftKey?xUndoRedo(X.redo,X.undo):xUndoRedo(X.undo,X.redo);return;}
    if(mod&&k.toLowerCase()==='y'){e.preventDefault();xUndoRedo(X.redo,X.undo);return;}
    if(mod&&k.toLowerCase()==='b'){e.preventDefault();toggleStyle('b');return;}
    if(mod&&k.toLowerCase()==='i'){e.preventDefault();toggleStyle('i');return;}
    if(mod&&k.toLowerCase()==='u'){e.preventDefault();toggleStyle('u');return;}
    if(mod&&k.toLowerCase()==='a'){e.preventDefault();const u=usedRange(sh);X.sel={r:0,c:0,r2:Math.max(u.r,0),c2:Math.max(u.c,0)};paintSelection();return;}
    if(!mod&&!e.altKey&&k.length===1){e.preventDefault();startEdit(k);}
  });
  document.addEventListener('copy',e=>{if(isActive()&&mode==='excel'&&document.activeElement===g&&!X.editing)copySelection(e,false);});
  document.addEventListener('cut',e=>{if(isActive()&&mode==='excel'&&document.activeElement===g&&!X.editing)copySelection(e,true);});
  document.addEventListener('paste',e=>{if(isActive()&&mode==='excel'&&document.activeElement===g&&!X.editing){e.preventDefault();pasteText(e.clipboardData?.getData('text/plain')||'');}});
  const fb=$('ot-formula');
  fb.addEventListener('focus',()=>{if(X.editing)commitEdit(null);fb.dataset.orig=fb.value;});
  fb.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyFormulaBar(true);}else if(e.key==='Escape'){e.preventDefault();fb.value=fb.dataset.orig||'';g.focus();}});
  const applyFormulaBar=move=>{const v=fb.value;if(v!==cellInputText(curSheet().cells[A1(X.sel.r,X.sel.c)])){xMutate(()=>setCellFromInput(X.sel.r,X.sel.c,v));if(/^=/.test(v))ensureFormulaEngine();}fb.dataset.orig=v;if(move)selectCell(X.sel.r+1,X.sel.c);g.focus({preventScroll:true});};
  $('ot-formula-apply').onclick=()=>applyFormulaBar(false);
  $('ot-formula-cancel').onclick=()=>{fb.value=fb.dataset.orig||cellInputText(curSheet().cells[A1(X.sel.r,X.sel.c)]);g.focus();};
  const nm=$('ot-cell-name');nm.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const [a,b]=nm.value.trim().toUpperCase().split(':');const p=parseA1(a),q=b?parseA1(b):p;if(!p||!q)return notify('Enter a cell reference such as B12 or A1:C5.',true);X.sel={r:p.r,c:p.c,r2:q.r,c2:q.c};renderGrid();scrollCellIntoView(p.r,p.c);g.focus();}});
  document.querySelectorAll('#ot-panel-excel [data-xs]').forEach(b=>b.onclick=()=>{toggleStyle(b.dataset.xs);g.focus();});
  document.querySelectorAll('#ot-panel-excel [data-xal]').forEach(b=>b.onclick=()=>{const cur=curSheet().cells[A1(X.sel.r,X.sel.c)]?.s?.al;applyCellStyle({al:cur===b.dataset.xal?null:b.dataset.xal});g.focus();});
  $('ot-x-color').oninput=debounce(e=>applyCellStyle({color:e.target.value}),120);
  $('ot-x-fill').oninput=debounce(e=>applyCellStyle({fill:e.target.value}),120);
  $('ot-x-clearfmt').onclick=()=>{const sh=curSheet();xMutate(()=>forEachSel((r,c)=>{const k=A1(r,c);const cell=sh.cells[k];if(!cell)return;delete cell.s;delete cell.nf;if(cell.v==null&&cell.f==null)delete sh.cells[k];}));};
  $('ot-x-numfmt').onchange=e=>{setNumFmt(e.target.value);g.focus();};
  $('ot-x-row-add').onclick=insertRows;$('ot-x-col-add').onclick=insertCols;$('ot-x-row-del').onclick=deleteRows;$('ot-x-col-del').onclick=deleteCols;
  $('ot-x-sort-asc').onclick=()=>sortRange(false);$('ot-x-sort-desc').onclick=()=>sortRange(true);
  $('ot-x-filter').oninput=debounce(e=>{const sh=curSheet();const q=e.target.value.trim();sh.filter=q?{c:X.sel.c,q}:null;renderGrid();},200);
  $('ot-x-freeze').onchange=e=>{curSheet().frozen=e.target.checked;markDirty('excel');renderGrid();};
  $('ot-x-undo').onclick=()=>xUndoRedo(X.undo,X.redo);$('ot-x-redo').onclick=()=>xUndoRedo(X.redo,X.undo);
  $('ot-add-sheet').onclick=addSheet;$('ot-rename-sheet').onclick=renameSheet;$('ot-del-sheet').onclick=deleteSheet;

  /* PowerPoint */
  $('ot-add-slide').onclick=()=>deckMutate(()=>{P.deck.slides.splice(P.cur+1,0,blankSlide('content'));P.cur++;});
  $('ot-dup-slide').onclick=()=>deckMutate(()=>{const c=JSON.parse(JSON.stringify(curSlide()));c.id=slideId();P.deck.slides.splice(P.cur+1,0,c);P.cur++;});
  $('ot-del-slide').onclick=()=>{if(P.deck.slides.length<2)return notify('A presentation needs at least one slide.',true);deckMutate(()=>{P.deck.slides.splice(P.cur,1);P.cur=Math.max(0,P.cur-1);});};
  $('ot-slide-up').onclick=()=>{if(P.cur<1)return;deckMutate(()=>{const s=P.deck.slides;[s[P.cur-1],s[P.cur]]=[s[P.cur],s[P.cur-1]];P.cur--;});};
  $('ot-slide-down').onclick=()=>{const s=P.deck.slides;if(P.cur>=s.length-1)return;deckMutate(()=>{[s[P.cur+1],s[P.cur]]=[s[P.cur],s[P.cur+1]];P.cur++;});};
  $('ot-slide-layout').onchange=e=>deckMutate(()=>{curSlide().layout=e.target.value;});
  $('ot-deck-theme').onchange=e=>deckMutate(()=>{P.deck.theme=e.target.value;});
  $('ot-slide-image').onclick=()=>pickImage(setSlideImage);
  $('ot-slide-image-del').onclick=()=>{if(curSlide().image)deckMutate(()=>{curSlide().image=null;});};
  $('ot-slide-notes').oninput=e=>{curSlide().notes=e.target.value;markDirty('powerpoint');};
  $('ot-present').onclick=()=>present(P.cur);
  const pv=$('ot-present-view');
  pv.addEventListener('click',e=>{if(e.target.closest('.ot-present-hud'))return;presentStep(1);});
  document.addEventListener('keydown',e=>{if(!P.presenting)return;if(['ArrowRight','PageDown',' ','Enter','n'].includes(e.key)){e.preventDefault();presentStep(1);}else if(['ArrowLeft','PageUp','Backspace','p'].includes(e.key)){e.preventDefault();presentStep(-1);}else if(e.key==='Home'){P.presIdx=0;P.presShow();}else if(e.key==='End'){P.presIdx=P.deck.slides.length-1;P.presShow();}else if(e.key==='Escape'){e.preventDefault();endPresent();}});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&P.presenting)endPresent();});
  addEventListener('resize',debounce(()=>{fitStage();if(P.presenting)P.presShow();},100));
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>fitStage()).observe($('ot-stage'));

  /* Notepad */
  const nt=NOTE();
  nt.addEventListener('input',()=>{markDirty('notepad');updateNoteStatus();});
  ['keyup','click','select'].forEach(ev=>nt.addEventListener(ev,updateNoteStatus));
  nt.addEventListener('keydown',e=>{if(e.key==='Tab'&&!e.ctrlKey&&!e.altKey){e.preventDefault();nt.setRangeText('\t',nt.selectionStart,nt.selectionEnd,'end');markDirty('notepad');}});
  $('ot-note-name').addEventListener('input',e=>{docs.notepad.name=e.target.value||'Untitled.txt';$('ot-docname').textContent=docs.notepad.name;scheduleDraft('notepad');});
  $('ot-note-wrap').onchange=e=>{nt.style.whiteSpace=e.target.checked?'pre-wrap':'pre';nt.wrap=e.target.checked?'soft':'off';};
  $('ot-note-size').onchange=e=>{nt.style.setProperty('--ot-note-size',e.target.value+'px');};
  ['ot-note-eol','ot-note-enc'].forEach(id=>$(id).addEventListener('change',()=>markDirty('notepad')));
  const openNoteFind=wireFindBar('ot-note-find',{find:(q,cs)=>noteFind(q,cs),replace:noteReplace,replaceAll:noteReplaceAll});
  $('ot-note-find-toggle').onclick=openNoteFind;

  /* keyboard shortcuts — only while Office Tools is the visible studio */
  document.addEventListener('keydown',e=>{
    if(!isActive()||P.presenting)return;
    const mod=e.ctrlKey||e.metaKey;const k=(e.key||'').toLowerCase();
    if(mod&&k==='s'){e.preventDefault();if(X.editing)commitEdit(null);e.shiftKey?saveAsDialog():saveCurrent();}
    else if(mod&&k==='o'){e.preventDefault();$('ot-open').click();}
    else if(mod&&k==='p'){e.preventDefault();printCurrent();}
    else if(mod&&k==='f'&&(mode==='word'||mode==='notepad')){e.preventDefault();(mode==='word'?openWordFind:openNoteFind)();}
    else if(mod&&k==='h'&&(mode==='word'||mode==='notepad')){e.preventDefault();(mode==='word'?openWordFind:openNoteFind)();}
    else if(mod&&k==='k'&&mode==='word'&&ed.contains(document.activeElement)){e.preventDefault();insertLink();}
    else if(e.key==='F5'&&mode==='powerpoint'){e.preventDefault();present(e.shiftKey?P.cur:0);}
  });
  addEventListener('beforeunload',e=>{if(MODES.some(m=>docs[m].dirty)){MODES.forEach(saveDraft);e.preventDefault();e.returnValue='';}});
  /* drag & drop a file anywhere on the studio */
  r.addEventListener('dragover',e=>{if([...(e.dataTransfer?.types||[])].includes('Files')&&!ed.contains(e.target))e.preventDefault();});
  r.addEventListener('drop',e=>{if(ed.contains(e.target))return;const f=e.dataTransfer?.files?.[0];if(f){e.preventDefault();openFile(f,null);}});
  /* warm up libraries when the studio is first shown */
  const warm=()=>{lib('dompurify').catch(()=>{});};
  if(isActive())warm();else{const mo=new MutationObserver(()=>{if(isActive()){warm();mo.disconnect();fitStage();}});mo.observe(r,{attributes:true,attributeFilter:['class']});}

  /* restore drafts */
  const wd=loadDraft('word');if(wd){docs.word.name=wd.name||docs.word.name;docs.word.dirty=!!wd.dirty;sanitize(wd.content).then(c=>{ED().innerHTML=c||'<p><br></p>';}).catch(()=>{ED().innerHTML=wd.content;}).finally(updateWordCount);}
  const nd=loadDraft('notepad');if(nd){NOTE().value=nd.content;docs.notepad.name=nd.name||docs.notepad.name;docs.notepad.dirty=!!nd.dirty;$('ot-note-name').value=docs.notepad.name;}
  const pd=loadDraft('powerpoint');if(pd){try{const d=JSON.parse(pd.content);if(d&&Array.isArray(d.slides)&&d.slides.length){P.deck=d;docs.powerpoint.name=pd.name||docs.powerpoint.name;docs.powerpoint.dirty=!!pd.dirty;}}catch(_){}}
  const sd=loadDraft('excel');if(sd){try{const w=JSON.parse(sd.content);if(w&&Array.isArray(w.sheets)&&w.sheets.length){X.wb=w;docs.excel.name=sd.name||docs.excel.name;docs.excel.dirty=!!sd.dirty;}}catch(_){}}
  updateWordCount();updateNoteStatus();setMode('word');
  /* expose wiring to the suite's Validation Lab for buttons that have no id */
  r.querySelectorAll('button:not([id])').forEach(b=>{if(!b.dataset.action)b.dataset.action=b.dataset.cmd?'format-'+b.dataset.cmd:b.dataset.xs?'cell-style-'+b.dataset.xs:b.dataset.xal?'cell-align-'+b.dataset.xal:'office-control';});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
window.REDMARK_OFFICE_TOOLS={openFile,saveCurrent,setMode,
  /* exposed for automated tests */
  _test:{parseInput,translateFormula,shiftFormula,formatValue,editorIR,buildDocx,buildPptx,sheetExport,readWithExcelJS,cellValue:(r,c)=>cellValue(X.active,r,c),setCell:(r,c,t)=>{ensureWorkbook();xMutate(()=>setCellFromInput(r,c,t));},ensureFormulaEngine,state:()=>({X,P,docs,mode})}};
})();
