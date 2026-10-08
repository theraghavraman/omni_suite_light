/* Omni Suite — browser EPUB / ebook engine for EPUB Studio.
 * Reads EPUB (spine order, images), FB2, CBZ comics and everything the Office document engine reads;
 * writes EPUB 3 (reflowable or fixed-layout), PDF, DOCX, TXT, FB2, RTF and HTMLZ.
 * Kindle and other legacy formats still go to the Local Engine (Calibre).
 * Depends on omni_browser_docs.js (window.OMNI_DOCS).
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const D=()=>window.OMNI_DOCS;
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'book').replace(/\.[^.]+$/,'')||'book';
const xmlEsc=s=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const notify=(m,e)=>{if(window.omniNotify)window.omniNotify(m,e);};
const plainRuns=t=>[{text:String(t??'')}];
const runsText=r=>(r||[]).map(x=>x.text).join('');
const safeName=s=>String(s||'book').replace(/[\\/:*?"<>|]+/g,'_').trim()||'book';

/* ---------- images ---------- */
async function normalizeImage(bytes,mime){
  // pdf-lib embeds PNG/JPEG only; convert anything else through a canvas.
  let blob=new Blob([bytes],{type:mime||''});let bmp;try{bmp=await createImageBitmap(blob);}catch(_){if(/svg/.test(mime)){const url=URL.createObjectURL(blob);try{const img=new Image();await new Promise((r,j)=>{img.onload=r;img.onerror=j;img.src=url;});bmp=img;}finally{URL.revokeObjectURL(url);}}else return null;}
  const w=bmp.width||800,h=bmp.height||600;
  if(mime==='image/png'||mime==='image/jpeg')return {bytes:new Uint8Array(bytes),mime,width:w,height:h};
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,w,h);g.drawImage(bmp,0,0,w,h);
  const out=await new Promise(r=>c.toBlob(r,'image/png'));return {bytes:new Uint8Array(await out.arrayBuffer()),mime:'image/png',width:w,height:h};
}
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp',avif:'image/avif'};

/* ---------- EPUB reader ---------- */
function resolvePath(dir,href){const parts=(dir?dir.split('/'):[]).concat(String(href).split('#')[0].split('/'));const out=[];for(const p of parts){if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(decodeURIComponent(p));}return out.join('/');}
async function readEpub(file){
  const z=await JSZip.loadAsync(await file.arrayBuffer());const P=(s,t)=>new DOMParser().parseFromString(s,t||'application/xml');
  const cont=z.file('META-INF/container.xml');let opfPath=cont?P(await cont.async('text')).querySelector('rootfile')?.getAttribute('full-path'):null;
  if(!opfPath)opfPath=Object.keys(z.files).find(n=>n.endsWith('.opf'));if(!opfPath)throw new Error('Not a valid EPUB (no package document).');
  const opf=P(await z.file(opfPath).async('text'));const dir=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')):'';
  const meta=t=>opf.getElementsByTagName(t)[0]?.textContent?.trim()||'';
  const title=meta('dc:title'),author=meta('dc:creator'),lang=meta('dc:language')||'en';
  const items={};for(const it of opf.getElementsByTagName('item'))items[it.getAttribute('id')]={href:it.getAttribute('href'),type:it.getAttribute('media-type'),props:it.getAttribute('properties')||''};
  let spine=[...opf.getElementsByTagName('itemref')].map(r=>items[r.getAttribute('idref')]).filter(Boolean).filter(x=>/html/.test(x.type)&&!/\bnav\b/.test(x.props));
  if(!spine.length)spine=Object.values(items).filter(x=>/html/.test(x.type)&&!/\bnav\b/.test(x.props));
  const blocks=[];let chapter=0;
  for(const it of spine){const path=resolvePath(dir,it.href);const f=z.file(path);if(!f)continue;const html=await f.async('text');
    const doc=P(html,'text/html');doc.querySelectorAll('script,style,nav[epub\\:type="toc"]').forEach(e=>e.remove());
    const sub=D().readHtml('<body>'+doc.body.innerHTML+'</body>');const fdir=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
    for(const b of sub.blocks){if(b.type==='image'&&b.src){const ip=resolvePath(fdir,b.src),imf=z.file(ip);if(imf){const n=await normalizeImage(await imf.async('uint8array'),MIME[ext(ip)]);if(n)Object.assign(b,n,{name:ip.split('/').pop()});}}}
    const content=sub.blocks.filter(b=>b.type!=='image'||b.bytes);if(!content.length)continue;
    if(chapter++>0)blocks.push({type:'pagebreak'});blocks.push(...content);}
  return {title,author,lang,blocks,zip:z};
}

