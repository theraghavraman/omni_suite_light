/* Omni Suite — Compressor upgrades (runs entirely in the browser).
 * 7-Zip compiled to WebAssembly (7z-wasm, in a background worker) adds 7z, password-protected
 * ZIP (AES-256), TAR, TAR.GZ, TAR.XZ, TAR.BZ2, BZIP2 and XZ creation, and extraction of 7z, RAR,
 * TAR, XZ, BZIP2, CAB, ISO and more — no Local Engine needed. Folders keep their structure.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const notify=(m,e)=>{if(window.omniNotify)window.omniNotify(m,e);};
const fmtSize=b=>b>=1073741824?(b/1073741824).toFixed(2)+' GB':b>=1048576?(b/1048576).toFixed(2)+' MB':b>=1024?(b/1024).toFixed(1)+' KB':b+' B';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const SZ_URL='https://cdn.jsdelivr.net/npm/7z-wasm@1.2.0/7zz.es6.js';

/* ---------------- 7-Zip worker ---------------- */
const WORKER_SRC=`import SevenZip from '${SZ_URL}';
function mkdirp(z,p){const parts=p.split('/').filter(Boolean);let cur='';for(const s of parts){cur+='/'+s;try{z.FS.mkdir(cur);}catch(_){}}}
function walk(z,dir,rel,out){for(const n of z.FS.readdir(dir)){if(n==='.'||n==='..')continue;const p=dir+'/'+n,r=rel?rel+'/'+n:n;const st=z.FS.stat(p);if(z.FS.isDir(st.mode))walk(z,p,r,out);else{const d=z.FS.readFile(p);out.push({path:r,data:d.buffer});}}}
self.onmessage=async e=>{const {id,files,cmds,collect}=e.data;const log=[];
  try{const z=await SevenZip({print:t=>log.push(t),printErr:t=>log.push(t)});
    for(const f of files){const i=f.path.lastIndexOf('/');if(i>0)mkdirp(z,f.path.slice(0,i));z.FS.writeFile(f.path,new Uint8Array(f.data));f.data=null;}
    const codes=[];for(const c of cmds){if(c.mkdir){mkdirp(z,c.mkdir);continue;}if(c.chdir){z.FS.chdir(c.chdir);continue;}let rc;try{rc=z.callMain(c.args);}catch(err){rc=typeof err?.status==='number'?err.status:99;log.push(String(err&&err.message||err));}codes.push(rc);if(rc!==0&&rc!==1)break;}
    const out=[];for(const c of collect||[]){try{const st=z.FS.stat(c);if(z.FS.isDir(st.mode))walk(z,c,'',out);else out.push({path:c.split('/').pop(),data:z.FS.readFile(c).buffer});}catch(_){}}
    self.postMessage({id,ok:codes.every(x=>x===0||x===1),codes,log,out},out.map(o=>o.data));
  }catch(err){self.postMessage({id,ok:false,error:String(err&&err.message||err),log});}};`;
