/* Redmark Forge — Office Tools
 * Browser-first lightweight office editor.
 * Uses the existing Omni document engine + SheetJS when available.
 * Designed for everyday editing, not macro-heavy desktop-office workloads.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const ext=n=>String(n||'').split('.').pop().toLowerCase();
const base=n=>String(n||'document').replace(/\.[^.]+$/,'')||'document';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const save=(blob,name)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);};
const notify=(m,e=false)=>window.omniNotify?window.omniNotify(m,e):console.log(m);

let mode='word', currentFile=null, currentName='Untitled';
let wordDirty=false, sheetDirty=false, deckDirty=false, noteDirty=false;
let sheetWB=null, sheetName=null, deckSlides=[];
const tabs=['word','excel','powerpoint','notepad'];

function setMode(next){
  mode=next;
  tabs.forEach(t=>{$('ot-'+t)?.classList.toggle('active',t===next);$('ot-panel-'+t)?.classList.toggle('active',t===next);});
  const labels={word:'Word / Writer',excel:'Excel / Calc',powerpoint:'PowerPoint / Impress',notepad:'Notepad'};
  $('ot-mode-label').textContent=labels[next]||next;
  updateStatus();
}
function updateStatus(){
  const dirty=(mode==='word'?wordDirty:mode==='excel'?sheetDirty:mode==='powerpoint'?deckDirty:noteDirty);
  $('ot-save-state').textContent=dirty?'● Unsaved changes':'✓ Saved / ready';
  $('ot-save-state').classList.toggle('dirty',dirty);
}
function markDirty(){if(mode==='word')wordDirty=true;else if(mode==='excel')sheetDirty=true;else if(mode==='powerpoint')deckDirty=true;else noteDirty=true;updateStatus();}

function modelFromWord(){
  const root=$('ot-word-editor'); const blocks=[];
  if(!root)return {title:currentName,blocks:[]};
  const walk=el=>{
    [...el.children].forEach(n=>{
      const tag=n.tagName.toLowerCase();
      if(/^h[1-6]$/.test(tag)) blocks.push({type:'heading',level:+tag[1],runs:[{text:n.innerText||''}]});
      else if(tag==='p') blocks.push({type:'para',runs:[{text:n.innerText||''}]});
      else if(tag==='pre') blocks.push({type:'code',text:n.innerText||''});
      else if(tag==='ul'||tag==='ol') blocks.push({type:'list',ordered:tag==='ol',items:[...n.children].map(li=>({level:0,runs:[{text:li.innerText||''}]}))});
      else if(tag==='table') blocks.push({type:'table',rows:[...n.rows].map(r=>[...r.cells].map(c=>c.innerText||'')).filter(r=>r.length),header:true});
      else if(tag==='blockquote') blocks.push({type:'para',runs:[{text:n.innerText||'',italic:true}]});
      else if(tag==='div') walk(n);
    });
  };
  walk(root);
  return {title:currentName,blocks};
}
function modelToWord(model){
  const out=[];
  (model.blocks||[]).forEach(b=>{
    if(b.type==='heading')out.push('<h'+Math.min(6,b.level||1)+'>'+esc((b.runs||[]).map(x=>x.text).join(''))+'</h'+Math.min(6,b.level||1)+'>');
    else if(b.type==='para')out.push('<p>'+esc((b.runs||[]).map(x=>x.text).join('')).replace(/\n/g,'<br>')+'</p>');
    else if(b.type==='code')out.push('<pre>'+esc(b.text||'')+'</pre>');
    else if(b.type==='list')out.push('<'+(b.ordered?'ol':'ul')+'>'+b.items.map(i=>'<li>'+esc((i.runs||[]).map(x=>x.text).join(''))+'</li>').join('')+'</'+(b.ordered?'ol':'ul')+'>');
    else if(b.type==='table')out.push('<table><tbody>'+b.rows.map((r,i)=>'<tr>'+r.map(c=>(b.header&&i===0?'<th>':'<td>')+esc(c)+(b.header&&i===0?'</th>':'</td>')).join('')+'</tr>').join('')+'</tbody></table>');
    else if(b.type==='slide')out.push('<h2>'+esc(b.title||'Slide')+'</h2><ul>'+b.items.map(i=>'<li>'+esc(i.text||'')+'</li>').join('')+'</ul>');
  });
  return out.join('')||'<p><br></p>';
}

async function openFile(file){
  if(!file)return;
  currentFile=file; currentName=file.name;
  const e=ext(file.name);
  try{
    if(['docx','docm','dotx','dotm','odt','ott','fodt','rtf','md','markdown','txt','text','html','htm','xhtml','pptx','pptm','ppsx','potx'].includes(e)){
      if(!window.OMNI_DOCS)throw new Error('Browser document engine is not loaded.');
      const model=await window.OMNI_DOCS.readDocument(file);
      if(!model)throw new Error('This office format could not be read in the browser.');
      if(['pptx','pptm','ppsx','potx'].includes(e)){
        deckSlides=(model.blocks||[]).filter(x=>x.type==='slide').map((s,i)=>({id:Date.now()+i,title:s.title||('Slide '+(i+1)),body:(s.items||[]).map(x=>x.text||'').join('\n'),notes:''}));
        renderDeck();setMode('powerpoint');deckDirty=false;
      }else{
        $('ot-word-editor').innerHTML=modelToWord(model);setMode('word');wordDirty=false;
      }
    }else if(['xls','xlsx','xlsm','xlsb','xlt','xltx','xltm','ods','ots','fods','csv','tsv'].includes(e)){
      if(!window.XLSX)throw new Error('Spreadsheet engine is not loaded.');
      const wb=e==='csv'||e==='tsv'?XLSX.read(await file.text(),{type:'string',FS:e==='tsv'?'\\t':','}):XLSX.read(await file.arrayBuffer(),{type:'array',cellStyles:true,cellFormula:true});
      sheetWB=wb; sheetName=wb.SheetNames[0]||'Sheet1'; renderSheet();setMode('excel');sheetDirty=false;
    }else{
      const text=await file.text();
      $('ot-note-editor').value=text;setMode('notepad');noteDirty=false;
    }
    updateStatus();notify('Opened '+file.name+' in Office Tools.');
  }catch(err){notify('Could not open '+file.name+': '+err.message,true);}
}

function newWord(){currentFile=null;currentName='Untitled.docx';$('ot-word-editor').innerHTML='<h1>Untitled Document</h1><p>Start writing here…</p>';wordDirty=true;setMode('word');updateStatus();}
function newExcel(){
  if(!window.XLSX)return notify('Spreadsheet engine is not loaded.',true);
  sheetWB=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([['',''],['','']]);XLSX.utils.book_append_sheet(sheetWB,ws,'Sheet1');sheetName='Sheet1';currentFile=null;currentName='Book1.xlsx';renderSheet();sheetDirty=true;setMode('excel');updateStatus();
}
function newDeck(){deckSlides=[{id:Date.now(),title:'Title',body:'Subtitle or key point',notes:''}];currentFile=null;currentName='Presentation.pptx';renderDeck();deckDirty=true;setMode('powerpoint');updateStatus();}
function newNote(){currentFile=null;currentName='Untitled.txt';$('ot-note-editor').value='';noteDirty=true;setMode('notepad');updateStatus();$('ot-note-editor').focus();}

async function saveCurrent(asName){
  try{
    if(mode==='word'){
      const model=modelFromWord();const target=ext(asName||currentName)||'docx';
      const allowed=['docx','odt','fodt','txt','md','html','pdf'];
      if(!allowed.includes(target))return save(new Blob([$('ot-word-editor').innerText],{type:'text/plain'}),asName||currentName);
      if(!window.OMNI_DOCS)throw new Error('Document engine is not loaded.');
      const r=await window.OMNI_DOCS.writeDocument(model,target);
      save(r.blob,(asName||base(currentName))+'.'+r.ext);currentName=(asName||base(currentName))+'.'+r.ext;wordDirty=false;
    }else if(mode==='excel'){
      if(!sheetWB||!window.XLSX)throw new Error('Spreadsheet engine is not loaded.');
      const name=asName||currentName||'Book1.xlsx',t=ext(name)||'xlsx';
      const typeMap={xlsx:'xlsx',xlsm:'xlsm',xls:'biff8',ods:'ods',csv:'csv',tsv:'csv'};
      const bookType=typeMap[t]||'xlsx';
      const out=XLSX.write(sheetWB,{bookType,bookSST:false,type:'array'});
      save(new Blob([out],{type:t==='csv'||t==='tsv'?'text/csv':'application/octet-stream'}),name.endsWith('.'+t)?name:name+'.'+t);
      currentName=name.endsWith('.'+t)?name:name+'.'+t;sheetDirty=false;
    }else if(mode==='powerpoint'){
      const name=asName||currentName||'Presentation.pptx',t=ext(name)||'pptx';
      if(t!=='pptx'&&t!=='pptm'&&t!=='ppsx')throw new Error('Browser editor saves presentations as PPTX; legacy formats can be exported through the Local Engine.');
      save(await buildPptx(deckSlides),name.endsWith('.'+t)?name:name+'.'+t);currentName=name;deckDirty=false;
    }else{
      const name=asName||currentName||'Untitled.txt';
      save(new Blob([$('ot-note-editor').value],{type:'text/plain;charset=utf-8'}),name);currentName=name;noteDirty=false;
    }
    updateStatus();notify('Saved '+currentName+'.');
  }catch(err){notify('Save failed: '+err.message,true);}
}

function exec(cmd,val=null){$('ot-word-editor')?.focus();try{document.execCommand(cmd,false,val);markDirty();}catch(e){}}
function insertLink(){const u=prompt('Link URL');if(u)exec('createLink',u);}
function insertImage(){
  const i=document.createElement('input');i.type='file';i.accept='image/*';i.onchange=()=>{const f=i.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{exec('insertImage',r.result);};r.readAsDataURL(f);};i.click();
}

function renderSheet(){
  const root=$('ot-sheet-grid');if(!root||!sheetWB)return;
  const ws=sheetWB.Sheets[sheetName];const range=XLSX.utils.decode_range(ws['!ref']||'A1:A10');
  let h='<table><thead><tr><th class="corner"></th>';
  for(let c=range.s.c;c<=Math.max(range.e.c,12);c++)h+='<th>'+XLSX.utils.encode_col(c)+'</th>';h+='</tr></thead><tbody>';
  const rows=Math.max(range.e.r+1,20),cols=Math.max(range.e.c+1,13);
  for(let r=0;r<rows;r++){h+='<tr><th class="rowhead">'+(r+1)+'</th>';for(let c=0;c<cols;c++){const a=XLSX.utils.encode_cell({r,c}),cell=ws[a]||{};const value=cell.f?'='+cell.f:(cell.v??'');h+='<td contenteditable="true" data-cell="'+a+'">'+esc(value)+'</td>';}h+='</tr>';}h+='</tbody></table>';
  root.innerHTML=h;
  root.querySelectorAll('td[data-cell]').forEach(td=>{td.addEventListener('focus',()=>{$('ot-formula').value=td.textContent||'';$('ot-cell-name').textContent=td.dataset.cell;});td.addEventListener('input',()=>{const a=td.dataset.cell;const v=td.textContent;const old=ws[a]||{};if(/^=/.test(v)){ws[a]={...old,f:v.slice(1),v:old.v??0,t:'n'};}else ws[a]={...old,v,t:typeof v==='number'?'n':'s'};ws['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(rows-1,0),c:Math.max(cols-1,0)}});markDirty();});});
  $('ot-sheet-name').textContent=sheetName;
}
function applyFormula(){const a=$('ot-cell-name').textContent,td=document.querySelector('#ot-sheet-grid td[data-cell="'+a+'"]');if(td){td.textContent=$('ot-formula').value;td.dispatchEvent(new Event('input'));}}
function addSheet(){const n=prompt('New sheet name','Sheet'+(sheetWB.SheetNames.length+1));if(!n)return;sheetWB.Sheets[n]=XLSX.utils.aoa_to_sheet([['',''],['','']]);sheetWB.SheetNames.push(n);sheetName=n;renderSheet();markDirty();}
function deleteSheet(){if(!sheetWB||sheetWB.SheetNames.length<2)return notify('Keep at least one sheet.');delete sheetWB.Sheets[sheetName];sheetWB.SheetNames=sheetWB.SheetNames.filter(x=>x!==sheetName);sheetName=sheetWB.SheetNames[0];renderSheet();markDirty();}
function renderDeck(){
  const root=$('ot-slides');if(!root)return;root.innerHTML='';
  deckSlides.forEach((s,i)=>{const card=document.createElement('article');card.className='ot-slide';card.dataset.i=i;card.innerHTML='<div class="ot-slide-head"><span>SLIDE '+(i+1)+'</span><div><button data-act="up">↑</button><button data-act="down">↓</button><button data-act="dup">⧉</button><button data-act="del">×</button></div></div><input class="ot-slide-title" value="'+esc(s.title)+'"><textarea class="ot-slide-body">'+esc(s.body)+'</textarea><input class="ot-slide-notes" placeholder="Speaker notes (optional)" value="'+esc(s.notes||'')+'">';
    card.querySelector('.ot-slide-title').oninput=e=>{s.title=e.target.value;markDirty();};card.querySelector('.ot-slide-body').oninput=e=>{s.body=e.target.value;markDirty();};card.querySelector('.ot-slide-notes').oninput=e=>{s.notes=e.target.value;markDirty();};
    card.querySelectorAll('button').forEach(b=>b.onclick=()=>{const a=b.dataset.act;if(a==='up'&&i>0)[deckSlides[i-1],deckSlides[i]]=[deckSlides[i],deckSlides[i-1]];if(a==='down'&&i<deckSlides.length-1)[deckSlides[i+1],deckSlides[i]]=[deckSlides[i],deckSlides[i+1]];if(a==='dup')deckSlides.splice(i+1,0,{...s,id:Date.now()});if(a==='del'&&deckSlides.length>1)deckSlides.splice(i,1);renderDeck();markDirty();});
    root.appendChild(card);});
}
function addSlide(){deckSlides.push({id:Date.now(),title:'New Slide',body:'Add your content here',notes:''});renderDeck();markDirty();}

async function buildPptx(slides){
  if(!window.JSZip)throw new Error('ZIP engine is not loaded.');
  const z=new JSZip();const escx=s=>esc(s).replace(/'/g,'&apos;');
  const now=new Date().toISOString();
  z.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'+slides.map((_,i)=>'<Override PartName="/ppt/slides/slide'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('')+'</Types>');
  z.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>');
  z.file('ppt/presentation.xml','<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst/><p:sldIdLst>'+slides.map((_,i)=>'<p:sldId id="'+(256+i)+'" r:id="rId'+(i+1)+'"/>').join('')+'</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
  z.file('ppt/_rels/presentation.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+slides.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide'+(i+1)+'.xml"/>').join('')+'</Relationships>');
  slides.forEach((s,i)=>{
    const paras=(s.body||'').split(/\n/).filter(x=>x.trim()).map(x=>'<a:p><a:r><a:rPr lang="en-US" sz="2200"/><a:t>'+escx(x)+'</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>').join('');
    const title='<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="700000" y="450000"/><a:ext cx="10800000" cy="1100000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" b="1" sz="3200"/><a:t>'+escx(s.title||'Slide')+'</a:t></a:r></a:p></p:txBody></p:sp>';
    const body='<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="850000" y="1800000"/><a:ext cx="10200000" cy="4100000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>'+paras+'</p:txBody></p:sp>';
    z.file('ppt/slides/slide'+(i+1)+'.xml','<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'+title+body+'</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
  });
  return z.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
}

function wire(){
  tabs.forEach(t=>$('ot-'+t)?.addEventListener('click',()=>setMode(t)));
  $('ot-open')?.addEventListener('click',()=>{$('ot-file').click();});
  $('ot-file')?.addEventListener('change',e=>openFile(e.target.files?.[0]));
  $('ot-new')?.addEventListener('click',()=>({word:newWord,excel:newExcel,powerpoint:newDeck,notepad:newNote}[mode]||newWord)());
  $('ot-save')?.addEventListener('click',()=>saveCurrent());
  $('ot-saveas')?.addEventListener('click',()=>{const n=prompt('Save as — include the extension you want',currentName);if(n)saveCurrent(n);});
  $('ot-print')?.addEventListener('click',()=>window.print());
  $('ot-add-slide')?.addEventListener('click',addSlide);
  $('ot-add-sheet')?.addEventListener('click',addSheet);$('ot-del-sheet')?.addEventListener('click',deleteSheet);$('ot-formula-apply')?.addEventListener('click',applyFormula);
  $('ot-note-editor')?.addEventListener('input',markDirty);
  $('ot-word-editor')?.addEventListener('input',markDirty);
  $('ot-bold')?.addEventListener('click',()=>exec('bold'));$('ot-italic')?.addEventListener('click',()=>exec('italic'));$('ot-underline')?.addEventListener('click',()=>exec('underline'));
  $('ot-ul')?.addEventListener('click',()=>exec('insertUnorderedList'));$('ot-ol')?.addEventListener('click',()=>exec('insertOrderedList'));
  $('ot-link')?.addEventListener('click',insertLink);$('ot-image')?.addEventListener('click',insertImage);
  $('ot-align-left')?.addEventListener('click',()=>exec('justifyLeft'));$('ot-align-center')?.addEventListener('click',()=>exec('justifyCenter'));$('ot-align-right')?.addEventListener('click',()=>exec('justifyRight'));
  $('ot-font')?.addEventListener('change',e=>exec('fontName',e.target.value));$('ot-size')?.addEventListener('change',e=>exec('fontSize',e.target.value));
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveCurrent();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();$('ot-file')?.click();}});
  setMode('word');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
window.REDMARK_OFFICE_TOOLS={openFile,saveCurrent};
})();