/* ---------- FB2 reader / writer ---------- */
async function readFb2(file){
  let xml;if(ext(file.name)==='fbz'||ext(file.name)==='zip'){const z=await JSZip.loadAsync(await file.arrayBuffer());const f=Object.values(z.files).find(x=>/\.fb2$/i.test(x.name));if(!f)throw new Error('No .fb2 inside the archive.');xml=await f.async('text');}else xml=await file.text();
  const doc=new DOMParser().parseFromString(xml,'application/xml');const T=(el,n)=>el?.getElementsByTagName(n)[0];
  const title=T(doc,'book-title')?.textContent||'';const a=T(doc,'author');const author=a?[T(a,'first-name')?.textContent,T(a,'last-name')?.textContent].filter(Boolean).join(' '):'';
  const bins={};for(const b of doc.getElementsByTagName('binary')){try{const bytes=Uint8Array.from(atob(b.textContent.replace(/\s+/g,'')),c=>c.charCodeAt(0));bins[b.getAttribute('id')]={bytes,mime:b.getAttribute('content-type')};}catch(_){}}
  const blocks=[];const runs=el=>{const out=[];const v=(n,st)=>n.childNodes.forEach(c=>{if(c.nodeType===3)out.push({text:c.textContent,...st});else if(c.nodeType===1)v(c,{...st,bold:st.bold||c.localName==='strong',italic:st.italic||c.localName==='emphasis'});});v(el,{});return out;};
  const walk=(el,depth)=>{for(const c of el.children){const n=c.localName;if(n==='section'){walk(c,depth+1);}else if(n==='title'){blocks.push({type:'heading',level:Math.min(6,Math.max(1,depth)),runs:plainRuns(c.textContent.trim().replace(/\s+/g,' '))});}else if(n==='p'||n==='subtitle'||n==='text-author'){const r=runs(c);if(runsText(r).trim())blocks.push({type:'para',runs:r});}else if(n==='image'){const id=(c.getAttribute('l:href')||c.getAttributeNS('http://www.w3.org/1999/xlink','href')||'').replace('#','');if(bins[id])blocks.push({type:'image',src:id,...bins[id]});}else if(n==='poem'||n==='cite'||n==='epigraph'||n==='stanza')walk(c,depth);else if(n==='v'){blocks.push({type:'para',runs:runs(c)});}else if(n==='table'){const rows=[...c.getElementsByTagName('tr')].map(tr=>[...tr.children].map(td=>td.textContent.trim()));blocks.push({type:'table',rows,header:true});}}};
  for(const body of doc.getElementsByTagName('body'))if(body.getAttribute('name')!=='notes')walk(body,0);
  for(const b of blocks)if(b.type==='image'&&b.bytes){const n=await normalizeImage(b.bytes,b.mime);if(n)Object.assign(b,n);}
  return {title,author,lang:'en',blocks:blocks.filter(b=>b.type!=='image'||b.width)};
}
function writeFb2(model){
  const p=runs=>'<p>'+(runs||[]).map(r=>{let t=xmlEsc(r.text);if(r.italic)t='<emphasis>'+t+'</emphasis>';if(r.bold)t='<strong>'+t+'</strong>';return t;}).join('')+'</p>';
  let body='',open=false,bins='',n=0;const close=()=>{if(open){body+='</section>';open=false;}};
  for(const b of model.blocks){if(b.type==='heading'&&b.level<=2){close();body+='<section><title>'+p(b.runs)+'</title>';open=true;continue;}if(!open){body+='<section>';open=true;}
    if(b.type==='heading')body+='<subtitle>'+xmlEsc(runsText(b.runs))+'</subtitle>';else if(b.type==='para')body+=p(b.runs);else if(b.type==='list')body+=b.items.map(it=>p([{text:(b.ordered?'':'• ')},...it.runs])).join('');else if(b.type==='code')body+=b.text.split('\n').map(l=>'<p><code>'+xmlEsc(l)+'</code></p>').join('');else if(b.type==='table')body+='<table>'+b.rows.map(r=>'<tr>'+r.map(c=>'<td>'+xmlEsc(c)+'</td>').join('')+'</tr>').join('')+'</table>';else if(b.type==='image'&&b.bytes){n++;let s='';for(let i=0;i<b.bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.bytes.subarray(i,i+0x8000));bins+='<binary id="img'+n+'" content-type="'+b.mime+'">'+btoa(s)+'</binary>';body+='<image l:href="#img'+n+'"/>';}else if(b.type==='slide'){body+='<subtitle>'+xmlEsc(b.title)+'</subtitle>'+b.items.map(it=>'<p>• '+xmlEsc(it.text)+'</p>').join('');}}
  close();const [first,...rest]=String(model.author||'').split(' ');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><genre>nonfiction</genre><author><first-name>'+xmlEsc(first||'Unknown')+'</first-name><last-name>'+xmlEsc(rest.join(' '))+'</last-name></author><book-title>'+xmlEsc(model.title||'Untitled')+'</book-title><lang>'+xmlEsc(model.lang||'en')+'</lang></title-info><document-info><program-used>Redmark Forge</program-used><date>'+new Date().toISOString().slice(0,10)+'</date><id>'+crypto.randomUUID?.()+'</id><version>1.0</version></document-info></description><body>'+body+'</body>'+bins+'</FictionBook>';
}

