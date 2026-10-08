/* Omni Suite — browser document engine for Office Studio.
 * Reads DOCX, ODT, RTF, Markdown, HTML, TXT and PowerPoint text into one document model,
 * and writes PDF (Unicode, embedded Noto/Roboto fonts), DOCX, ODT, HTML, Markdown and TXT.
 * Spreadsheet conversions keep every sheet. Local Engine (LibreOffice) is still used for
 * formats the browser cannot produce faithfully.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'document').replace(/\.[^.]+$/,'')||'document';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const notify=(m,err)=>{if(window.omniNotify)window.omniNotify(m,err);};
const xmlEsc=s=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('Could not load '+src.split('/').slice(-1)[0]+' — check your internet connection.'));document.head.appendChild(s);});}

/* ================= document model =================
 * {title, blocks:[ {type:'heading',level,runs} | {type:'para',runs} | {type:'list',ordered,items:[{level,runs}]}
 *                  | {type:'table',rows:[[cellText]],header:bool} | {type:'code',text} | {type:'pagebreak'}
 *                  | {type:'image',bytes,mime,width,height} | {type:'slide',title,items:[{level,text}]} ]}
 * runs: [{text,bold,italic,code}]
 */
const runsText=r=>(r||[]).map(x=>x.text).join('');
const plainRuns=t=>[{text:String(t??'')}];

