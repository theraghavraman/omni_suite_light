/* Redmark Forge — Office Studio: Find & Replace inside Office files (browser-only)
 *
 * Replaces text directly inside DOCX/DOCM/DOTX, PPTX/PPTM/PPSX/POTX, XLSX/XLSM/XLTX and
 * ODT/ODS/ODP packages without converting them, so fonts, styles, images, tables, macros and
 * layout are left untouched. Only the XML parts that actually change are rewritten.
 *
 * How formatting is kept: Office splits text into "runs" (Word may store "Hello" as "Hel"+"lo").
 * Each paragraph's runs are joined, matches are found across run boundaries, and the replacement
 * is written into the run where the match starts (so it takes that run's formatting); the rest of
 * the matched characters are removed from the following runs. Matches that would cross a tab,
 * line break or field are skipped and reported rather than guessed.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=(m,e=false)=>{try{if(typeof window.omniNotify==='function')return window.omniNotify(m,e);}catch(_){}(e?console.warn:console.log)('[Find & Replace] '+m);};
const ext=n=>{const m=/\.([^.\/\\]+)$/.exec(String(n||''));return m?m[1].toLowerCase():'';};
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB';
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
async function getZip(){if(window.JSZip)return window.JSZip;if(window.OMNI_VENDOR)return window.OMNI_VENDOR.load('jszip');throw new Error('JSZip is not loaded.');}

const NS={
  w:'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  a:'http://schemas.openxmlformats.org/drawingml/2006/main',
  x:'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  text:'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table:'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  office:'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  xml:'http://www.w3.org/XML/1998/namespace'
};
const FAMILY={docx:'word',docm:'word',dotx:'word',dotm:'word',pptx:'slides',pptm:'slides',ppsx:'slides',ppsm:'slides',potx:'slides',potm:'slides',xlsx:'sheet',xlsm:'sheet',xltx:'sheet',xltm:'sheet',odt:'odf',ott:'odf',ods:'odf',ots:'odf',odp:'odf',otp:'odf'};
const ACCEPT=Object.keys(FAMILY).map(e=>'.'+e).join(',');

/* ---------------------------------------------------------------- paragraph models
 * A "dialect" says which element is a paragraph, which nodes hold editable text, and which
 * nodes are fixed separators (tab, break) that a match may not cross. */
const DIALECTS={
  w:{para:[NS.w,'p'],text:[NS.w,'t'],virtual:{[NS.w]:{tab:'\t',br:'\n',cr:'\n',noBreakHyphen:'-',softHyphen:''}},skip:{[NS.w]:new Set(['instrText','delText','delInstrText','fldData'])}},
  a:{para:[NS.a,'p'],text:[NS.a,'t'],virtual:{[NS.a]:{br:'\n'}},skip:{}},
  x:{para:null,text:[NS.x,'t'],virtual:{},skip:{[NS.x]:new Set(['rPh','phoneticPr'])}},
  odf:{para:null,text:null,virtual:{[NS.text]:{tab:'\t','line-break':'\n'}},skip:{[NS.text]:new Set(['note','note-citation','bookmark-ref','sequence','change'])}}
};
function isPara(node,dialect){
  if(node.nodeType!==1)return false;
  if(dialect==='odf')return node.namespaceURI===NS.text&&(node.localName==='p'||node.localName==='h');
  const p=DIALECTS[dialect].para;return !!p&&node.namespaceURI===p[0]&&node.localName===p[1];
}
/* Collect the ordered text segments of one paragraph (nested paragraphs, e.g. text boxes, are excluded;
 * they are processed as paragraphs of their own). */