/* ---------- RTF writer (Unicode-safe) ---------- */
function writeRtf(model){
  const esc=t=>{let o='';for(const ch of String(t)){const c=ch.codePointAt(0);if(ch==='\\'||ch==='{'||ch==='}')o+='\\'+ch;else if(ch==='\n')o+='\\line ';else if(ch==='\t')o+='\\tab ';else if(c<128)o+=ch;else if(c<0x10000)o+='\\u'+(c>32767?c-65536:c)+'?';else{const s=ch;for(let i=0;i<s.length;i++){const u=s.charCodeAt(i);o+='\\u'+(u>32767?u-65536:u)+'?';}}}return o;};
  const runs=rs=>(rs||[]).map(r=>(r.bold?'{\\b ':'')+(r.italic?'{\\i ':'')+esc(r.text)+(r.italic?'}':'')+(r.bold?'}':'')).join('');
  let o='{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}{\\f1 Consolas;}}\\uc1\\fs22\n';
  if(model.title)o+='{\\pard\\sb120\\sa240\\b\\fs40 '+esc(model.title)+'\\par}\n';
  for(const b of model.blocks){if(b.type==='heading')o+='{\\pard\\sb240\\sa120\\b\\fs'+[0,36,30,26,24,22,22][b.level]+' '+runs(b.runs)+'\\par}\n';else if(b.type==='para')o+='{\\pard\\sa160 '+runs(b.runs)+'\\par}\n';else if(b.type==='list'){const n=[];b.items.forEach(it=>{n.length=it.level+1;n[it.level]=(n[it.level]||0)+1;o+='{\\pard\\li'+(360+360*it.level)+'\\fi-260\\sa60 '+(b.ordered?n[it.level]+'.':'\\bullet')+'\\tab '+runs(it.runs)+'\\par}\n';});}else if(b.type==='code')o+=b.text.split('\n').map(l=>'{\\pard\\f1\\fs19 '+esc(l)+'\\par}\n').join('');else if(b.type==='table')o+=b.rows.map(r=>{let x='\\trowd\\trgaph100';r.forEach((_,i)=>{x+='\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx'+(9000*(i+1)/r.length|0);});return x+r.map(c=>'\\pard\\intbl '+esc(c)+'\\cell').join('')+'\\row\n';}).join('')+'{\\pard\\par}\n';else if(b.type==='pagebreak')o+='\\page\n';else if(b.type==='slide')o+='{\\pard\\sb240\\b\\fs32 '+esc(b.title)+'\\par}'+b.items.map(it=>'{\\pard\\li360 \\bullet\\tab '+esc(it.text)+'\\par}').join('')+'\n';}
  return o+'}';
}