/* ---------- inline markdown ---------- */
function mdInline(s){
  const out=[];const re=/(\*\*\*|___)(.+?)\1|(\*\*|__)(.+?)\3|(\*|_)(?!\s)(.+?)(?<!\s)\5|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;let last=0,m;
  while((m=re.exec(s))){if(m.index>last)out.push({text:s.slice(last,m.index)});
    if(m[2])out.push({text:m[2],bold:true,italic:true});else if(m[4])out.push({text:m[4],bold:true});else if(m[6])out.push({text:m[6],italic:true});else if(m[7])out.push({text:m[7],code:true});else if(m[8])out.push({text:m[8]+' ('+m[9]+')'});
    last=re.lastIndex;}
  if(last<s.length)out.push({text:s.slice(last)});return out.length?out:[{text:''}];
}
function readMarkdown(text,{headings=true}={}){
  const lines=String(text).replace(/\r/g,'').split('\n'),blocks=[];let i=0,para=[];
  const flush=()=>{if(para.length){blocks.push({type:'para',runs:mdInline(para.join(' '))});para=[];}};
  while(i<lines.length){const l=lines[i];let m;
    if(!l.trim()){flush();i++;continue;}
    if(/^```/.test(l)){flush();const code=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i++]);i++;blocks.push({type:'code',text:code.join('\n')});continue;}
    if(headings&&(m=l.match(/^(#{1,6})\s+(.*)$/))){flush();blocks.push({type:'heading',level:m[1].length,runs:mdInline(m[2].replace(/\s+#+\s*$/,''))});i++;continue;}
    if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)){flush();i++;continue;}
    if(/^\s*\|.*\|\s*$/.test(l)&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}/.test(lines[i+1])){flush();const rows=[];const cells=x=>x.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());rows.push(cells(l));i+=2;while(i<lines.length&&/^\s*\|.*\|\s*$/.test(lines[i]))rows.push(cells(lines[i++]));blocks.push({type:'table',rows,header:true});continue;}
    if((m=l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))){flush();const ordered=/\d/.test(m[2]);const items=[];
      while(i<lines.length&&(m=lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))&&(/\d/.test(m[2])===ordered||m[1].length>0)){items.push({level:Math.min(4,Math.floor(m[1].replace(/\t/g,'    ').length/2)),runs:mdInline(m[3])});i++;}
      blocks.push({type:'list',ordered,items});continue;}
    if((m=l.match(/^>\s?(.*)$/))){flush();blocks.push({type:'para',runs:mdInline(m[1]).map(r=>({...r,italic:true}))});i++;continue;}
    para.push(l.trim());i++;}
  flush();return blocks;
}
function readPlain(text){return String(text).replace(/\r/g,'').split(/\n{2,}/).map(p=>p.trim()).filter(Boolean).map(p=>({type:'para',runs:plainRuns(p.replace(/\n/g,' '))}));}

/* ---------- HTML ---------- */
function readHtml(html){
  const doc=new DOMParser().parseFromString(html,'text/html');const blocks=[];
  const inline=(node,st={})=>{const out=[];node.childNodes.forEach(n=>{if(n.nodeType===3){const t=n.textContent.replace(/\s+/g,' ');if(t)out.push({text:t,...st});}else if(n.nodeType===1){const tg=n.tagName;if(tg==='BR'){out.push({text:'\n'});return;}const s={...st};if(/^(B|STRONG)$/.test(tg))s.bold=true;if(/^(I|EM)$/.test(tg))s.italic=true;if(tg==='CODE')s.code=true;out.push(...inline(n,s));}});return out;};
  const walk=el=>{el.childNodes.forEach(n=>{if(n.nodeType===3){const t=n.textContent.trim();if(t)blocks.push({type:'para',runs:plainRuns(t)});return;}if(n.nodeType!==1)return;const tg=n.tagName;let m;
    if((m=tg.match(/^H([1-6])$/)))blocks.push({type:'heading',level:+m[1],runs:inline(n)});
    else if(tg==='P'||tg==='BLOCKQUOTE'||tg==='FIGCAPTION'){const r=inline(n);if(runsText(r).trim())blocks.push({type:'para',runs:r});n.querySelectorAll('img,image').forEach(im=>{const src=im.getAttribute('src')||im.getAttribute('xlink:href')||im.getAttribute('href');if(src)blocks.push({type:'image',src,alt:im.getAttribute('alt')||''});});}
    else if(tg==='IMG'||tg==='image'||tg==='IMAGE'){const src=n.getAttribute('src')||n.getAttribute('xlink:href')||n.getAttribute('href');if(src)blocks.push({type:'image',src,alt:n.getAttribute('alt')||''});}
    else if(tg==='UL'||tg==='OL'){const items=[];const li=(list,level)=>list.querySelectorAll(':scope > li').forEach(x=>{const c=x.cloneNode(true);c.querySelectorAll('ul,ol').forEach(y=>y.remove());items.push({level,runs:inline(c)});x.querySelectorAll(':scope > ul, :scope > ol').forEach(y=>li(y,level+1));});li(n,0);blocks.push({type:'list',ordered:tg==='OL',items});}
    else if(tg==='TABLE'){const rows=[...n.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()));if(rows.length)blocks.push({type:'table',rows,header:!!n.querySelector('th')});}
    else if(tg==='PRE')blocks.push({type:'code',text:n.textContent.replace(/\n$/,'')});
    else if(tg==='HR'){}
    else if(/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(tg)){}
    else walk(n);});};
  walk(doc.body||doc.documentElement);
  return {title:doc.title||'',blocks};
}

/* ---------- RTF (basic: paragraphs, bold/italic) ---------- */
function readRtf(rtf){
  let s=String(rtf);const blocks=[];let runs=[],cur='',bold=false,italic=false;const stack=[];let i=0,skip=0;
  const push=()=>{if(cur){runs.push({text:cur,bold,italic});cur='';}};const endPara=()=>{push();if(runsText(runs).trim())blocks.push({type:'para',runs});runs=[];};
  while(i<s.length){const c=s[i];
    if(c==='{'){stack.push({bold,italic,skip});i++;const m=s.slice(i).match(/^\\\*|^\\(fonttbl|colortbl|stylesheet|info|pict|header|footer|generator)\b/);if(m)skip++;continue;}
    if(c==='}'){push();const st=stack.pop()||{};bold=st.bold;italic=st.italic;skip=st.skip||0;i++;continue;}
    if(c==='\\'){const m=s.slice(i).match(/^\\([a-z]+)(-?\d+)? ?|^\\'([0-9a-f]{2})|^\\(.)/i);if(!m){i++;continue;}i+=m[0].length;if(skip)continue;
      if(m[3]){cur+=String.fromCharCode(parseInt(m[3],16));continue;}
      if(m[4]){if('\\{}'.includes(m[4]))cur+=m[4];continue;}
      const w=m[1],n=m[2];if(w==='par'||w==='line')endPara();else if(w==='tab')cur+='\t';else if(w==='b'){push();bold=n!=='0';}else if(w==='i'){push();italic=n!=='0';}else if(w==='u'&&n){cur+=String.fromCharCode((+n+65536)%65536);if(s[i]==='?')i++;}
      continue;}
    if(c==='\n'||c==='\r'){i++;continue;}
    if(!skip)cur+=c;i++;}
  endPara();return blocks;
}

/* ---------- DOCX ---------- */
async function readDocx(file){
  const z=await JSZip.loadAsync(await file.arrayBuffer());const docXml=z.file('word/document.xml');if(!docXml)throw new Error('This file is not a valid DOCX (word/document.xml missing).');
  const P=s=>new DOMParser().parseFromString(s,'application/xml');const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc=P(await docXml.async('text'));const attr=(el,name)=>el?.getAttributeNS(W,name)??el?.getAttribute('w:'+name);
  const styleName={};const stylesXml=z.file('word/styles.xml');if(stylesXml){const st=P(await stylesXml.async('text')).getElementsByTagNameNS(W,'style');for(const s of st){const id=attr(s,'styleId'),nm=s.getElementsByTagNameNS(W,'name')[0];if(id)styleName[id]=(attr(nm,'val')||id).toLowerCase();}}
  const numFmt={};const numXml=z.file('word/numbering.xml');if(numXml){const nd=P(await numXml.async('text'));const abs={};for(const a of nd.getElementsByTagNameNS(W,'abstractNum')){const lv=a.getElementsByTagNameNS(W,'lvl')[0];const f=lv&&lv.getElementsByTagNameNS(W,'numFmt')[0];abs[attr(a,'abstractNumId')]=attr(f,'val')||'bullet';}for(const n of nd.getElementsByTagNameNS(W,'num')){const a=n.getElementsByTagNameNS(W,'abstractNumId')[0];numFmt[attr(n,'numId')]=abs[attr(a,'val')]||'bullet';}}
  const on=el=>el&&!/^(0|false|off)$/i.test(attr(el,'val')||'true');
  const runsOf=p=>{const out=[];const visit=n=>{for(const c of n.children){const ln=c.localName;if(ln==='r'){const rp=c.getElementsByTagNameNS(W,'rPr')[0];const b=rp&&on(rp.getElementsByTagNameNS(W,'b')[0]),it=rp&&on(rp.getElementsByTagNameNS(W,'i')[0]);for(const x of c.children){if(x.localName==='t')out.push({text:x.textContent,bold:!!b,italic:!!it});else if(x.localName==='tab')out.push({text:'\t'});else if(x.localName==='br'&&attr(x,'type')!=='page')out.push({text:'\n'});}}else if(ln==='hyperlink'||ln==='smartTag'||ln==='ins'||ln==='sdt'||ln==='sdtContent'||ln==='fldSimple')visit(c);}};visit(p);return out;};
  const pageBreak=p=>[...p.getElementsByTagNameNS(W,'br')].some(b=>attr(b,'type')==='page');
  const blocks=[];let list=null;
  const body=doc.getElementsByTagNameNS(W,'body')[0];
  const handleP=p=>{const pPr=p.getElementsByTagNameNS(W,'pPr')[0];const sid=attr(pPr?.getElementsByTagNameNS(W,'pStyle')[0],'val')||'';const sname=styleName[sid]||sid.toLowerCase();
    const numPr=pPr?.getElementsByTagNameNS(W,'numPr')[0];const runs=runsOf(p);const text=runsText(runs);
    if(pageBreak(p)&&!text.trim()){list=null;blocks.push({type:'pagebreak'});return;}
    let m;const hl=(m=sname.match(/^heading\s*([1-6])$/))?+m[1]:/^title$/.test(sname)?1:/^subtitle$/.test(sname)?2:0;
    if(hl&&text.trim()){list=null;blocks.push({type:'heading',level:hl,runs});return;}
    if(numPr||/list (bullet|number)/.test(sname)){const lvl=+attr(numPr?.getElementsByTagNameNS(W,'ilvl')[0],'val')||0;const fmt=numFmt[attr(numPr?.getElementsByTagNameNS(W,'numId')[0],'val')]||(/number/.test(sname)?'decimal':'bullet');const ordered=fmt!=='bullet'&&fmt!=='none';
      if(!list||list.ordered!==ordered){list={type:'list',ordered,items:[]};blocks.push(list);}list.items.push({level:lvl,runs});return;}
    list=null;if(text.trim())blocks.push({type:'para',runs});if(pageBreak(p))blocks.push({type:'pagebreak'});};
  for(const el of body.children){if(el.localName==='p')handleP(el);else if(el.localName==='tbl'){list=null;const rows=[...el.getElementsByTagNameNS(W,'tr')].map(tr=>[...tr.children].filter(c=>c.localName==='tc').map(tc=>[...tc.getElementsByTagNameNS(W,'p')].map(p=>runsText(runsOf(p))).join('\n').trim()));if(rows.length)blocks.push({type:'table',rows,header:true});}else if(el.localName==='sdt'){for(const p of el.getElementsByTagNameNS(W,'p'))handleP(p);}}
  let title='';try{const core=z.file('docProps/core.xml');if(core)title=(P(await core.async('text')).getElementsByTagName('dc:title')[0]?.textContent||'').trim();}catch(_){}
  return {title,blocks};
}

/* ---------- ODT / FODT ---------- */
async function readOdt(file){
  let xml;if(ext(file.name)==='fodt')xml=await file.text();else{const z=await JSZip.loadAsync(await file.arrayBuffer());const c=z.file('content.xml');if(!c)throw new Error('This file is not a valid ODT (content.xml missing).');xml=await c.async('text');}
  const doc=new DOMParser().parseFromString(xml,'application/xml');const T='urn:oasis:names:tc:opendocument:xmlns:text:1.0',TB='urn:oasis:names:tc:opendocument:xmlns:table:1.0',S='urn:oasis:names:tc:opendocument:xmlns:style:1.0',FO='urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
  const bold=new Set(),ital=new Set();for(const s of doc.getElementsByTagNameNS(S,'style')){const tp=s.getElementsByTagNameNS(S,'text-properties')[0];const n=s.getAttributeNS(S,'name');if(tp?.getAttributeNS(FO,'font-weight')==='bold')bold.add(n);if(tp?.getAttributeNS(FO,'font-style')==='italic')ital.add(n);}
  const runsOf=el=>{const out=[];const visit=(n,st)=>{n.childNodes.forEach(c=>{if(c.nodeType===3)out.push({text:c.textContent,...st});else if(c.nodeType===1){if(c.localName==='s')out.push({text:' '.repeat(+c.getAttributeNS(T,'c')||1)});else if(c.localName==='tab')out.push({text:'\t'});else if(c.localName==='line-break')out.push({text:'\n'});else{const sn=c.getAttributeNS(T,'style-name');visit(c,{...st,bold:st.bold||bold.has(sn),italic:st.italic||ital.has(sn)});}}});};visit(el,{});return out;};
  const blocks=[];const office=doc.getElementsByTagNameNS('urn:oasis:names:tc:opendocument:xmlns:office:1.0','text')[0];
  const walk=(el,level)=>{for(const c of el.children){if(c.namespaceURI===T&&c.localName==='h')blocks.push({type:'heading',level:Math.min(6,+c.getAttributeNS(T,'outline-level')||1),runs:runsOf(c)});
    else if(c.namespaceURI===T&&c.localName==='p'){const r=runsOf(c);if(runsText(r).trim())blocks.push({type:'para',runs:r});}
    else if(c.namespaceURI===T&&c.localName==='list'){const items=[];const li=(l,lv)=>{for(const it of l.children){if(it.localName!=='list-item')continue;for(const x of it.children){if(x.localName==='p'||x.localName==='h')items.push({level:lv,runs:runsOf(x)});else if(x.localName==='list')li(x,lv+1);}}};li(c,0);blocks.push({type:'list',ordered:false,items});}
    else if(c.namespaceURI===TB&&c.localName==='table'){const rows=[...c.getElementsByTagNameNS(TB,'table-row')].map(r=>[...r.children].filter(x=>x.localName==='table-cell').map(x=>x.textContent.trim()));blocks.push({type:'table',rows,header:true});}
    else if(c.namespaceURI===T&&(c.localName==='section'||c.localName==='soft-page-break'))walk(c,level);}};
  if(office)walk(office,0);return {title:'',blocks};
}

/* ---------- PowerPoint (text) ---------- */
async function readPptx(file){
  const z=await JSZip.loadAsync(await file.arrayBuffer());const P=s=>new DOMParser().parseFromString(s,'application/xml');
  const A='http://schemas.openxmlformats.org/drawingml/2006/main',PN='http://schemas.openxmlformats.org/presentationml/2006/main';
  let order=[];try{const pres=P(await z.file('ppt/presentation.xml').async('text'));const rels=P(await z.file('ppt/_rels/presentation.xml.rels').async('text'));const map={};for(const r of rels.getElementsByTagName('Relationship'))map[r.getAttribute('Id')]=r.getAttribute('Target');for(const s of pres.getElementsByTagNameNS(PN,'sldId')){const id=s.getAttribute('r:id')||s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');if(map[id])order.push('ppt/'+map[id].replace(/^\.?\//,''));}}catch(_){}
  if(!order.length)order=Object.keys(z.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>+a.match(/\d+/)[0]-+b.match(/\d+/)[0]);
  const blocks=[];
  for(const path of order){const f=z.file(path);if(!f)continue;const d=P(await f.async('text'));let title='';const items=[];
    for(const sp of d.getElementsByTagNameNS(PN,'sp')){const ph=sp.getElementsByTagNameNS(PN,'ph')[0];const type=ph?.getAttribute('type')||'';const paras=[...sp.getElementsByTagNameNS(A,'p')].map(p=>({level:+(p.getElementsByTagNameNS(A,'pPr')[0]?.getAttribute('lvl')||0),text:[...p.getElementsByTagNameNS(A,'t')].map(t=>t.textContent).join('')})).filter(x=>x.text.trim());
      if(/title/i.test(type)&&!title)title=paras.map(x=>x.text).join(' ');else items.push(...paras);}
    for(const tbl of d.getElementsByTagNameNS(A,'tbl')){for(const tr of tbl.getElementsByTagNameNS(A,'tr'))items.push({level:0,text:[...tr.getElementsByTagNameNS(A,'tc')].map(tc=>tc.textContent.trim()).join('  |  ')});}
    blocks.push({type:'slide',title,items});}
  return {title:'',blocks};
}

async function readDocument(file){
  const e=ext(file.name);
  if(['docx','docm','dotx','dotm'].includes(e))return readDocx(file);
  if(['odt','ott','fodt'].includes(e))return readOdt(file);
  if(e==='md'||e==='markdown')return {title:'',blocks:readMarkdown(await file.text())};
  if(e==='html'||e==='htm'||e==='xhtml')return readHtml(await file.text());
  if(e==='rtf')return {title:'',blocks:readRtf(await file.text())};
  if(e==='txt'||e==='text')return {title:'',blocks:readPlain(await file.text())};
  if(['pptx','pptm','ppsx','potx'].includes(e))return readPptx(file);
  return null;
}
const DOC_INPUTS=new Set(['docx','docm','dotx','dotm','odt','ott','fodt','md','markdown','html','htm','xhtml','rtf','txt','text']);

/* ================= PDF writer (Unicode) ================= */
const FONT_CDN='https://cdn.jsdelivr.net/npm/@expo-google-fonts/';
const FONTS={
  latn:{r:'roboto@0.4.3/400Regular/Roboto_400Regular.ttf',b:'roboto@0.4.3/700Bold/Roboto_700Bold.ttf',i:'roboto@0.4.3/400Regular_Italic/Roboto_400Regular_Italic.ttf',bi:'roboto@0.4.3/700Bold_Italic/Roboto_700Bold_Italic.ttf'},
  mono:{r:'roboto-mono@0.4.2/400Regular/RobotoMono_400Regular.ttf',b:'roboto-mono@0.4.2/700Bold/RobotoMono_700Bold.ttf'},
  deva:{r:'noto-sans-devanagari@0.4.1/400Regular/NotoSansDevanagari_400Regular.ttf',b:'noto-sans-devanagari@0.4.1/700Bold/NotoSansDevanagari_700Bold.ttf'},
  beng:{r:'noto-sans-bengali@0.4.4/400Regular/NotoSansBengali_400Regular.ttf',b:'noto-sans-bengali@0.4.4/700Bold/NotoSansBengali_700Bold.ttf'},
  guru:{r:'noto-sans-gurmukhi@0.4.1/400Regular/NotoSansGurmukhi_400Regular.ttf',b:'noto-sans-gurmukhi@0.4.1/700Bold/NotoSansGurmukhi_700Bold.ttf'},
  gujr:{r:'noto-sans-gujarati@0.4.2/400Regular/NotoSansGujarati_400Regular.ttf',b:'noto-sans-gujarati@0.4.2/700Bold/NotoSansGujarati_700Bold.ttf'},
  orya:{r:'noto-sans-oriya@0.4.2/400Regular/NotoSansOriya_400Regular.ttf',b:'noto-sans-oriya@0.4.2/700Bold/NotoSansOriya_700Bold.ttf'},
  taml:{r:'noto-sans-tamil@0.4.3/400Regular/NotoSansTamil_400Regular.ttf',b:'noto-sans-tamil@0.4.3/700Bold/NotoSansTamil_700Bold.ttf'},
  telu:{r:'noto-sans-telugu@0.4.2/400Regular/NotoSansTelugu_400Regular.ttf',b:'noto-sans-telugu@0.4.2/700Bold/NotoSansTelugu_700Bold.ttf'},
  knda:{r:'noto-sans-kannada@0.4.3/400Regular/NotoSansKannada_400Regular.ttf',b:'noto-sans-kannada@0.4.3/700Bold/NotoSansKannada_700Bold.ttf'},
  mlym:{r:'noto-sans-malayalam@0.4.2/400Regular/NotoSansMalayalam_400Regular.ttf',b:'noto-sans-malayalam@0.4.2/700Bold/NotoSansMalayalam_700Bold.ttf'},
};
const SCRIPT_RANGES=[[0x0900,0x097F,'deva'],[0xA8E0,0xA8FF,'deva'],[0x0980,0x09FF,'beng'],[0x0A00,0x0A7F,'guru'],[0x0A80,0x0AFF,'gujr'],[0x0B00,0x0B7F,'orya'],[0x0B80,0x0BFF,'taml'],[0x0C00,0x0C7F,'telu'],[0x0C80,0x0CFF,'knda'],[0x0D00,0x0D7F,'mlym'],[0x0590,0x05FF,'hebr'],[0x0600,0x06FF,'arab'],[0x0750,0x077F,'arab'],[0x08A0,0x08FF,'arab'],[0xFB50,0xFDFF,'arab'],[0xFE70,0xFEFF,'arab'],[0x2E80,0x2FDF,'cjk'],[0x3000,0x30FF,'cjk'],[0x3100,0x31FF,'cjk'],[0x3400,0x4DBF,'cjk'],[0x4E00,0x9FFF,'cjk'],[0xAC00,0xD7AF,'cjk'],[0xF900,0xFAFF,'cjk'],[0xFF00,0xFFEF,'cjk'],[0x1F000,0x1FAFF,'emoji'],[0x2600,0x27BF,'emoji']];
// pdf-lib ignores GPOS mark positioning, so these scripts are drawn by the browser's shaper (HarfBuzz) onto a canvas.
const RASTER=new Set(['beng','guru','telu','mlym','arab','hebr','cjk','emoji']);const RTL=new Set(['arab','hebr']);
const CANVAS_FONTS={beng:['OmniNotoBengali','noto-sans-bengali@0.4.4/400Regular/NotoSansBengali_400Regular.ttf','noto-sans-bengali@0.4.4/700Bold/NotoSansBengali_700Bold.ttf'],guru:['OmniNotoGurmukhi','noto-sans-gurmukhi@0.4.1/400Regular/NotoSansGurmukhi_400Regular.ttf','noto-sans-gurmukhi@0.4.1/700Bold/NotoSansGurmukhi_700Bold.ttf'],telu:['OmniNotoTelugu','noto-sans-telugu@0.4.2/400Regular/NotoSansTelugu_400Regular.ttf','noto-sans-telugu@0.4.2/700Bold/NotoSansTelugu_700Bold.ttf'],mlym:['OmniNotoMalayalam','noto-sans-malayalam@0.4.2/400Regular/NotoSansMalayalam_400Regular.ttf','noto-sans-malayalam@0.4.2/700Bold/NotoSansMalayalam_700Bold.ttf'],arab:['OmniNotoNaskh','noto-naskh-arabic@0.4.5/400Regular/NotoNaskhArabic_400Regular.ttf','noto-naskh-arabic@0.4.5/700Bold/NotoNaskhArabic_700Bold.ttf']};
const faceLoads={};
async function canvasFont(script){const f=CANVAS_FONTS[script];if(!f||!window.FontFace)return null;if(!faceLoads[script])faceLoads[script]=(async()=>{const faces=[new FontFace(f[0],'url('+FONT_CDN+f[1]+')',{weight:'400'}),new FontFace(f[0],'url('+FONT_CDN+f[2]+')',{weight:'700'})];for(const x of faces){await x.load();document.fonts.add(x);}return f[0];})().catch(e=>{console.warn('Canvas font failed',script,e);return null;});return faceLoads[script];}
const K=4;let mctx=null;
async function cssFont(script,style,size){const fam=await canvasFont(script);const w=style==='b'||style==='bi'?'700':'400',it=style==='i'||style==='bi'?'italic ':'';return it+w+' '+(size*K)+'px '+(fam?'"'+fam+'", ':'')+'"Noto Sans", system-ui, sans-serif';}
async function rasterMeasure(text,script,style,size){if(!mctx)mctx=document.createElement('canvas').getContext('2d');mctx.font=await cssFont(script,style,size);mctx.direction=RTL.has(script)?'rtl':'ltr';return mctx.measureText(text).width/K;}
async function rasterPng(text,script,style,size,color){const font=await cssFont(script,style,size);if(!mctx)mctx=document.createElement('canvas').getContext('2d');mctx.font=font;const w=Math.ceil(mctx.measureText(text).width)+4*K,h=Math.ceil(size*K*1.9),base=Math.round(size*K*1.35);const c=document.createElement('canvas');c.width=Math.max(1,w);c.height=h;const g=c.getContext('2d');g.font=font;g.fillStyle=color;g.textBaseline='alphabetic';if(RTL.has(script)){g.direction='rtl';g.textAlign='right';g.fillText(text,w-2*K,base);}else g.fillText(text,2*K,base);const bl=await new Promise(r=>c.toBlob(r,'image/png'));return {bytes:new Uint8Array(await bl.arrayBuffer()),w,h,base};}
function scriptOfCp(cp){for(const [a,b,s] of SCRIPT_RANGES)if(cp>=a&&cp<=b)return s;return 'latn';}
const UNSUPPORTED_RE=/[֐-ࣿ぀-ヿ㐀-鿿가-힯豈-﫿]|[\u{1F300}-\u{1FAFF}]/u;
let fontLib=null;
async function ensurePdfLibs(){
  if(!window.PDFLib)await loadScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
  if(!window.regeneratorRuntime)await loadScript('https://cdn.jsdelivr.net/npm/regenerator-runtime@0.14.1/runtime.js');
  if(!window.fontkit)await loadScript('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js');
}
const fontBytesCache={};
async function fontBytes(path){if(!fontBytesCache[path])fontBytesCache[path]=fetch(FONT_CDN+path).then(r=>{if(!r.ok)throw new Error('Font download failed ('+r.status+')');return r.arrayBuffer();}).catch(e=>{delete fontBytesCache[path];throw e;});return fontBytesCache[path];}
async function writePdf(model,opts={}){
  await ensurePdfLibs();
  const {PDFDocument,rgb}=window.PDFLib;const pdf=await PDFDocument.create();const pdfDoc=pdf;let rastered=false;pdf.registerFontkit(window.fontkit);
  if(model.title)pdf.setTitle(model.title);pdf.setCreator('Redmark Forge (browser)');
  const embedded={};let missing=0;
  const fontFor=async(script,style)=>{const fam=FONTS[script]||FONTS.latn;const key=fam[style]?style:(style==='bi'?(fam.b?'b':'r'):'r');const k=script+':'+key;if(!embedded[k])embedded[k]=pdf.embedFont(await fontBytes(fam[key]),{subset:true});return embedded[k];};
  const slides=model.blocks.some(b=>b.type==='slide');
  const PW=slides?842:595,PH=slides?595:842,M=slides?48:56,CW=PW-2*M;
  let page=null,y=0;const pages=[];
  const newPage=()=>{page=pdf.addPage([PW,PH]);pages.push(page);y=PH-M;};
  newPage();
  // split a run into script segments
  const segs=(text,style,mono)=>{const out=[];let cur='',cs=null;for(const ch of text){const cp=ch.codePointAt(0);const raw=scriptOfCp(cp);const s=mono&&raw==='latn'?'mono':raw;const neutral=/[\s\u200C\u200D]/.test(ch)||(cs&&RASTER.has(cs)&&/[\u0964\u0965,.;:!?()'"-]/.test(ch));if(cs!==null&&s!==cs&&!neutral){out.push({text:cur,script:cs,style});cur='';}if(cs===null||!neutral)cs=s;cur+=ch;}if(cur)out.push({text:cur,script:cs,style});return out;};
  const colorCss=c=>'rgb('+Math.round(c.red*255)+','+Math.round(c.green*255)+','+Math.round(c.blue*255)+')';
  const rasterCache=new Map();
  async function drawSeg(s,x,yy,size,color){if(!s.raster){page.drawText(s.text,{x,y:yy,size,font:s.font,color});return;}const key=s.text+'|'+s.script+'|'+s.style+'|'+size+'|'+colorCss(color);let img=rasterCache.get(key);if(!img){const r=await rasterPng(s.text,s.script,s.style,size,colorCss(color));img={pdf:await pdfDoc.embedPng(r.bytes),r};rasterCache.set(key,img);}page.drawImage(img.pdf,{x:x-2,y:yy-(img.r.h-img.r.base)/K,width:img.r.w/K,height:img.r.h/K});rastered=true;}
  const styleOf=r=>r.bold&&r.italic?'bi':r.bold?'b':r.italic?'i':'r';
  // word wrapping over mixed-font runs
  async function layout(runs,size,width,{bold=false,mono=false}={}){
    const words=[];// [{segs,width,space}]
    for(const r of runs){const st=bold?(r.italic?'bi':'b'):styleOf(r);const parts=String(r.text).split(/(\s+)/);for(const p of parts){if(!p)continue;if(/^\s+$/.test(p)){if(p.includes('\n')){words.push({br:true});continue;}if(words.length)words[words.length-1].space=true;continue;}const ss=segs(p,st,mono||r.code);let w=0;for(const s of ss){if(RASTER.has(s.script)){s.raster=true;s.w=await rasterMeasure(s.text,s.script,s.style,size);}else{s.font=await fontFor(s.script,s.style);s.w=s.font.widthOfTextAtSize(s.text,size);}w+=s.w;}words.push({segs:ss,width:w});}}
    const spaceW=(await fontFor('latn','r')).widthOfTextAtSize(' ',size);const lines=[];let line=[],lw=0;
    for(const w of words){if(w.br){lines.push(line);line=[];lw=0;continue;}const add=(line.length?spaceW:0)+w.width;if(line.length&&lw+add>width){lines.push(line);line=[];lw=0;}
      if(!line.length&&w.width>width){// hard-break very long words
        let chunk=[],cw=0;for(const s of w.segs){if(s.raster){if(cw+s.w>width&&chunk.length){lines.push([{segs:chunk,width:cw}]);chunk=[];cw=0;}chunk.push(s);cw+=s.w;continue;}for(const ch of s.text){const cwid=s.font.widthOfTextAtSize(ch,size);if(cw+cwid>width&&chunk.length){lines.push([{segs:chunk,width:cw}]);chunk=[];cw=0;}const last=chunk[chunk.length-1];if(last&&last.font===s.font){last.text+=ch;last.w+=cwid;}else chunk.push({text:ch,font:s.font,w:cwid});cw+=cwid;}}line=[{segs:chunk,width:cw}];lw=cw;continue;}
      line.push(w);lw+=add;}
    if(line.length)lines.push(line);return {lines,spaceW};
  }
  const ensure=h=>{if(y-h<M+18)newPage();};
  async function para(runs,{size=11,indent=0,bold=false,color=rgb(0.1,0.12,0.16),gapAfter=6,lh=1.42,prefix=null,mono=false,bg=null}={}){
    const width=CW-indent;const {lines,spaceW}=await layout(runs,size,width,{bold,mono});const L=size*lh;
    if(bg){const h=lines.length*L+8;ensure(Math.min(h,PH-2*M));page.drawRectangle({x:M+indent-4,y:y-h+2,width:width+8,height:h,color:bg});y-=4;}
    for(let li=0;li<lines.length;li++){ensure(L);const yy=y-size;
      if(li===0&&prefix){const pf=await fontFor('latn',bold?'b':'r');page.drawText(prefix,{x:M+indent-pf.widthOfTextAtSize(prefix,size)-5,y:yy,size,font:pf,color});}
      let x=M+indent;for(let wi=0;wi<lines[li].length;wi++){const w=lines[li][wi];if(wi>0)x+=spaceW;for(const s of w.segs){if(s.text)await drawSeg(s,x,yy,size,color);x+=s.w;}}
      y-=L;}
    y-=gapAfter;
  }
  async function table(rows,header){
    const cols=Math.max(...rows.map(r=>r.length));if(!cols)return;const size=9.5,pad=4,L=size*1.35;
    // column widths proportional to content length (min share)
    const lens=Array.from({length:cols},(_,c)=>Math.max(4,...rows.map(r=>Math.min(60,String(r[c]??'').length))));const tot=lens.reduce((a,b)=>a+b,0);const widths=lens.map(l=>Math.max(40,CW*l/tot));const scale=CW/widths.reduce((a,b)=>a+b,0);for(let i=0;i<cols;i++)widths[i]*=scale;
    y-=4;
    for(let ri=0;ri<rows.length;ri++){const isH=header&&ri===0;const cells=[];let h=0;for(let c=0;c<cols;c++){const {lines,spaceW}=await layout(plainRuns(rows[ri][c]??''),size,widths[c]-2*pad,{bold:isH});cells.push({lines,spaceW});h=Math.max(h,lines.length*L+2*pad);}
      if(y-h<M+18){newPage();}
      let x=M;for(let c=0;c<cols;c++){page.drawRectangle({x,y:y-h,width:widths[c],height:h,borderColor:rgb(0.75,0.78,0.82),borderWidth:0.6,color:isH?rgb(0.93,0.95,0.97):undefined});
        let yy=y-pad-size;for(const ln of cells[c].lines){let xx=x+pad;for(let wi=0;wi<ln.length;wi++){if(wi>0)xx+=cells[c].spaceW;for(const s of ln[wi].segs){if(s.text)await drawSeg(s,xx,yy,size,rgb(0.1,0.12,0.16));xx+=s.w;}}yy-=L;}
        x+=widths[c];}
      y-=h;}
    y-=10;
  }
  const HS=[0,22,17,14.5,12.5,11.5,11];
  let firstSlide=true;
  if(model.title&&!slides&&!model.blocks.some(b=>b.type==='heading'&&b.level===1&&runsText(b.runs).trim()===model.title.trim()))await para(plainRuns(model.title),{size:24,bold:true,gapAfter:14});
  for(const b of model.blocks){
    if(b.type==='heading'){if(y<PH-M-4)y-=6;ensure(HS[b.level]*3);await para(b.runs,{size:HS[b.level]||11,bold:true,gapAfter:b.level<=2?8:5,color:rgb(0.06,0.11,0.17)});}
    else if(b.type==='para')await para(b.runs);
    else if(b.type==='list'){const counters=[];for(const it of b.items){counters.length=it.level+1;counters[it.level]=(counters[it.level]||0)+1;const pf=b.ordered?counters[it.level]+'.':['•','–','•','–'][it.level%4];await para(it.runs,{indent:18+16*it.level,prefix:pf,gapAfter:2});}y-=5;}
    else if(b.type==='table')await table(b.rows,b.header);
    else if(b.type==='code')await para(plainRuns(b.text.replace(/\t/g,'  ')),{size:9.5,mono:true,bg:rgb(0.95,0.96,0.97),lh:1.35,gapAfter:10});
    else if(b.type==='pagebreak')newPage();
    else if(b.type==='image'&&b.bytes){const img=b.mime==='image/png'?await pdf.embedPng(b.bytes):await pdf.embedJpg(b.bytes);const sc=Math.min(CW/img.width,(PH-2*M)/img.height,1);const w=img.width*sc,h=img.height*sc;ensure(h);page.drawImage(img,{x:M+(CW-w)/2,y:y-h,width:w,height:h});y-=h+10;}
    else if(b.type==='slide'){if(!firstSlide)newPage();firstSlide=false;page.drawRectangle({x:0,y:PH-6,width:PW,height:6,color:rgb(0.88,0.11,0.28)});y=PH-M-6;await para(plainRuns(b.title||'Untitled slide'),{size:26,bold:true,gapAfter:16,color:rgb(0.06,0.11,0.17)});for(const it of b.items)await para(plainRuns(it.text),{size:it.level?14:17,indent:22+20*it.level,prefix:it.level?'–':'•',gapAfter:6});}
  }
  // footer page numbers
  const ff=await fontFor('latn','r');pages.forEach((p,i)=>{const t=(i+1)+' / '+pages.length;p.drawText(t,{x:PW/2-ff.widthOfTextAtSize(t,8.5)/2,y:24,size:8.5,font:ff,color:rgb(0.5,0.53,0.57)});});
  const bytes=await pdf.save();
  return {blob:new Blob([bytes],{type:'application/pdf'}),pages:pages.length,missing,rastered};
}

/* ================= DOCX writer ================= */
const ct=(m,x)=>({docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',dotx:'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',docm:'application/vnd.ms-word.document.macroEnabled.main+xml',dotm:'application/vnd.ms-word.template.macroEnabledTemplate.main+xml'}[x]);
async function writeDocx(model,kind='docx'){
  const z=new JSZip();const rels=[];let imgN=0;
  const run=r=>{const pr=(r.bold?'<w:b/>':'')+(r.italic?'<w:i/>':'')+(r.code?'<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>':'');return String(r.text).split('\n').map((t,i)=>(i?'<w:r><w:br/></w:r>':'')+'<w:r>'+(pr?'<w:rPr>'+pr+'</w:rPr>':'')+String(t).split('\t').map((tt,j)=>(j?'<w:tab/>':'')+'<w:t xml:space="preserve">'+xmlEsc(tt)+'</w:t>').join('')+'</w:r>').join('');};
  const p=(runs,style,extra='')=>'<w:p>'+(style||extra?'<w:pPr>'+(style?'<w:pStyle w:val="'+style+'"/>':'')+extra+'</w:pPr>':'')+(runs||[]).map(run).join('')+'</w:p>';
  let body='';
  if(model.title&&!model.blocks.some(b=>b.type==='heading'&&b.level===1))body+=p(plainRuns(model.title),'Title');
  for(const b of model.blocks){
    if(b.type==='heading')body+=p(b.runs,'Heading'+Math.min(6,b.level));
    else if(b.type==='para')body+=p(b.runs);
    else if(b.type==='list')for(const it of b.items)body+=p(it.runs,'ListParagraph','<w:numPr><w:ilvl w:val="'+Math.min(8,it.level)+'"/><w:numId w:val="'+(b.ordered?2:1)+'"/></w:numPr>');
    else if(b.type==='code')body+=String(b.text).split('\n').map(l=>p([{text:l,code:true}],'Code')).join('');
    else if(b.type==='pagebreak')body+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if(b.type==='table'){const cols=Math.max(...b.rows.map(r=>r.length));const w=Math.floor(9000/Math.max(1,cols));body+='<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>'+('<w:gridCol w:w="'+w+'"/>').repeat(cols)+'</w:tblGrid>'+b.rows.map((r,ri)=>'<w:tr>'+Array.from({length:cols},(_,c)=>'<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/>'+(b.header&&ri===0?'<w:shd w:val="clear" w:color="auto" w:fill="E8EDF2"/>':'')+'</w:tcPr>'+p([{text:r[c]??'',bold:b.header&&ri===0}])+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>'+p([]);}
    else if(b.type==='image'&&b.bytes){imgN++;const e=b.mime==='image/png'?'png':'jpg';z.file('word/media/image'+imgN+'.'+e,b.bytes);rels.push('<Relationship Id="rImg'+imgN+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image'+imgN+'.'+e+'"/>');const cx=5900000,cy=Math.round(cx*b.height/b.width);body+='<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+imgN+'" name="Image '+imgN+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+imgN+'" name="image'+imgN+'.'+e+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg'+imgN+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';}
    else if(b.type==='slide'){body+=p(plainRuns(b.title||'Slide'),'Heading1');for(const it of b.items)body+=p(plainRuns(it.text),'ListParagraph','<w:numPr><w:ilvl w:val="'+Math.min(8,it.level)+'"/><w:numId w:val="1"/></w:numPr>');}
  }
  const NS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  z.file('word/document.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document '+NS+'><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>');
  const hs=[0,32,26,22,20,18,16];const font='<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Nirmala UI"/>';
  z.file('word/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>'+font+'<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-IN" w:bidi="hi-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>'+[1,2,3,4,5,6].map(l=>'<w:style w:type="paragraph" w:styleId="Heading'+l+'"><w:name w:val="heading '+l+'"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="'+(l<3?280:200)+'" w:after="100"/><w:outlineLvl w:val="'+(l-1)+'"/></w:pPr><w:rPr><w:b/><w:color w:val="1F2D3D"/><w:sz w:val="'+hs[l]+'"/></w:rPr></w:style>').join('')+'<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFC5CC"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>');
  const lvl=(i,fmt,txt)=>'<w:lvl w:ilvl="'+i+'"><w:start w:val="1"/><w:numFmt w:val="'+fmt+'"/><w:lvlText w:val="'+txt+'"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="'+(720+360*i)+'" w:hanging="360"/></w:pPr>'+(fmt==='bullet'?'<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>':'')+'</w:lvl>';
  z.file('word/numbering.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">'+Array.from({length:9},(_,i)=>lvl(i,'bullet','')).join('')+'</w:abstractNum><w:abstractNum w:abstractNumId="1">'+Array.from({length:9},(_,i)=>lvl(i,['decimal','lowerLetter','lowerRoman'][i%3],'%'+(i+1)+'.')).join('')+'</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>');
  z.file('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'+rels.join('')+'</Relationships>');
  z.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>');
  z.file('docProps/core.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>'+xmlEsc(model.title||'')+'</dc:title><dc:creator>Redmark Forge</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">'+new Date().toISOString().replace(/\.\d+Z$/,'Z')+'</dcterms:created></cp:coreProperties>');
  z.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="'+ct(0,kind)+'"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  const mimes={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dotx:'application/vnd.openxmlformats-officedocument.wordprocessingml.template'};
  return z.generateAsync({type:'blob',mimeType:mimes[kind]||mimes.docx,compression:'DEFLATE'});
}

/* ================= ODT writer ================= */
function odtBody(model){
  const span=r=>{let t=xmlEsc(r.text).replace(/\t/g,'<text:tab/>').replace(/\n/g,'<text:line-break/>');const st=r.bold&&r.italic?'TBI':r.bold?'TB':r.italic?'TI':r.code?'TC':'';return st?'<text:span text:style-name="'+st+'">'+t+'</text:span>':t;};
  const rs=runs=>(runs||[]).map(span).join('');let out='';
  if(model.title&&!model.blocks.some(b=>b.type==='heading'&&b.level===1))out+='<text:h text:style-name="Heading_20_1" text:outline-level="1">'+xmlEsc(model.title)+'</text:h>';
  for(const b of model.blocks){
    if(b.type==='heading')out+='<text:h text:style-name="Heading_20_'+b.level+'" text:outline-level="'+b.level+'">'+rs(b.runs)+'</text:h>';
    else if(b.type==='para')out+='<text:p text:style-name="Text_20_body">'+rs(b.runs)+'</text:p>';
    else if(b.type==='list'){out+='<text:list text:style-name="'+(b.ordered?'LNum':'LBul')+'">'+b.items.map(it=>'<text:list-item><text:p text:style-name="Text_20_body">'+('    '.repeat(it.level))+rs(it.runs)+'</text:p></text:list-item>').join('')+'</text:list>';}
    else if(b.type==='code')out+=String(b.text).split('\n').map(l=>'<text:p text:style-name="Code">'+xmlEsc(l)+'</text:p>').join('');
    else if(b.type==='pagebreak')out+='<text:p text:style-name="PB"/>';
    else if(b.type==='table'){const cols=Math.max(...b.rows.map(r=>r.length));out+='<table:table table:name="Table'+(out.length)+'"><table:table-column table:number-columns-repeated="'+cols+'"/>'+b.rows.map((r,ri)=>'<table:table-row>'+Array.from({length:cols},(_,c)=>'<table:table-cell table:style-name="Cell" office:value-type="string"><text:p'+(b.header&&ri===0?' text:style-name="TH"':'')+'>'+xmlEsc(r[c]??'')+'</text:p></table:table-cell>').join('')+'</table:table-row>').join('')+'</table:table>';}
    else if(b.type==='slide'){out+='<text:h text:style-name="Heading_20_1" text:outline-level="1">'+xmlEsc(b.title||'Slide')+'</text:h><text:list text:style-name="LBul">'+b.items.map(it=>'<text:list-item><text:p>'+xmlEsc(it.text)+'</text:p></text:list-item>').join('')+'</text:list>';}
  }
  return out;
}
const ODF_NS='xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
const ODF_STYLES='<office:styles><style:style style:name="Standard" style:family="paragraph"><style:text-properties fo:font-size="11pt"/></style:style><style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.18cm"/></style:style>'+[1,2,3,4,5,6].map(l=>'<style:style style:name="Heading_20_'+l+'" style:display-name="Heading '+l+'" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="'+l+'"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm" fo:keep-with-next="always"/><style:text-properties fo:font-size="'+[0,20,16,14,13,12,11][l]+'pt" fo:font-weight="bold"/></style:style>').join('')+'<style:style style:name="Code" style:family="paragraph"><style:paragraph-properties fo:background-color="#f2f4f7"/><style:text-properties style:font-name="Courier New" fo:font-family="\'Courier New\'" fo:font-size="9.5pt"/></style:style></office:styles>';
const ODF_AUTO='<office:automatic-styles><style:style style:name="TB" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="TI" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="TBI" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style><style:style style:name="TC" style:family="text"><style:text-properties fo:font-family="\'Courier New\'"/></style:style><style:style style:name="TH" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style><style:style style:name="PB" style:family="paragraph"><style:paragraph-properties fo:break-before="page"/></style:style><style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.08cm" fo:border="0.5pt solid #bfc5cc"/></style:style><text:list-style style:name="LBul"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.4cm" text:min-label-width="0.5cm"/></text:list-level-style-bullet></text:list-style><text:list-style style:name="LNum"><text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="0.4cm" text:min-label-width="0.6cm"/></text:list-level-style-number></text:list-style></office:automatic-styles>';
async function writeOdt(model,kind='odt'){
  const mime=kind==='ott'?'application/vnd.oasis.opendocument.text-template':'application/vnd.oasis.opendocument.text';
  if(kind==='fodt')return new Blob(['<?xml version="1.0" encoding="UTF-8"?><office:document '+ODF_NS+' office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">'+ODF_STYLES+ODF_AUTO+'<office:body><office:text>'+odtBody(model)+'</office:text></office:body></office:document>'],{type:'application/vnd.oasis.opendocument.text-flat-xml'});
  const z=new JSZip();z.file('mimetype',mime,{compression:'STORE'});
  z.file('META-INF/manifest.xml','<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="'+mime+'"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>');
  z.file('content.xml','<?xml version="1.0" encoding="UTF-8"?><office:document-content '+ODF_NS+' office:version="1.3">'+ODF_AUTO+'<office:body><office:text>'+odtBody(model)+'</office:text></office:body></office:document-content>');
  z.file('styles.xml','<?xml version="1.0" encoding="UTF-8"?><office:document-styles '+ODF_NS+' office:version="1.3">'+ODF_STYLES+'</office:document-styles>');
  z.file('meta.xml','<?xml version="1.0" encoding="UTF-8"?><office:document-meta '+ODF_NS+' office:version="1.3"><office:meta><meta:generator>Redmark Forge</meta:generator><dc:title>'+xmlEsc(model.title||'')+'</dc:title></office:meta></office:document-meta>');
  return z.generateAsync({type:'blob',mimeType:mime,compression:'DEFLATE'});
}

/* ================= text writers ================= */
const mdRuns=rs=>(rs||[]).map(r=>{let t=r.text;if(!t.trim())return t;if(r.code)return '`'+t+'`';if(r.bold&&r.italic)return '***'+t+'***';if(r.bold)return '**'+t+'**';if(r.italic)return '*'+t+'*';return t;}).join('');
function writeMarkdown(model){const o=[];if(model.title&&!model.blocks.some(b=>b.type==='heading'&&b.level===1))o.push('# '+model.title,'');for(const b of model.blocks){if(b.type==='heading')o.push('#'.repeat(b.level)+' '+mdRuns(b.runs),'');else if(b.type==='para')o.push(mdRuns(b.runs),'');else if(b.type==='list'){const n=[];b.items.forEach(it=>{n.length=it.level+1;n[it.level]=(n[it.level]||0)+1;o.push('  '.repeat(it.level)+(b.ordered?n[it.level]+'.':'-')+' '+mdRuns(it.runs));});o.push('');}else if(b.type==='code')o.push('```',b.text,'```','');else if(b.type==='table'&&b.rows.length){const cols=Math.max(...b.rows.map(r=>r.length));const row=r=>'| '+Array.from({length:cols},(_,c)=>String(r[c]??'').replace(/\|/g,'\\|').replace(/\n/g,' ')).join(' | ')+' |';o.push(row(b.rows[0]),'| '+Array(cols).fill('---').join(' | ')+' |',...b.rows.slice(1).map(row),'');}else if(b.type==='slide'){o.push('## '+(b.title||'Slide'),...b.items.map(it=>'  '.repeat(it.level)+'- '+it.text),'');}else if(b.type==='pagebreak')o.push('---','');}return o.join('\n').replace(/\n{3,}/g,'\n\n').trim()+'\n';}
function writeText(model){const o=[];if(model.title)o.push(model.title,'');for(const b of model.blocks){if(b.type==='heading'||b.type==='para')o.push(runsText(b.runs),'');else if(b.type==='list'){const n=[];b.items.forEach(it=>{n.length=it.level+1;n[it.level]=(n[it.level]||0)+1;o.push('  '.repeat(it.level)+(b.ordered?n[it.level]+'. ':'• ')+runsText(it.runs));});o.push('');}else if(b.type==='code')o.push(b.text,'');else if(b.type==='table')o.push(...b.rows.map(r=>r.join('\t')),'');else if(b.type==='slide')o.push(b.title||'Slide',...b.items.map(it=>'  '.repeat(it.level)+'• '+it.text),'');}return o.join('\n').replace(/\n{3,}/g,'\n\n').trim()+'\n';}
function writeHtml(model){const hr=rs=>(rs||[]).map(r=>{let t=xmlEsc(r.text).replace(/\n/g,'<br>');if(r.code)t='<code>'+t+'</code>';if(r.italic)t='<em>'+t+'</em>';if(r.bold)t='<strong>'+t+'</strong>';return t;}).join('');let b='';for(const x of model.blocks){if(x.type==='heading')b+='<h'+x.level+'>'+hr(x.runs)+'</h'+x.level+'>';else if(x.type==='para')b+='<p>'+hr(x.runs)+'</p>';else if(x.type==='list')b+='<'+(x.ordered?'ol':'ul')+'>'+x.items.map(it=>'<li style="margin-left:'+(it.level*1.5)+'em">'+hr(it.runs)+'</li>').join('')+'</'+(x.ordered?'ol':'ul')+'>';else if(x.type==='code')b+='<pre><code>'+xmlEsc(x.text)+'</code></pre>';else if(x.type==='table')b+='<table>'+x.rows.map((r,i)=>'<tr>'+r.map(c=>(x.header&&i===0?'<th>':'<td>')+xmlEsc(c)+(x.header&&i===0?'</th>':'</td>')).join('')+'</tr>').join('')+'</table>';else if(x.type==='slide')b+='<section><h2>'+xmlEsc(x.title||'Slide')+'</h2><ul>'+x.items.map(it=>'<li>'+xmlEsc(it.text)+'</li>').join('')+'</ul></section>';else if(x.type==='pagebreak')b+='<hr>';}
  return '<!doctype html><html><head><meta charset="utf-8"><title>'+xmlEsc(model.title||'Document')+'</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:46em;margin:2em auto;padding:0 1em;color:#1a1f29}table{border-collapse:collapse}td,th{border:1px solid #c5cbd3;padding:.3em .6em}th{background:#eef2f6}pre{background:#f3f5f8;padding:.8em;overflow:auto}</style></head><body>'+(model.title&&!model.blocks.some(z=>z.type==='heading'&&z.level===1)?'<h1>'+xmlEsc(model.title)+'</h1>':'')+b+'</body></html>';}

async function writeDocument(model,target){
  const t=String(target).toLowerCase();
  if(t==='pdf'){const r=await writePdf(model);return {blob:r.blob,ext:'pdf',note:r.rastered?'Bengali, Telugu, Malayalam, Gurmukhi, Arabic and CJK text is drawn as sharp images so it renders correctly (not selectable).':''};}
  if(t==='docx'||t==='dotx')return {blob:await writeDocx(model,t),ext:t};
  if(t==='odt'||t==='ott'||t==='fodt')return {blob:await writeOdt(model,t),ext:t};
  if(t==='md'||t==='markdown')return {blob:new Blob([writeMarkdown(model)],{type:'text/markdown'}),ext:'md'};
  if(t==='txt')return {blob:new Blob([writeText(model)],{type:'text/plain'}),ext:'txt'};
  if(t==='html'||t==='htm')return {blob:new Blob([writeHtml(model)],{type:'text/html'}),ext:'html'};
  return null;
}
const DOC_TARGETS=new Set(['pdf','docx','dotx','odt','ott','fodt','md','txt','html']);

/* ================= Spreadsheets (keep every sheet) ================= */
const SHEET_IN=new Set(['xls','xlsx','xlsm','xlsb','xlt','xltx','xltm','ods','ots','fods','csv','tsv']);
const SHEET_OUT={xlsx:'xlsx',xlsm:'xlsm',xlsb:'xlsb',xls:'biff8',ods:'ods',fods:'fods',csv:'csv',tsv:'csv'};
async function convertSheet(file,target){
  if(!window.XLSX)throw new Error('The spreadsheet engine did not load. Check your internet connection and reload.');
  const e=ext(file.name);const wb=e==='csv'||e==='tsv'?XLSX.read(await file.text(),{type:'string',FS:e==='tsv'?'\t':',',raw:false}):XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,cellStyles:true,cellFormula:true});
  const t=target.toLowerCase();const b=base(file.name);
  if(t==='csv'||t==='tsv'){const FS=t==='tsv'?'\t':',';if(wb.SheetNames.length===1)return [{blob:new Blob(['﻿'+XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]],{FS})],{type:'text/csv'}),name:b+'.'+t}];
    const z=new JSZip();wb.SheetNames.forEach(n=>z.file(b+' - '+n.replace(/[\\/:*?"<>|]/g,'_')+'.'+t,'﻿'+XLSX.utils.sheet_to_csv(wb.Sheets[n],{FS})));return [{blob:await z.generateAsync({type:'blob'}),name:b+'_'+t+'_sheets.zip',sheets:wb.SheetNames.length}];}
  if(t==='pdf'){const blocks=[];wb.SheetNames.forEach((n,i)=>{const rows=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:false,defval:''}).filter(r=>r.some(c=>String(c).trim()));if(i)blocks.push({type:'pagebreak'});blocks.push({type:'heading',level:2,runs:plainRuns(n)});if(rows.length)blocks.push({type:'table',rows:rows.slice(0,2000),header:true});});const r=await writePdf({title:b,blocks});return [{blob:r.blob,name:b+'.pdf'}];}
  const bt=SHEET_OUT[t];if(!bt)return null;
  const out=XLSX.write(wb,{bookType:bt,type:'array',compression:true,cellStyles:true});
  return [{blob:new Blob([out]),name:b+'.'+t,sheets:wb.SheetNames.length}];
}

/* ================= PDF text → document (reflow) ================= */
async function pdfToModel(file,{images=false,text=true}={}){
  const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const blocks=[];
  for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);
    if(images){const vp=page.getViewport({scale:2});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);await page.render({canvasContext:g,viewport:vp}).promise;const bl=await new Promise(r=>c.toBlob(r,'image/jpeg',0.9));blocks.push({type:'image',bytes:new Uint8Array(await bl.arrayBuffer()),mime:'image/jpeg',width:c.width,height:c.height});}
    if(text){const tc=await page.getTextContent();const items=tc.items.filter(it=>it.str!==undefined);
      // group into lines by baseline
      const lines=[];for(const it of items){const y=Math.round(it.transform[5]),h=Math.abs(it.transform[3])||it.height||10;let ln=lines.find(l=>Math.abs(l.y-y)<=Math.max(2,h*0.35));if(!ln){ln={y,h,parts:[]};lines.push(ln);}ln.h=Math.max(ln.h,h);ln.parts.push({x:it.transform[4],s:it.str,w:it.width});}
      lines.sort((a,b)=>b.y-a.y);lines.forEach(l=>{l.parts.sort((a,b)=>a.x-b.x);let t='',end=null;for(const p of l.parts){if(end!==null&&p.x-end>l.h*0.25&&!/\s$/.test(t)&&!/^\s/.test(p.s))t+=' ';t+=p.s;end=p.x+(p.w||0);}l.text=t.replace(/\s+/g,' ').trim();});
      const body=lines.filter(l=>l.text);const weight={};body.forEach(l=>{const k=Math.round(l.h);weight[k]=(weight[k]||0)+l.text.length;});const median=+Object.entries(weight).sort((a,b)=>b[1]-a[1])[0]?.[0]||10;// body size = the size carrying the most characters
      let para=[],prevY=null,prevH=0;const flush=()=>{if(para.length){blocks.push({type:'para',runs:plainRuns(para.join(' ').replace(/(\w)- (\w)/g,'$1$2'))});para=[];}};
      for(const l of body){const isHead=l.h>=median*1.25&&l.text.length<120;const gap=prevY===null?0:prevY-l.y;
        if(isHead){flush();blocks.push({type:'heading',level:l.h>=median*1.7?1:2,runs:plainRuns(l.text)});}
        else if(/^([•●▪◦\-–*]|\d+[.)])\s+/.test(l.text)){flush();const ordered=/^\d/.test(l.text);const last=blocks[blocks.length-1];const item={level:0,runs:plainRuns(l.text.replace(/^([•●▪◦\-–*]|\d+[.)])\s+/,''))};if(last&&last.type==='list'&&last.ordered===ordered)last.items.push(item);else blocks.push({type:'list',ordered,items:[item]});}
        else{if(prevY!==null&&gap>Math.max(prevH,l.h)*1.7)flush();para.push(l.text);}
        prevY=l.y;prevH=l.h;}
      flush();}
    if(n<pdf.numPages)blocks.push({type:'pagebreak'});
    if(page.cleanup)page.cleanup();}
  return {title:'',blocks};
}

/* ================= wiring ================= */
function rememberFile(inputId,dropId,cb){const i=$(inputId),d=dropId?$(dropId):i?.closest('.dropzone');i?.addEventListener('change',()=>cb(i.files?.[0]||null));d?.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)cb(f);});}
function intercept(id,handler){const el=$(id);if(!el)return;el.addEventListener('click',async e=>{const plan=handler.plan?handler.plan():true;if(!plan)return;e.stopImmediatePropagation();e.preventDefault();if(el.dataset.omniBusy==='1')return;el.dataset.omniBusy='1';const lbl=el.textContent;el.disabled=true;try{await handler.run(plan);}catch(err){console.error(err);alert((handler.label||'Office Studio')+': '+(err.message||err));}finally{el.disabled=false;el.textContent=lbl;delete el.dataset.omniBusy;}},true);}
const busy=(id,t)=>{const el=$(id);if(el)el.textContent=t;};

// 1. DOCX → PDF / TXT
let w2pFile=null;rememberFile('w2pInput','w2pDropzone',f=>w2pFile=f);
$('w2pResetBtn')?.addEventListener('click',()=>{w2pFile=null;});
intercept('w2pRunBtn',{label:'DOCX → PDF',plan(){return w2pFile?{}:null;},async run(){busy('w2pRunBtn','Building PDF…');const m=await readDocx(w2pFile);if(!m.blocks.length)throw new Error('No readable content found in this DOCX.');const r=await writePdf(m);save(r.blob,base(w2pFile.name)+'.pdf');notify('PDF created • '+r.pages+' page'+(r.pages===1?'':'s')+(r.missing?' • '+r.missing+' unsupported characters replaced':''));}});
intercept('w2pTxtBtn',{label:'DOCX → TXT',plan(){return w2pFile?{}:null;},async run(){const m=await readDocx(w2pFile);save(new Blob([writeText(m)],{type:'text/plain;charset=utf-8'}),base(w2pFile.name)+'.txt');notify('Text exported.');}});

// 2. Text / Markdown → DOCX / PDF
const t2dModel=()=>{const text=$('t2dText')?.value||'';if(!text.trim())throw new Error('Enter some text first.');const title=($('t2dTitle')?.value||'').trim();const headings=($('t2dStyle')?.value||'headings')==='headings';return {title,blocks:headings?readMarkdown(text):readPlain(text)};};
const unsupportedOnly=text=>UNSUPPORTED_RE.test(text||'');
intercept('t2dDocxBtn',{label:'Text → DOCX',async run(){const m=t2dModel();save(await writeDocx(m),(m.title||'document').replace(/[\\/:*?"<>|]+/g,'_')+'.docx');notify('DOCX created in your browser.');}});
intercept('t2dPdfBtn',{label:'Text → PDF',async run(){busy('t2dPdfBtn','Building PDF…');const m=t2dModel();const r=await writePdf(m);save(r.blob,(m.title||'document').replace(/[\\/:*?"<>|]+/g,'_')+'.pdf');notify('PDF created • '+r.pages+' page'+(r.pages===1?'':'s')+(r.missing?' • '+r.missing+' unsupported characters replaced — the Local Engine handles Arabic/CJK':''));}});
window.OMNI_DOCS={readDocument,readMarkdown,readHtml,readPlain,readDocx,readOdt,readRtf,writeDocument,writePdf,writeDocx,writeOdt,writeText,writeHtml,writeMarkdown,convertSheet,pdfToModel,unsupportedOnly,runsText};

// 3. PDF → Word (browser modes; the recommended mode tries the Local Engine first in index.html)
let p2wFile=null;rememberFile('p2wInput','p2wDropzone',f=>p2wFile=f);
intercept('p2wRunBtn',{label:'PDF → Word',plan(){return p2wFile?{}:null;},async run(){const mode=$('p2wMode')?.value||'hybrid';busy('p2wRunBtn','Converting…');
  const m=await pdfToModel(p2wFile,{images:mode!=='reflow',text:mode!=='visual'});save(await writeDocx(m),base(p2wFile.name)+'.docx');
  notify(mode==='reflow'?'Editable DOCX created in your browser.':mode==='visual'?'Visual-replica DOCX created (page images).':'DOCX created in your browser: page snapshots + editable text.');}});

// 4. Universal Office converter + quick buttons
let officeFile=null;rememberFile('officeConvertInput','officeConvertDropzone',f=>officeFile=f);
$('officeConvertReset')?.addEventListener('click',()=>{officeFile=null;});
async function officeRoute(file,target){
  const e=ext(file.name),t=String(target).toLowerCase(),b=base(file.name);
  if(DOC_INPUTS.has(e)&&DOC_TARGETS.has(t)){const m=await readDocument(file);if(!m||!m.blocks.length)throw new Error('No readable content found in '+file.name+'.');const r=await writeDocument(m,t);save(r.blob,b+'.'+r.ext);notify('Converted to '+t.toUpperCase()+' in your browser.'+(r.note?' '+r.note:''));return true;}
  if(SHEET_IN.has(e)&&(SHEET_OUT[t]||t==='pdf')){const outs=await convertSheet(file,t);if(!outs)return false;outs.forEach(o=>save(o.blob,o.name));notify('Converted to '+t.toUpperCase()+' in your browser'+(outs[0].sheets>1?' • '+outs[0].sheets+' sheets kept':'')+'.');return true;}
  if(['pptx','pptm','ppsx','potx'].includes(e)&&t==='pdf'){const m=await readPptx(file);if(!m.blocks.length)throw new Error('No slides found.');const r=await writePdf(m);save(r.blob,b+'.pdf');notify('Slides exported as an outline PDF (text and bullets). For pixel-exact slides use the Local Engine.');return true;}
  if(['pptx','pptm','ppsx','potx'].includes(e)&&['docx','odt','md','txt','html'].includes(t)){const m=await readPptx(file);const r=await writeDocument(m,t);save(r.blob,b+'.'+r.ext);notify('Slide text exported to '+t.toUpperCase()+'.');return true;}
  if(e==='pdf'&&['docx','odt','txt','md','html'].includes(t)){const m=await pdfToModel(file);const r=await writeDocument(m,t);save(r.blob,b+'.'+r.ext);notify('PDF text converted to '+t.toUpperCase()+' in your browser.');return true;}
  if(window.OMNI_BROWSER_FIRST?.office&&((e==='pdf'&&t==='pptx')||(['pptx','ppsx','potx'].includes(e)&&['pptx','ppsx','potx'].includes(t)&&e!==t))){if(await window.OMNI_BROWSER_FIRST.office(file,t)){notify('Converted to '+t.toUpperCase()+' in your browser.');return true;}}
  return false;
}
function officePlan(file,target){if(!file)return null;const e=ext(file.name),t=String(target).toLowerCase();
  const ok=(DOC_INPUTS.has(e)&&DOC_TARGETS.has(t))||(SHEET_IN.has(e)&&(SHEET_OUT[t]||t==='pdf'))||(['pptx','pptm','ppsx','potx'].includes(e)&&['pdf','docx','odt','md','txt','html','pptx','ppsx','potx'].includes(t)&&e!==t)||(e==='pdf'&&['docx','odt','txt','md','html','pptx'].includes(t));
  return ok?{file,target:t}:null;}
const officeButtons={officeConvertBtn:null,officePptPdfBtn:'pdf',officePdfPptBtn:'pptx',officeCsvXlsxBtn:'xlsx',officeSheetXlsxBtn:'xlsx',officeDeckPptxBtn:'pptx'};
for(const [id,forced] of Object.entries(officeButtons))intercept(id,{label:'Office Studio',plan(){const t=forced||$('officeConvertTarget')?.value;if(forced&&$('officeConvertTarget'))$('officeConvertTarget').value=forced;return officePlan(officeFile,t);},async run(p){busy(id,'Converting…');if(!(await officeRoute(p.file,p.target)))throw new Error('This conversion needs the Local Engine (LibreOffice).');}});

// 5. Dedicated presentation / spreadsheet converters
let presFile=null,sheetFile=null;rememberFile('officePresentationInput','officePresentationDrop',f=>presFile=f);rememberFile('officeSpreadsheetInput','officeSpreadsheetDrop',f=>sheetFile=f);
$('officePresentationReset')?.addEventListener('click',()=>{presFile=null;});$('officeSpreadsheetReset')?.addEventListener('click',()=>{sheetFile=null;});
intercept('officePresentationRun',{label:'Presentation Studio',plan(){return officePlan(presFile,$('officePresentationTarget')?.value);},async run(p){busy('officePresentationRun','Converting…');if(!(await officeRoute(p.file,p.target)))throw new Error('This conversion needs the Local Engine (LibreOffice).');}});
intercept('officeSpreadsheetRun',{label:'Spreadsheet Studio',plan(){return officePlan(sheetFile,$('officeSpreadsheetTarget')?.value);},async run(p){busy('officeSpreadsheetRun','Converting…');if(!(await officeRoute(p.file,p.target)))throw new Error('This conversion needs the Local Engine (LibreOffice).');}});
})();