function segmentsOf(P,dialect){
  const D=DIALECTS[dialect];const segs=[];
  const walk=el=>{
    for(const c of el.childNodes){
      if(c.nodeType===3){if(dialect==='odf')segs.push({node:c,text:c.data,edit:true});continue;}
      if(c.nodeType!==1)continue;
      if(c!==P&&isPara(c,dialect))continue;
      /* ODF: only text-namespace elements (spans, links…) carry paragraph text; frames, annotations and SVG titles do not */
      if(dialect==='odf'&&c.namespaceURI!==NS.text)continue;
      if(D.skip[c.namespaceURI]?.has(c.localName))continue;
      if(D.text&&c.namespaceURI===D.text[0]&&c.localName===D.text[1]){segs.push({node:c,text:c.textContent,edit:true});continue;}
      if(dialect==='odf'&&c.namespaceURI===NS.text&&c.localName==='s'){segs.push({text:' '.repeat(+c.getAttributeNS(NS.text,'c')||1),edit:false});continue;}
      const v=D.virtual[c.namespaceURI];if(v&&c.localName in v){segs.push({text:v[c.localName],edit:false});continue;}
      walk(c);
    }
  };
  walk(P);return segs;
}

/* ---------------------------------------------------------------- matching */
function buildMatcher(rule,opts){
  if(!rule.find)return null;
  let src=opts.regex?rule.find:rule.find.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  let flags='g'+(opts.matchCase?'':'i');
  if(opts.wholeWord){
    try{return new RegExp('(?<![\\p{L}\\p{N}_])(?:'+src+')(?![\\p{L}\\p{N}_])',flags+'u');}
    catch(_){src='\\b(?:'+src+')\\b';}
  }
  return new RegExp(src,flags);
}
/* String.replace-style template expansion ($&, $1, $<name>, $$) for regex mode. */
function expand(tpl,m,full){
  return tpl.replace(/\$(\$|&|`|'|\d{1,2}|<([^>]+)>)/g,(t,k,name)=>{
    if(k==='$')return '$';if(k==='&')return m[0];if(k==='`')return full.slice(0,m.index);if(k==="'")return full.slice(m.index+m[0].length);
    if(name!=null)return m.groups&&m.groups[name]!=null?m.groups[name]:'';
    const n=+k;if(n>0&&n<m.length)return m[n]??'';if(k.length===2&&+k[0]>0&&+k[0]<m.length)return (m[+k[0]]??'')+k[1];return t;
  });
}
function matchCase(src,out){
  const letters=src.replace(/[^\p{L}]/gu,'');if(!letters)return out;
  if(letters===letters.toUpperCase()&&letters!==letters.toLowerCase()&&letters.length>1)return out.toUpperCase();
  if(letters===letters.toLowerCase()&&letters!==letters.toUpperCase())return out.toLowerCase();
  const f=src.match(/\p{L}/u)?.[0];
  if(f&&f===f.toUpperCase()&&f!==f.toLowerCase())return out.replace(/\p{L}/u,ch=>ch.toUpperCase());
  return out;
}
/* Apply all rules to one paragraph. Returns {count, skipped, samples}. Mutates segments in place. */
function replaceInSegments(segs,rules,opts,stats,where){
  let changed=false;
  rules.forEach((rule,ri)=>{
    const re=rule.re;if(!re)return;
    const full=segs.map(s=>s.text).join('');
    if(!full)return;
    re.lastIndex=0;const found=[];let m;
    while((m=re.exec(full))){
      if(m[0].length===0){re.lastIndex++;continue;}
      let out=opts.regex?expand(rule.replace,m,full):rule.replace;
      if(opts.preserveCase)out=matchCase(m[0],out);
      found.push({s:m.index,e:m.index+m[0].length,text:m[0],out});
    }
    if(!found.length)return;
    const offs=[];let acc=0;segs.forEach(s=>{offs.push(acc);acc+=s.text.length;});
    const segAt=pos=>{for(let i=0;i<segs.length;i++)if(pos>=offs[i]&&pos<offs[i]+segs[i].text.length)return i;return -1;};
    for(let k=found.length-1;k>=0;k--){
      const f=found[k];const i=segAt(f.s),j=segAt(f.e-1);
      const rs=stats.rules[ri];
      if(i<0||j<0||segs.slice(i,j+1).some(x=>!x.edit)){rs.skipped++;stats.skipped++;continue;}
      const si=segs[i];const a=f.s-offs[i];
      if(i===j){si.text=si.text.slice(0,a)+f.out+si.text.slice(f.e-offs[i]);}
      else{si.text=si.text.slice(0,a)+f.out;for(let q=i+1;q<j;q++)segs[q].text='';segs[j].text=segs[j].text.slice(f.e-offs[j]);}
      si.dirty=true;for(let q=i+1;q<=j;q++)segs[q].dirty=true;
      rs.count++;stats.count++;changed=true;
      if(stats.samples.length<200&&rs.samples<6){rs.samples++;const ctx=40;stats.samples.push({rule:ri,where,before:full.slice(Math.max(0,f.s-ctx),f.s),match:f.text,after:full.slice(f.e,f.e+ctx),out:f.out,cutL:f.s>ctx,cutR:f.e+ctx<full.length});}
    }
  });
  return changed;
}
function commitSegments(segs,dialect){
  for(const s of segs){
    if(!s.dirty||!s.node)continue;
    if(dialect==='odf'){s.node.data=s.text;continue;}
    s.node.textContent=s.text;
    if(/^\s|\s$/.test(s.text))s.node.setAttributeNS(NS.xml,'xml:space','preserve');
  }
}