/* ---------- EPUB 3 writer ---------- */
const EPUB_CSS='body{font-family:Georgia,"Noto Serif","Noto Sans",serif;line-height:1.6;margin:0 5%;color:#1b1f27}h1,h2,h3,h4{font-family:"Helvetica Neue",Arial,"Noto Sans",sans-serif;line-height:1.25;margin:1.4em 0 .5em}h1{font-size:1.7em}h2{font-size:1.35em}p{margin:0 0 .8em;text-align:left}img{max-width:100%;height:auto;display:block;margin:1em auto}figure{margin:1em 0;text-align:center}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #c5cbd3;padding:.3em .5em;text-align:left}th{background:#eef2f6}pre{white-space:pre-wrap;background:#f3f5f8;padding:.6em;font-size:.85em}ul,ol{margin:0 0 .8em 1.2em;padding:0}.page img{margin:0 auto}';
async function writeEpub(model,{title,author,lang,fixed=false,pageImages=null}={}){
  const z=new JSZip();title=title||model.title||'Untitled';author=author||model.author||'Unknown';lang=lang||model.lang||'en';
  z.file('mimetype','application/epub+zip',{compression:'STORE'});
  z.file('META-INF/container.xml','<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/style.css',EPUB_CSS);
  const uid='urn:uuid:'+(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36));const manifest=[],spine=[],toc=[];let imgN=0;
  const page=(t,body,extraHead='')=>'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="'+xmlEsc(lang)+'" lang="'+xmlEsc(lang)+'"><head><meta charset="UTF-8"/><title>'+xmlEsc(t)+'</title>'+extraHead+'<link rel="stylesheet" type="text/css" href="style.css"/></head><body>'+body+'</body></html>';
  const addImage=b=>{imgN++;const e=b.mime==='image/png'?'png':'jpg';const href='images/img'+imgN+'.'+e;z.file('OEBPS/'+href,b.bytes);manifest.push('<item id="img'+imgN+'" href="'+href+'" media-type="'+b.mime+'"/>');return href;};
  const hr=rs=>(rs||[]).map(r=>{let t=xmlEsc(r.text).replace(/\n/g,'<br/>');if(r.code)t='<code>'+t+'</code>';if(r.italic)t='<em>'+t+'</em>';if(r.bold)t='<strong>'+t+'</strong>';return t;}).join('');
  if(fixed&&pageImages){
    pageImages.forEach((im,i)=>{const href=addImage(im);const id='p'+(i+1);z.file('OEBPS/'+id+'.xhtml',page('Page '+(i+1),'<div class="page"><img src="'+href+'" alt="Page '+(i+1)+'" style="width:100%;height:100%;object-fit:contain;margin:0"/></div>','<meta name="viewport" content="width='+im.width+', height='+im.height+'"/>'));manifest.push('<item id="'+id+'" href="'+id+'.xhtml" media-type="application/xhtml+xml"/>');spine.push('<itemref idref="'+id+'"/>');toc.push({href:id+'.xhtml',label:'Page '+(i+1)});});
  }else{
    // split into chapters at level-1 headings or explicit page breaks
    const chapters=[];let cur={title:'',blocks:[]};const push=()=>{if(cur.blocks.length)chapters.push(cur);cur={title:'',blocks:[]};};
    const onlyImages=()=>cur.blocks.length&&cur.blocks.every(x=>x.type==='image');
    for(const b of model.blocks){if(b.type==='pagebreak'){push();continue;}if(b.type==='heading'&&b.level===1&&cur.blocks.length&&!onlyImages())push();if(b.type==='slide'&&cur.blocks.length)push();if(!cur.title&&(b.type==='heading'||b.type==='slide'))cur.title=b.type==='slide'?b.title:runsText(b.runs);cur.blocks.push(b);}
    push();if(!chapters.length)chapters.push({title,blocks:[{type:'para',runs:plainRuns('')}]});
    chapters.forEach((ch,i)=>{let body='';for(const b of ch.blocks){
        if(b.type==='heading'){const id='h'+i+'_'+body.length;body+='<h'+b.level+' id="'+id+'">'+hr(b.runs)+'</h'+b.level+'>';}
        else if(b.type==='para')body+='<p>'+hr(b.runs)+'</p>';
        else if(b.type==='list'){const tag=b.ordered?'ol':'ul';body+='<'+tag+'>'+b.items.map(it=>'<li'+(it.level?' style="margin-left:'+(it.level*1.2)+'em"':'')+'>'+hr(it.runs)+'</li>').join('')+'</'+tag+'>';}
        else if(b.type==='code')body+='<pre><code>'+xmlEsc(b.text)+'</code></pre>';
        else if(b.type==='table')body+='<table>'+b.rows.map((r,ri)=>'<tr>'+r.map(c=>(b.header&&ri===0?'<th>':'<td>')+xmlEsc(c)+(b.header&&ri===0?'</th>':'</td>')).join('')+'</tr>').join('')+'</table>';
        else if(b.type==='image'&&b.bytes){const href=addImage(b);body+='<figure><img src="'+href+'" alt="'+xmlEsc(b.alt||'')+'"/></figure>';}
        else if(b.type==='slide')body+='<h2>'+xmlEsc(b.title||'Slide')+'</h2><ul>'+b.items.map(it=>'<li>'+xmlEsc(it.text)+'</li>').join('')+'</ul>';}
      const id='c'+(i+1);z.file('OEBPS/'+id+'.xhtml',page(ch.title||('Chapter '+(i+1)),body));manifest.push('<item id="'+id+'" href="'+id+'.xhtml" media-type="application/xhtml+xml"/>');spine.push('<itemref idref="'+id+'"/>');toc.push({href:id+'.xhtml',label:ch.title||('Chapter '+(i+1))});});
  }
  z.file('OEBPS/nav.xhtml',page('Contents','<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>'+toc.map(t=>'<li><a href="'+t.href+'">'+xmlEsc(t.label)+'</a></li>').join('')+'</ol></nav>'));
  z.file('OEBPS/toc.ncx','<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="'+uid+'"/><meta name="dtb:depth" content="1"/></head><docTitle><text>'+xmlEsc(title)+'</text></docTitle><navMap>'+toc.map((t,i)=>'<navPoint id="n'+(i+1)+'" playOrder="'+(i+1)+'"><navLabel><text>'+xmlEsc(t.label)+'</text></navLabel><content src="'+t.href+'"/></navPoint>').join('')+'</navMap></ncx>');
  const cover=fixed&&pageImages?'<meta name="cover" content="img1"/>':'';
  z.file('OEBPS/content.opf','<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="'+xmlEsc(lang)+'"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">'+uid+'</dc:identifier><dc:title>'+xmlEsc(title)+'</dc:title><dc:creator>'+xmlEsc(author)+'</dc:creator><dc:language>'+xmlEsc(lang)+'</dc:language><meta property="dcterms:modified">'+new Date().toISOString().replace(/\.\d+Z$/,'Z')+'</meta>'+(fixed?'<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">auto</meta>':'')+cover+'</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>'+manifest.join('')+'</manifest><spine toc="ncx">'+spine.join('')+'</spine></package>');
  return z.generateAsync({type:'blob',mimeType:'application/epub+zip',compression:'DEFLATE'});
}