let wurl=null;
async function run7z(files,cmds,collect){
  const payload=[];for(const f of files)payload.push({path:f.path,data:await f.file.arrayBuffer()});
  if(!wurl)wurl=URL.createObjectURL(new Blob([WORKER_SRC],{type:'text/javascript'}));
  return new Promise((res,rej)=>{let w;try{w=new Worker(wurl,{type:'module'});}catch(err){rej(new Error('Background workers are blocked in this browser.'));return;}
    const id=Math.random();w.onmessage=e=>{w.terminate();const r=e.data;if(r.error)rej(new Error(/fetch|import|load/i.test(r.error)?'Could not load the 7-Zip engine — check your internet connection.':r.error));else res(r);};
    w.onerror=e=>{w.terminate();rej(new Error('Could not start the 7-Zip engine'+(e.message?': '+e.message:'.')));};
    w.postMessage({id,files:payload,cmds,collect},payload.map(p=>p.data));});
}
const errText=r=>{const l=(r.log||[]).filter(x=>/error|wrong|cannot|unsupported|not.*archive/i.test(x)).map(x=>x.replace(/^ERROR:\s*/,'')).filter(x=>x.trim()&&!/^\/(in|x|src)\//.test(x));return l.slice(0,3).join(' ')||'7-Zip exit code '+(r.codes||[]).join(',');};
const needsPassword=r=>(r.log||[]).some(x=>/wrong password|encrypted|enter password/i.test(x));

/* ---------------- selection with folders ---------------- */
const entryPath=f=>(f.omniPath||f.webkitRelativePath||f.name).replace(/^\/+/,'');
async function filesFromDrop(dt){const items=[...(dt.items||[])].map(i=>i.webkitGetAsEntry&&i.webkitGetAsEntry()).filter(Boolean);if(!items.length)return [...(dt.files||[])];
  const out=[];const readAll=r=>new Promise(res=>{const all=[];const next=()=>r.readEntries(b=>{if(!b.length)res(all);else{all.push(...b);next();}},()=>res(all));next();});
  async function visit(en,prefix){if(en.isFile){const f=await new Promise((res,rej)=>en.file(res,rej));try{Object.defineProperty(f,'omniPath',{value:prefix+f.name});}catch(_){}out.push(f);}else if(en.isDirectory){for(const c of await readAll(en.createReader()))await visit(c,prefix+en.name+'/');}}
  for(const en of items)await visit(en,'');return out;}

/* ================= compress ================= */
const fmtSel=$('compressFormat'),lvlSel=$('compressLevel'),cIn=$('compressInput'),cBtn=$('compressBtn');
let cFiles=[];
if(fmtSel&&!fmtSel.querySelector('option[value="7z"]')){
  fmtSel.innerHTML=`<optgroup label="Many files / folders"><option value="zip" selected>ZIP — opens everywhere</option><option value="7z">7z — smallest archives</option><option value="tar.gz">TAR.GZ (.tgz)</option><option value="tar.xz">TAR.XZ</option><option value="tar.bz2">TAR.BZ2</option><option value="tar">TAR (no compression)</option></optgroup>
  <optgroup label="Single file"><option value="gzip">GZIP (.gz)</option><option value="xz">XZ (.xz)</option><option value="bzip2">BZIP2 (.bz2)</option><option value="deflate">DEFLATE (raw)</option>${(()=>{try{new CompressionStream('br');return '<option value="brotli">Brotli (.br)</option>';}catch(_){return '';}})()}</optgroup>`;
  const grid=fmtSel.closest('.options-grid');
  const extra=document.createElement('div');extra.className='form-group';extra.innerHTML='<label for="compressPassword">Password (ZIP / 7z, optional)</label><input type="password" id="compressPassword" class="form-input" autocomplete="new-password" placeholder="Leave empty for no encryption"><label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:6px"><input type="checkbox" id="compressHideNames" checked> Also hide file names (7z only)</label>';
  const nameG=document.createElement('div');nameG.className='form-group';nameG.innerHTML='<label for="compressName">Archive name</label><input type="text" id="compressName" class="form-input" placeholder="compressed_files">';
  grid.append(nameG,extra);
  const sub=document.querySelector('#tabCompress .card .sub');if(sub)sub.textContent='Create ZIP, 7z, TAR, TAR.GZ, TAR.XZ, TAR.BZ2, GZIP, XZ and BZIP2 archives right in your browser — with AES-256 passwords for ZIP and 7z, and folders kept intact. Nothing is uploaded.';
  const dz=$('compressDropzone');const p=dz?.querySelector('p');if(p)p.textContent='Select files, or drop whole folders — their structure is kept. Single-file formats wrap several files in a TAR first.';
  if(dz&&!$('compressFolderBtn')){const b=document.createElement('button');b.type='button';b.id='compressFolderBtn';b.className='btn-reset';b.style.marginTop='10px';b.textContent='📁 Choose a folder instead';const fi=document.createElement('input');fi.type='file';fi.webkitdirectory=true;fi.multiple=true;fi.style.display='none';fi.id='compressFolderInput';dz.append(b,fi);
    b.addEventListener('click',e=>{e.stopPropagation();fi.click();});fi.addEventListener('click',e=>e.stopPropagation());fi.addEventListener('change',()=>{if(fi.files?.length)pick([...fi.files]);});}
  if(cBtn)cBtn.textContent='🗜️ Create Archive';
}
function pick(list){cFiles=[...list];if(!cFiles.length)return;setTimeout(()=>{const dz=$('compressDropzone'),ct=$('compressControls');if(dz)dz.style.display='none';if(ct)ct.style.display='flex';const s=$('compressSummary');
  if(s)s.textContent=cFiles.length+' file'+(cFiles.length===1?'':'s')+' selected'+(cFiles.some(f=>entryPath(f).includes('/'))?' (with folders)':'');updateMeta();const nm=$('compressName');if(nm&&!nm.value){const top=entryPath(cFiles[0]).split('/');nm.placeholder=cFiles.length===1?cFiles[0].name.replace(/\.[^.]+$/,''):top.length>1&&cFiles.every(f=>entryPath(f).split('/')[0]===top[0])?top[0]:'compressed_files';}},0);}
function updateMeta(){const m=$('compressMeta');if(!m||!cFiles.length)return;const f=fmtSel.value,single=['gzip','xz','bzip2','deflate','brotli'].includes(f);const total=cFiles.reduce((n,x)=>n+x.size,0);
  m.textContent=cFiles.length+' file(s) • '+fmtSize(total)+(single&&cFiles.length>1?(f==='deflate'||f==='brotli'?' • this format holds one file — only the first is used':' • several files will be packed into a TAR first'):'')+(total>1.5*1073741824?' • very large: may run out of browser memory':'');
  const pw=$('compressPassword');if(pw){const ok=f==='zip'||f==='7z';pw.disabled=!ok;pw.closest('.form-group').style.opacity=ok?'':'.5';}}
cIn?.addEventListener('change',()=>pick(cIn.files||[]));
$('compressDropzone')?.addEventListener('drop',async e=>{const dt=e.dataTransfer;if(!dt)return;const files=await filesFromDrop(dt);if(files.length)pick(files);});
fmtSel?.addEventListener('change',updateMeta);
$('compressReset')?.addEventListener('click',()=>{cFiles=[];});
const LVL={0:0,1:1,3:3,6:5,9:9};
cBtn?.addEventListener('click',async e=>{
  if(!cFiles.length)return;e.stopImmediatePropagation();e.preventDefault();if(cBtn.dataset.busy)return;cBtn.dataset.busy='1';cBtn.disabled=true;
  const pw=$('compressProgress'),bar=$('compressProgressBar'),pt=$('compressProgressText'),pp=$('compressProgressPercent');const prog=(p,t)=>{if(pw)pw.style.display='block';const v=Math.round(p);if(bar)bar.style.width=v+'%';if(pp)pp.textContent=v+'%';if(pt&&t)pt.textContent=t;};
  const fmt=fmtSel.value,lvl=LVL[lvlSel?.value??6]??5,pass=($('compressPassword')?.value||'');const total=cFiles.reduce((n,x)=>n+x.size,0);
  const nm=($('compressName')?.value||$('compressName')?.placeholder||'compressed_files').trim().replace(/[\\/:*?"<>|]+/g,'_')||'compressed_files';
  const t0=performance.now();
  try{let blob,name;
    // unique archive paths
    const seen=new Set();const items=cFiles.map(f=>{let p=entryPath(f),k=2;while(seen.has(p)){p=entryPath(f).replace(/(\.[^./]+)?$/,'_'+(k++)+'$1');}seen.add(p);return {path:p,file:f};});
    if(fmt==='zip'&&!pass){if(!window.JSZip)throw new Error('ZIP engine is unavailable.');const z=new JSZip();items.forEach(it=>z.file(it.path,it.file,{date:new Date(it.file.lastModified||Date.now())}));
      blob=await z.generateAsync({type:'blob',compression:lvl===0?'STORE':'DEFLATE',compressionOptions:{level:Math.max(1,+lvlSel.value||6)}},m=>prog(m.percent,'Building ZIP…'));name=nm+'.zip';}
    else if((fmt==='gzip'||fmt==='deflate'||fmt==='brotli')&&(items.length===1||fmt!=='gzip')){const f=items[0].file;const sf=fmt==='gzip'?'gzip':fmt==='deflate'?'deflate':'br';prog(30,'Compressing…');
      blob=await new Response(f.stream().pipeThrough(new CompressionStream(sf))).blob();name=f.name+(fmt==='gzip'?'.gz':fmt==='deflate'?'.deflate':'.br');}
    else{prog(10,'Loading 7-Zip…');const files=items.map(it=>({path:'/in/'+it.path,file:it.file}));const tops=[...new Set(items.map(it=>it.path.split('/')[0]))];
      const pwArgs=pass?['-p'+pass]:[];const cmds=[{mkdir:'/in'},{chdir:'/in'}];let outPath,outName;
      if(fmt==='zip'){outPath='/out.zip';cmds.push({args:['a','-tzip','-mx='+lvl,...pwArgs,...(pass?['-mem=AES256']:[]),outPath,...tops]});outName=nm+'.zip';}
      else if(fmt==='7z'){outPath='/out.7z';cmds.push({args:['a','-t7z','-mx='+lvl,...pwArgs,...(pass&&$('compressHideNames')?.checked?['-mhe=on']:[]),outPath,...tops]});outName=nm+'.7z';}
      else if(fmt==='tar'){outPath='/out.tar';cmds.push({args:['a','-ttar',outPath,...tops]});outName=nm+'.tar';}
      else if(fmt.startsWith('tar.')||items.length>1){const kind=fmt.startsWith('tar.')?fmt.slice(4):fmt==='gzip'?'gz':fmt==='bzip2'?'bz2':'xz';const t=kind==='gz'?'gzip':kind==='bz2'?'bzip2':'xz';
        cmds.push({mkdir:'/tmp'},{args:['a','-ttar','/tmp/'+nm+'.tar',...tops]},{chdir:'/'},{args:['a','-t'+t,'-mx='+Math.max(1,lvl),'/out.'+kind,'/tmp/'+nm+'.tar']});outPath='/out.'+kind;outName=nm+'.tar.'+kind;}
      else{const kind=fmt==='xz'?'xz':fmt==='bzip2'?'bz2':'gz';const t=kind==='gz'?'gzip':kind==='bz2'?'bzip2':'xz';cmds.push({args:['a','-t'+t,'-mx='+Math.max(1,lvl),'/out.'+kind,items[0].path]});outPath='/out.'+kind;outName=items[0].file.name+'.'+kind;}
      prog(35,'Compressing with 7-Zip…');const r=await run7z(files,cmds,[outPath]);if(!r.ok||!r.out.length)throw new Error(errText(r));
      blob=new Blob([r.out[0].data],{type:'application/octet-stream'});name=outName;}
    save(blob,name);const ratio=total?Math.round((1-blob.size/total)*100):0;
    prog(100,'Done • '+fmtSize(total)+' → '+fmtSize(blob.size)+(ratio>0?' ('+ratio+'% smaller)':''));notify('Created '+name+' • '+fmtSize(blob.size)+(pass&&(fmt==='zip'||fmt==='7z')?' • AES-256 encrypted':'')+' • '+((performance.now()-t0)/1000).toFixed(1)+' s');
  }catch(err){console.error(err);alert('Compression error: '+(err.message||err));prog(0,'Compression failed');}
  finally{cBtn.disabled=false;delete cBtn.dataset.busy;}
},true);

/* ================= decompress ================= */
const dIn=$('decompressInput'),dBtn=$('decompressBtn'),dList=$('decompressList'),dSaveAll=$('decompressSaveAll');let dFile=null,items=[];
if(dIn)dIn.setAttribute('accept','');
const dSub=$('decompressDropzone')?.closest('.card')?.querySelector('.sub');if(dSub)dSub.textContent='Extract ZIP, 7z, RAR, TAR, TAR.GZ/TGZ, TAR.XZ, TAR.BZ2, GZIP, XZ, BZIP2, CAB, ISO and more in your browser — including password-protected archives. Folder structure is kept.';
const dH=$('decompressDropzone')?.querySelector('h3');if(dH)dH.textContent='Drop a ZIP / 7z / RAR / TAR / GZ / XZ / BZ2 file';
if(dBtn&&!$('decompressPassword')){const w=document.createElement('div');w.className='form-group';w.id='decompressPasswordWrap';w.style.cssText='display:none;width:100%;margin:6px 0';w.innerHTML='<label for="decompressPassword">This archive is password-protected</label><input type="password" id="decompressPassword" class="form-input" autocomplete="off" placeholder="Enter the password, then press Extract again">';dBtn.parentElement.parentElement.insertBefore(w,dBtn.parentElement);}
dIn?.addEventListener('change',()=>{dFile=dIn.files?.[0]||null;items=[];const pw=$('decompressPasswordWrap');if(pw)pw.style.display='none';});
$('decompressDropzone')?.addEventListener('drop',e=>{dFile=e.dataTransfer?.files?.[0]||dFile;items=[];});
$('decompressReset')?.addEventListener('click',()=>{dFile=null;items=[];});
function addRow(name,blob){const row=document.createElement('div');row.className='item-row';const body=document.createElement('div');const t=document.createElement('div');t.className='item-row-title';t.textContent=name;const m=document.createElement('div');m.className='item-row-meta';m.textContent=fmtSize(blob.size);
  const acts=document.createElement('div');acts.className='item-row-actions';const a=document.createElement('a');a.className='btn-download-single';a.href=URL.createObjectURL(blob);a.download=name.split('/').pop();a.textContent='Save';body.append(t,m);acts.appendChild(a);row.append(body,acts);dList.appendChild(row);}
async function sniff(file){const b=new Uint8Array(await file.slice(0,262).arrayBuffer());const h=(...x)=>x.every((v,i)=>b[i]===v);
  if(h(0x50,0x4b))return 'zip';if(h(0x37,0x7a,0xbc,0xaf))return '7z';if(h(0x52,0x61,0x72,0x21))return 'rar';if(h(0x1f,0x8b))return 'gz';if(h(0xfd,0x37,0x7a,0x58,0x5a))return 'xz';if(h(0x42,0x5a,0x68))return 'bz2';
  if(b[257]===0x75&&b[258]===0x73&&b[259]===0x74&&b[260]===0x61&&b[261]===0x72)return 'tar';return '';}
dBtn?.addEventListener('click',async e=>{
  if(!dFile)return;const lower=dFile.name.toLowerCase();
  if(/\.(br|deflate)$/.test(lower))return; // raw streams: keep the built-in stream decompressor
  e.stopImmediatePropagation();e.preventDefault();if(dBtn.dataset.busy)return;dBtn.dataset.busy='1';dBtn.disabled=true;const label=dBtn.textContent;dBtn.textContent='Extracting…';
  dList.innerHTML='';items=[];if(dSaveAll)dSaveAll.style.display='none';
  try{const kind=await sniff(dFile);const pass=$('decompressPassword')?.value||'';const src='/src/'+(dFile.name.replace(/[\/\\]/g,'_')||'archive');
    const r=await run7z([{path:src,file:dFile}],[{mkdir:'/x'},{args:['x','-o/x','-y','-p'+pass,src]}],['/x']);
    if(!r.ok){if(needsPassword(r)){const w=$('decompressPasswordWrap');if(w)w.style.display='';throw new Error(pass?'Wrong password — please try again.':'This archive is password-protected. Type the password above and press Extract again.');}throw new Error(errText(r)+(kind?'':' — this does not look like an archive 7-Zip can open.'));}
    let out=r.out;
    // tar.gz / tar.xz / tar.bz2: unpack the inner TAR too
    if(out.length===1&&/\.tar$/i.test(out[0].path)||out.length===1&&['gz','xz','bz2'].includes(kind)&&/\.(tgz|tbz2?|txz)$/i.test(lower)){
      const inner=new File([out[0].data],out[0].path.split('/').pop());const r2=await run7z([{path:'/src/inner.tar',file:inner}],[{mkdir:'/x'},{args:['x','-o/x','-y','/src/inner.tar']}],['/x']);if(r2.ok&&r2.out.length)out=r2.out;}
    if(!out.length)throw new Error('The archive is empty.');
    out.sort((a,b)=>a.path.localeCompare(b.path));for(const o of out){const blob=new Blob([o.data]);items.push({name:o.path,blob});addRow(o.path,blob);}
    const total=items.reduce((n,x)=>n+x.blob.size,0);const m=$('decompressMeta');if(m)m.textContent=items.length+' file'+(items.length===1?'':'s')+' extracted • '+fmtSize(total);
    if(dSaveAll){dSaveAll.style.display=items.length>1?'inline-flex':'none';}const w=$('decompressPasswordWrap');if(w&&!pass)w.style.display='none';
    notify('Extracted '+items.length+' file'+(items.length===1?'':'s')+' • '+fmtSize(total));
  }catch(err){console.error(err);alert('Decompression error: '+(err.message||err));}
  finally{dBtn.disabled=false;dBtn.textContent=label;delete dBtn.dataset.busy;}
},true);
dSaveAll?.addEventListener('click',async e=>{if(!items.length||!window.JSZip)return;e.stopImmediatePropagation();e.preventDefault();const z=new JSZip();items.forEach(i=>z.file(i.name,i.blob));save(await z.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}}),(dFile?.name||'extracted').replace(/(\.tar)?\.[^.]+$/i,'')+'_extracted.zip');},true);

/* ================= native archive bridge → browser ================= */
const nIn=$('archiveNativeInput'),nRun=$('archiveNativeRun'),nT=$('archiveNativeTarget');let nFile=null;
const nSub=document.querySelector('#archiveNativeBridge .sub');if(nSub)nSub.textContent='Package a single file as ZIP, TAR, GZIP, BZIP2, XZ or 7z — now done in your browser with 7-Zip (WebAssembly). The Local Engine is only used if the browser engine cannot load.';
const nP=$('archiveNativeDropzone')?.querySelector('p');if(nP)nP.textContent='Runs in your browser • nothing is uploaded';
if(nRun)nRun.textContent='Compress';
nIn?.addEventListener('change',()=>{nFile=nIn.files?.[0]||null;});$('archiveNativeDropzone')?.addEventListener('drop',e=>{nFile=e.dataTransfer?.files?.[0]||nFile;});$('archiveNativeReset')?.addEventListener('click',()=>{nFile=null;});
let nPass=false;
nRun?.addEventListener('click',async e=>{
  if(nPass||!nFile)return;const t=nT?.value||'zip';e.stopImmediatePropagation();e.preventDefault();if(nRun.dataset.busy)return;nRun.dataset.busy='1';nRun.disabled=true;const label=nRun.textContent;nRun.textContent='Compressing…';let fallback=false;
  try{const type={zip:'zip',tar:'tar',gz:'gzip',bz2:'bzip2',xz:'xz','7z':'7z'}[t];const name=nFile.name.replace(/[\/\\]/g,'_');
    const r=await run7z([{path:'/in/'+name,file:nFile}],[{chdir:'/in'},{args:['a','-t'+type,'/out.'+t,name]}],['/out.'+t]);if(!r.ok||!r.out.length)throw new Error(errText(r));
    const blob=new Blob([r.out[0].data]);save(blob,(['gz','bz2','xz'].includes(t)?nFile.name:nFile.name.replace(/\.[^.]+$/,''))+'.'+t);notify('Created '+t.toUpperCase()+' in your browser • '+fmtSize(nFile.size)+' → '+fmtSize(blob.size));}
  catch(err){console.warn(err);fallback=/load|worker/i.test(err.message||'');if(!fallback)alert('Compression error: '+(err.message||err));}
  finally{nRun.disabled=false;nRun.textContent=label;delete nRun.dataset.busy;}
  if(fallback){nPass=true;try{notify('Browser 7-Zip unavailable — trying the Local Engine.');nRun.click();}finally{nPass=false;}}
},true);
window.OMNI_ARCHIVE={run7z,sniff};
})();