/* ---------------------------------------------------------------- parts per format */
function partsFor(family,names,o){
  const has=re=>names.filter(n=>re.test(n));
  const charts=o.charts?has(/^(word|ppt|xl)\/(charts\/chart\d*\.xml|diagrams\/(data|drawing)\d*\.xml)$/):[];
  const props=o.props?has(/^docProps\/core\.xml$/):[];
  if(family==='word')return [...has(/^word\/document\.xml$/),...(o.headers?has(/^word\/(header\d*|footer\d*|footnotes|endnotes)\.xml$/):[]),...(o.comments?has(/^word\/comments\.xml$/):[]),...charts,...props];
  if(family==='slides')return [...has(/^ppt\/slides\/slide\d+\.xml$/),...(o.notes?has(/^ppt\/notesSlides\/notesSlide\d+\.xml$/):[]),...(o.masters?has(/^ppt\/(slideMasters|slideLayouts)\/slide(Master|Layout)\d+\.xml$/):[]),...charts,...props];
  if(family==='sheet')return [...has(/^xl\/sharedStrings\.xml$/),...has(/^xl\/worksheets\/sheet\d+\.xml$/),...(o.comments?has(/^xl\/comments\d*\.xml$/):[]),...has(/^xl\/tables\/table\d+\.xml$/),...charts,...props];
  if(family==='odf')return [...has(/^content\.xml$/),...(o.headers?has(/^styles\.xml$/):[]),...(o.props?has(/^meta\.xml$/):[])];
  return [];
}
function partLabel(name){
  let m;
  if(name==='word/document.xml')return 'Document body';
  if((m=/^word\/(header|footer)(\d*)\.xml$/.exec(name)))return (m[1]==='header'?'Header ':'Footer ')+(m[2]||'');
  if(/footnotes/.test(name))return 'Footnotes';if(/endnotes/.test(name))return 'Endnotes';if(/comments/.test(name))return 'Comments';
  if((m=/slides\/slide(\d+)/.exec(name)))return 'Slide '+m[1];if((m=/notesSlide(\d+)/.exec(name)))return 'Notes, slide '+m[1];
  if((m=/slideMaster(\d+)/.exec(name)))return 'Slide master '+m[1];if((m=/slideLayout(\d+)/.exec(name)))return 'Layout '+m[1];
  if(name==='xl/sharedStrings.xml')return 'Cell text (all sheets)';if((m=/worksheets\/sheet(\d+)/.exec(name)))return 'Sheet '+m[1]+' (inline text)';if((m=/tables\/table(\d+)/.exec(name)))return 'Table '+m[1]+' headers';
  if(/charts\//.test(name))return 'Chart text';if(/diagrams\//.test(name))return 'SmartArt';if(/docProps\/core|meta\.xml/.test(name))return 'Document properties';
  if(name==='content.xml')return 'Document content';if(name==='styles.xml')return 'Headers & footers';
  return name;
}
/* Paragraph enumerators for each part type. Each returns [{el, dialect}] or handles attributes itself. */
function paragraphsOf(doc,name,family){
  const out=[];const add=(list,d)=>{for(const el of list)out.push({el,dialect:d});};
  if(family==='odf'){
    for(const tag of ['p','h'])for(const p of doc.getElementsByTagNameNS(NS.text,tag)){
      const cell=p.closest&&findAncestor(p,NS.table,'table-cell');
      if(cell){const t=cell.getAttributeNS(NS.office,'value-type');if(t&&t!=='string')continue;}
      out.push({el:p,dialect:'odf'});
    }
    return out;
  }
  if(/^word\/(document|header|footer|footnotes|endnotes|comments)/.test(name)){add(doc.getElementsByTagNameNS(NS.w,'p'),'w');return out;}
  if(name==='xl/sharedStrings.xml'){add(doc.getElementsByTagNameNS(NS.x,'si'),'x');return out;}
  if(/^xl\/worksheets\//.test(name)){add(doc.getElementsByTagNameNS(NS.x,'is'),'x');return out;}
  if(/^xl\/comments/.test(name)){for(const c of doc.getElementsByTagNameNS(NS.x,'comment')){const t=c.getElementsByTagNameNS(NS.x,'text')[0];if(t)out.push({el:t,dialect:'x'});}return out;}
  add(doc.getElementsByTagNameNS(NS.a,'p'),'a');return out;
}
function findAncestor(n,ns,local){for(let p=n.parentNode;p&&p.nodeType===1;p=p.parentNode)if(p.namespaceURI===ns&&p.localName===local)return p;return null;}
/* Whole-string fields: table column names (must match their header cells) and document properties. */
function replaceWhole(str,rules,opts,stats,where){
  const segs=[{text:str,edit:true,node:null}];const changed=replaceInSegments(segs,rules,opts,stats,where);return changed?segs[0].text:null;
}

/* ---------------------------------------------------------------- package processing */
const XML_DECL=/^\s*<\?xml[^>]*\?>\s*/;
async function processFile(file,rules,opts,{write}){
  const e=ext(file.name);const family=FAMILY[e];
  const result={name:file.name,family,count:0,skipped:0,parts:[],samples:[],error:null,blob:null,rules:rules.map(()=>({count:0,skipped:0,samples:0}))};
  if(!family){result.error='Unsupported file type (.'+e+')';return result;}
  const JSZip=await getZip();let zip;
  try{zip=await JSZip.loadAsync(await file.arrayBuffer());}
  catch(_){result.error=/^(doc|xls|ppt)$/.test(e)?'Legacy binary format':'This file is not a valid Office package — it may be password-protected or damaged.';return result;}
  const names=Object.keys(zip.files).filter(n=>!zip.files[n].dir);
  const parts=partsFor(family,names,opts);
  if(!parts.length){result.error='No editable text parts found.';return result;}
  for(const name of parts){
    const xml=await zip.file(name).async('string');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length){result.parts.push({name,label:partLabel(name),count:0,error:'XML could not be parsed; left unchanged'});continue;}
    const where=partLabel(name);
    const before=result.count;let changed=false;
    const stats={count:0,skipped:0,samples:result.samples,rules:result.rules};
    if(/^xl\/tables\//.test(name)){
      for(const col of doc.getElementsByTagNameNS(NS.x,'tableColumn')){const v=replaceWhole(col.getAttribute('name')||'',rules,opts,{...stats,samples:[],rules:rules.map(()=>({count:0,skipped:0,samples:9}))},where);if(v!=null){col.setAttribute('name',v);changed=true;}}
    }else if(/docProps\/core\.xml$|^meta\.xml$/.test(name)){
      const fields=[...doc.documentElement.getElementsByTagName('*')].filter(el=>/^(title|subject|description|keywords|category)$/.test(el.localName)&&!el.children.length);
      for(const f of fields){const v=replaceWhole(f.textContent,rules,opts,stats,where);if(v!=null){f.textContent=v;changed=true;}}
    }else{
      for(const {el,dialect} of paragraphsOf(doc,name,family)){
        const segs=segmentsOf(el,dialect);if(!segs.length)continue;
        if(replaceInSegments(segs,rules,opts,stats,where)){commitSegments(segs,dialect);changed=true;}
      }
    }
    result.count+=stats.count;result.skipped+=stats.skipped;
    if(stats.count||stats.skipped)result.parts.push({name,label:where,count:stats.count,skipped:stats.skipped});
    if(changed&&write){
      const decl=(XML_DECL.exec(xml)||[''])[0].trim()||'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
      let out=new XMLSerializer().serializeToString(doc).replace(XML_DECL,'');
      out=decl+'\n'+out;
      if(new DOMParser().parseFromString(out,'application/xml').getElementsByTagName('parsererror').length){result.error='Internal check failed for '+name+'; the file was not changed.';return result;}
      zip.file(name,out);
    }
    void before;
  }
  if(write&&result.count){
    const mime=zip.file('mimetype')?(await zip.file('mimetype').async('string')).trim():({word:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',slides:'application/vnd.openxmlformats-officedocument.presentationml.presentation',sheet:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}[family]);
    if(zip.file('mimetype'))zip.file('mimetype',mime,{compression:'STORE'});
    result.blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6},mimeType:file.type||mime});
  }
  return result;
}