/* ---------- CBZ comics ---------- */
async function readCbz(file){const z=await JSZip.loadAsync(await file.arrayBuffer());const names=Object.keys(z.files).filter(n=>!z.files[n].dir&&/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(n)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));if(!names.length)throw new Error('No images found in the comic archive.');const pages=[];for(const n of names){const im=await normalizeImage(await z.file(n).async('uint8array'),MIME[ext(n)]);if(im)pages.push(im);}return pages;}

/* ---------- PDF pages as images ---------- */
async function pdfPagesToImages(pdfBytes,scale=2,onProgress){const pdf=await pdfjsLib.getDocument({data:pdfBytes}).promise;const out=[];for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const vp=p.getViewport({scale});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);await p.render({canvasContext:g,viewport:vp}).promise;const b=await new Promise(r=>c.toBlob(r,'image/jpeg',0.9));out.push({bytes:new Uint8Array(await b.arrayBuffer()),mime:'image/jpeg',width:c.width,height:c.height});if(onProgress)onProgress(i,pdf.numPages);if(p.cleanup)p.cleanup();}return out;}

/* ---------- unified ebook read / write ---------- */
async function readEbook(file){const e=ext(file.name);
  if(e==='epub')return readEpub(file);
  if(e==='fb2'||e==='fbz')return readFb2(file);
  if(e==='cbz'){const pages=await readCbz(file);return {title:base(file.name),pages,blocks:pages.map((p,i)=>i?[{type:'pagebreak'},{type:'image',...p}]:[{type:'image',...p}]).flat()};}
  const m=await D().readDocument(file);if(m){const h=m.blocks.find(b=>b.type==='heading');m.title=m.title||(h?runsText(h.runs).trim():'')||base(file.name);return m;}return null;}