/* ---------------------------------------------------------------- UI */
const state={files:[],results:null};
function readRules(){
  return [...document.querySelectorAll('#ofrRules .ofr-rule')].map(r=>({find:r.querySelector('.ofr-find').value,replace:r.querySelector('.ofr-rep').value})).filter(r=>r.find!=='');
}
function readOpts(){
  const c=id=>!!$(id)?.checked;
  return {matchCase:c('ofrCase'),wholeWord:c('ofrWord'),regex:c('ofrRegex'),preserveCase:c('ofrPreserve'),headers:c('ofrHeaders'),notes:c('ofrNotes'),charts:c('ofrCharts'),comments:c('ofrComments'),masters:c('ofrMasters'),props:c('ofrProps')};
}
function compile(rules,opts){
  return rules.map((r,i)=>{try{return {...r,re:buildMatcher(r,opts)};}catch(e){throw new Error('Rule '+(i+1)+' is not a valid regular expression: '+e.message);}});
}
function addRule(find='',rep=''){
  const box=$('ofrRules');const row=document.createElement('div');row.className='ofr-rule';
  row.innerHTML='<input class="form-input ofr-find" placeholder="Find" aria-label="Find text" spellcheck="false"><span class="ofr-arrow" aria-hidden="true">→</span><input class="form-input ofr-rep" placeholder="Replace with (leave empty to delete)" aria-label="Replace with" spellcheck="false"><button type="button" class="btn-reset ofr-del" title="Remove rule" aria-label="Remove rule" data-action="remove-rule">×</button>';
  row.querySelector('.ofr-find').value=find;row.querySelector('.ofr-rep').value=rep;
  row.querySelector('.ofr-del').onclick=()=>{row.remove();if(!box.children.length)addRule();invalidate();};
  row.querySelectorAll('input').forEach(i=>i.addEventListener('input',invalidate));
  box.appendChild(row);return row;
}
function invalidate(){state.results=null;const r=$('ofrReport');if(r&&r.dataset.state==='done'){r.dataset.state='stale';r.querySelector('.ofr-stale')?.removeAttribute('hidden');}}
function parseDelimited(text){
  const rows=[];const delim=text.includes('\t')?'\t':',';let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=ch;}else if(ch==='"'&&f==='')q=true;else if(ch===delim){row.push(f);f='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f='';}else f+=ch;}
  if(f!==''||row.length){row.push(f);rows.push(row);}return rows.filter(r=>r.some(x=>x!==''));
}
function renderFiles(){
  const list=$('ofrFileList');const n=state.files.length;
  $('ofrControls').style.display=n?'':'none';
  list.innerHTML=state.files.map((f,i)=>{const fam=FAMILY[ext(f.name)];const icon={word:'📝',slides:'📽',sheet:'📊',odf:'📄'}[fam]||'❔';return '<li><span>'+icon+' <b>'+esc(f.name)+'</b> <small>'+fmtSize(f.size)+'</small></span><button type="button" class="btn-reset" data-i="'+i+'" data-action="remove-file" aria-label="Remove '+esc(f.name)+'">Remove</button></li>';}).join('');
  list.querySelectorAll('button').forEach(b=>b.onclick=()=>{state.files.splice(+b.dataset.i,1);renderFiles();invalidate();});
  $('ofrCount').textContent=n?n+' file'+(n===1?'':'s')+' selected':'';
}
function addFiles(files){
  const ok=[],bad=[];for(const f of files){if(FAMILY[ext(f.name)])ok.push(f);else bad.push(f.name);}
  ok.forEach(f=>{if(!state.files.some(x=>x.name===f.name&&x.size===f.size))state.files.push(f);});
  if(bad.length)notify('Skipped '+bad.length+' unsupported file(s): '+bad.slice(0,3).join(', ')+(bad.some(n=>/\.(doc|xls|ppt)$/i.test(n))?' — legacy DOC/XLS/PPT must be converted to DOCX/XLSX/PPTX first (Office Format Converter above).':''),true);
  renderFiles();invalidate();
}
function renderReport(results,rules,mode){
  const box=$('ofrReport');const total=results.reduce((a,r)=>a+r.count,0),skipped=results.reduce((a,r)=>a+r.skipped,0);
  const errs=results.filter(r=>r.error);
  let h='<div class="ofr-summary"><b>'+total.toLocaleString()+'</b> '+(mode==='write'?'replacement'+(total===1?'':'s')+' made':'match'+(total===1?'':'es')+' found')+' in '+results.filter(r=>r.count).length+' of '+results.length+' file'+(results.length===1?'':'s')+'.'+(skipped?' <span class="ofr-warn">'+skipped+' skipped because they cross a tab, line break or field.</span>':'')+'<span class="ofr-stale" hidden> Rules or options changed — scan again.</span></div>';
  if(rules.length>1)h+='<div class="ofr-rulecounts">'+rules.map((r,i)=>{const c=results.reduce((a,x)=>a+x.rules[i].count,0);return '<span><code>'+esc(r.find)+'</code> '+c+'</span>';}).join('')+'</div>';
  results.forEach(r=>{
    h+='<details class="ofr-file"'+(results.length<=3?' open':'')+'><summary><b>'+esc(r.name)+'</b> — '+(r.error?'<span class="ofr-err">'+esc(r.error)+'</span>':r.count+' '+(mode==='write'?'replaced':'found')+(r.skipped?', '+r.skipped+' skipped':''))+'</summary>';
    if(r.parts.length)h+='<ul class="ofr-parts">'+r.parts.map(p=>'<li>'+esc(p.label)+': '+(p.error?'<span class="ofr-err">'+esc(p.error)+'</span>':p.count+(p.skipped?' (+'+p.skipped+' skipped)':''))+'</li>').join('')+'</ul>';
    if(r.samples.length)h+='<ol class="ofr-samples">'+r.samples.slice(0,12).map(s=>'<li><span class="ofr-where">'+esc(s.where)+'</span> '+(s.cutL?'…':'')+esc(s.before)+'<del>'+esc(s.match)+'</del><ins>'+esc(s.out)+'</ins>'+esc(s.after)+(s.cutR?'…':'')+'</li>').join('')+'</ol>';
    h+='</details>';
  });
  if(errs.length&&mode==='write')h+='<div class="ofr-err">'+errs.length+' file(s) could not be processed and were not included.</div>';
  box.innerHTML=h;box.style.display='';box.dataset.state='done';
}
async function run(mode){
  if(!state.files.length)return notify('Add at least one Office file first.',true);
  const raw=readRules();if(!raw.length)return notify('Enter the text to find.',true);
  const opts=readOpts();let rules;
  try{rules=compile(raw,opts);}catch(e){return notify(e.message,true);}
  const btn=$(mode==='write'?'ofrReplace':'ofrScan');const label=btn.textContent;btn.disabled=true;
  const prog=$('ofrProgress');prog.style.display='';
  try{
    const results=[];
    for(let i=0;i<state.files.length;i++){
      const f=state.files[i];prog.textContent=(mode==='write'?'Replacing in ':'Scanning ')+f.name+' ('+(i+1)+'/'+state.files.length+')…';btn.textContent=prog.textContent;
      try{results.push(await processFile(f,rules,opts,{write:mode==='write'}));}
      catch(err){console.error(err);results.push({name:f.name,count:0,skipped:0,parts:[],samples:[],error:err.message||String(err),rules:rules.map(()=>({count:0}))});}
    }
    state.results=results;renderReport(results,raw,mode);
    if(mode==='write'){
      const changed=results.filter(r=>r.blob);
      if(!changed.length){notify('No matches — no files were changed.',true);return;}
      if(changed.length===1&&!$('ofrZip').checked){download(changed[0].blob,changed[0].name);}
      else{const JSZip=await getZip();const z=new JSZip();const used=new Set();changed.forEach(r=>{let n=r.name;let k=2;while(used.has(n.toLowerCase())){n=r.name.replace(/(\.[^.]+)$/,' ('+(k++)+')$1');}used.add(n.toLowerCase());z.file(n,r.blob);});download(await z.generateAsync({type:'blob'}),'find-replace-results.zip');}
      notify('Replaced '+results.reduce((a,r)=>a+r.count,0)+' occurrence(s) in '+changed.length+' file(s). Originals are unchanged.');
    }else{
      const t=results.reduce((a,r)=>a+r.count,0);notify(t?'Found '+t+' match(es). Review them, then choose Replace & download.':'No matches found.',!t);
    }
  }finally{btn.disabled=false;btn.textContent=label;prog.style.display='none';}
}
function wire(){
  const input=$('ofrInput');if(!input||input.dataset.ofrWired)return;input.dataset.ofrWired='1';
  input.accept=ACCEPT;
  input.addEventListener('change',()=>{addFiles([...(input.files||[])]);input.value='';});
  const drop=$('ofrDrop');
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
  drop.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();drop.classList.remove('dragover');addFiles([...(e.dataTransfer?.files||[])]);});
  $('ofrAddRule').onclick=()=>addRule().querySelector('.ofr-find').focus();
  $('ofrReset').onclick=()=>{state.files=[];state.results=null;$('ofrReport').style.display='none';renderFiles();};
  $('ofrScan').onclick=()=>run('scan');$('ofrReplace').onclick=()=>run('write');
  $('ofrImport').onclick=()=>$('ofrRulesFile').click();
  $('ofrRulesFile').addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;let rows=parseDelimited(await f.text());if(rows.length&&/^(find|search|old)/i.test(rows[0][0]||'')&&/^(replace|new|with)/i.test(rows[0][1]||''))rows=rows.slice(1);rows=rows.filter(r=>(r[0]||'')!=='');if(!rows.length)return notify('No rules found. Use two columns: find, replace.',true);$('ofrRules').innerHTML='';rows.forEach(r=>addRule(r[0],r[1]??''));invalidate();notify('Loaded '+rows.length+' rule(s) from '+f.name+'.');});
  $('ofrExport').onclick=()=>{const rules=readRules();if(!rules.length)return notify('There are no rules to export.',true);const q=s=>/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;download(new Blob(['﻿find,replace\n'+rules.map(r=>q(r.find)+','+q(r.replace)).join('\n')+'\n'],{type:'text/csv;charset=utf-8'}),'find-replace-rules.csv');};
  ['ofrCase','ofrWord','ofrRegex','ofrPreserve','ofrHeaders','ofrNotes','ofrCharts','ofrComments','ofrMasters','ofrProps'].forEach(id=>$(id)?.addEventListener('change',invalidate));
  $('ofrRegex').addEventListener('change',()=>{$('ofrRegexHint').hidden=!$('ofrRegex').checked;});
  addRule();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
window.OMNI_FIND_REPLACE={processFile,buildMatcher,addFiles,run,_test:{segmentsOf,replaceInSegments,expand,matchCase,partsFor}};
})();