const EBOOK_IN=new Set(['epub','fb2','fbz','cbz','docx','docm','odt','html','htm','xhtml','txt','md','rtf']);
const EBOOK_OUT=new Set(['epub','pdf','docx','txt','fb2','rtf','htmlz','zip','odt']);
async function writeEbook(model,target,name){
  const t=target.toLowerCase(),b=safeName(name);
  if(t==='epub'){if(model.pages)return {blob:await writeEpub(model,{fixed:true,pageImages:model.pages}),name:b+'.epub'};return {blob:await writeEpub(model,{}),name:b+'.epub'};}
  if(t==='fb2')return {blob:new Blob([writeFb2(model)],{type:'application/x-fictionbook+xml'}),name:b+'.fb2'};
  if(t==='rtf')return {blob:new Blob([writeRtf(model)],{type:'application/rtf'}),name:b+'.rtf'};
  if(t==='htmlz'||t==='zip'){const z=new JSZip();let n=0;const m={...model,blocks:model.blocks.map(x=>x)};let html=D().writeHtml({...m,blocks:m.blocks.filter(x=>x.type!=='image')});
    // keep images: write them beside index.html and reference them in order
    const imgs=m.blocks.filter(x=>x.type==='image'&&x.bytes);if(imgs.length){let parts='';imgs.forEach(im=>{n++;const f='images/img'+n+'.'+(im.mime==='image/png'?'png':'jpg');z.file(f,im.bytes);parts+='<figure><img src="'+f+'" style="max-width:100%"/></figure>';});html=html.replace('</body>',parts+'</body>');}
    z.file('index.html',html);z.file('metadata.opf','<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'+xmlEsc(model.title||b)+'</dc:title><dc:creator>'+xmlEsc(model.author||'')+'</dc:creator></metadata></package>');
    return {blob:await z.generateAsync({type:'blob'}),name:b+'.'+t};}
  const r=await D().writeDocument(model,t);if(r)return {blob:r.blob,name:b+'.'+r.ext,note:r.note};
  return null;
}
window.OMNI_EPUB={readEpub,readFb2,readCbz,writeEpub,writeFb2,writeRtf,readEbook,writeEbook,pdfPagesToImages};

/* ================= wiring ================= */
function rememberFile(inputId,dropId,cb){const i=$(inputId),d=dropId?$(dropId):i?.closest('.dropzone');i?.addEventListener('change',()=>cb(i.files?.[0]||null));d?.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)cb(f);});}
function intercept(id,handler){const el=$(id);if(!el)return;el.addEventListener('click',async e=>{const plan=handler.plan?handler.plan():true;if(!plan)return;e.stopImmediatePropagation();e.preventDefault();if(el.dataset.omniBusy==='1')return;el.dataset.omniBusy='1';const lbl=el.textContent;el.disabled=true;try{await handler.run(plan);}catch(err){console.error(err);alert((handler.label||'EPUB Studio')+': '+(err.message||err));}finally{el.disabled=false;el.textContent=lbl;delete el.dataset.omniBusy;const pw=$('epubProgressWrapper');if(pw&&handler.progress)setTimeout(()=>{pw.style.display='none';},1500);}},true);}
function progress(pct,text){const w=$('epubProgressWrapper'),b=$('epubProgressBar'),t=$('epubProgressText'),p=$('epubProgressPercent');if(w)w.style.display='block';if(b)b.style.width=pct+'%';if(t)t.textContent=text;if(p)p.textContent=Math.round(pct)+'%';}

// 1. EPUB → PDF / page images / text  (illustration extraction stays with the original handler)
let epubFile=null;rememberFile('epubInput','epubDropzone',f=>epubFile=f);$('epubResetBtn')?.addEventListener('click',()=>{epubFile=null;});
intercept('epubRunBtn',{label:'EPUB Studio',progress:true,plan(){const a=$('epubTargetAction')?.value;return epubFile&&['pdf','txt','jpg_pages'].includes(a)?{a}:null;},async run({a}){
  progress(15,'Reading book in reading order…');const m=await readEpub(epubFile);if(!m.blocks.length)throw new Error('No readable content found in this EPUB.');
  const name=safeName(base(epubFile.name));
  if(a==='txt'){save(new Blob([D().writeText(m)],{type:'text/plain;charset=utf-8'}),name+'.txt');progress(100,'Text exported');notify('Book text exported (all scripts kept).');return;}
  progress(45,'Typesetting PDF…');const r=await D().writePdf({title:m.title,blocks:m.blocks});
  if(a==='pdf'){save(r.blob,name+'.pdf');progress(100,'PDF ready');notify('PDF created • '+r.pages+' pages');return;}
  progress(70,'Rendering pages to JPG…');const imgs=await pdfPagesToImages(new Uint8Array(await r.blob.arrayBuffer()),2,(i,n)=>progress(70+25*i/n,'Rendering page '+i+' of '+n+'…'));
  const z=new JSZip();imgs.forEach((im,i)=>z.file(name+'_page_'+String(i+1).padStart(3,'0')+'.jpg',im.bytes));save(await z.generateAsync({type:'blob'}),name+'_pages.zip');progress(100,'Pages ready');notify(imgs.length+' page images created.');
}});

// 2. PDF → EPUB (three real modes)
let p2eFile=null;rememberFile('p2eInput','p2eDropzone',f=>p2eFile=f);$('p2eResetBtn')?.addEventListener('click',()=>{p2eFile=null;});
intercept('p2eRunBtn',{label:'PDF → EPUB',plan(){return p2eFile?{}:null;},async run(){
  const mode=$('p2eMode')?.value||'illustrated',title=($('p2eTitle')?.value||'').trim()||base(p2eFile.name),author=($('p2eAuthor')?.value||'').trim()||'Unknown';
  const btn=$('p2eRunBtn');btn.textContent='Generating EPUB…';const bytes=new Uint8Array(await p2eFile.arrayBuffer());let blob;
  if(mode==='fixed'){const pages=await pdfPagesToImages(bytes.slice(),2);blob=await writeEpub({title,blocks:[]},{title,author,fixed:true,pageImages:pages});}
  else if(mode==='reflow'){const m=await D().pdfToModel(new File([bytes],p2eFile.name));blob=await writeEpub(m,{title,author});}
  else{const m=await D().pdfToModel(new File([bytes],p2eFile.name),{images:true,text:true});blob=await writeEpub(m,{title,author});}
  save(blob,safeName(title)+'.epub');notify(mode==='fixed'?'Fixed-layout EPUB created (exact page spreads).':mode==='reflow'?'Reflowable EPUB created (clean text).':'Illustrated EPUB created (page snapshots + reflowable text).');
}});

// 3. Native ebook converter
let nativeFile=null;rememberFile('ebookNativeInput','ebookNativeDropzone',f=>nativeFile=f);$('ebookNativeReset')?.addEventListener('click',()=>{nativeFile=null;});
intercept('ebookNativeRun',{label:'Ebook Studio',plan(){const t=$('ebookNativeTarget')?.value;if(!nativeFile)return null;const e=ext(nativeFile.name);return EBOOK_IN.has(e)&&EBOOK_OUT.has(t)&&!(e===t&&e!=='epub')?{t}:null;},async run({t}){
  const btn=$('ebookNativeRun');btn.textContent='Converting…';const m=await readEbook(nativeFile);if(!m||!(m.blocks?.length||m.pages?.length))throw new Error('No readable content found in '+nativeFile.name+'.');
  m.title=m.title||base(nativeFile.name);const out=await writeEbook(m,t,base(nativeFile.name));if(!out)throw new Error(t.toUpperCase()+' output needs the Local Engine (Calibre).');
  save(out.blob,out.name);notify('Converted to '+t.toUpperCase()+' in your browser.'+(out.note?' '+out.note:''));
}});
})();
