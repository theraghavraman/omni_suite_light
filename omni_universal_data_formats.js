(function(){
'use strict';
if(window.__OMNI_UDS_FORMAT_LAYER)return;
window.__OMNI_UDS_FORMAT_LAYER=true;

const REGISTRY=[
['Tabular & text','csv,tsv,txt,text,log,out,md,markdown,json,jsonl,ndjson,yaml,yml,toml,xml,html,htm,sql,ddl,dml'],
['Geospatial','geojson,gpx,kml,topojson,fgb,flatgeobuf,shp,dbf,prj,gpkg,mbtiles,pmtiles,pbf,nmea,igc,hgt,tif,tiff'],
['Bio / genomics','fasta,fa,fna,fastq,fq,vcf,gff,gff3,gtf,bed,sam,bam,newick,nwk,pdb,ent,cif,mmcif,xyz,sdf,mol,smiles,jdx,jcamp'],
['Brain / medical / signals','edf,bdf,nii,nwb,fif,wfdb,hea,scp,ecg,set,vhdr,vmrk,eeg,dcm,dicom,ome.tif,ome.tiff'],
['Science / Earth / space','fits,cdf,nc,netcdf,h5,hdf,hdf5,grib,grib2,bufr,metar,taf,mseed,segy,las,laz,tle'],
['Audio / radio / music','wav,flac,ogg,oga,mp3,m4a,aac,webm,mid,midi,musicxml,abc,mod,xm,it,sf2,sigmf,iq'],
['Machine / vehicle / fitness','bag,mcap,asc,blf,can,fit,tcx,gcode,hex,srec,s19,s28,s37'],
['Network / forensics','pcap,pcapng,evtx,zeek,har,cookie,cookies,sqlite,db'],
['Columnar / containers','parquet,arrow,ipc,feather,avro,orc,zarr,npy,npz,mat,msgpack,mpk,cbor,protobuf,proto'],
['3D / imaging / CAD','ply,pcd,gltf,glb,stl,obj,exr,hdr,pbm,pgm,ppm,png,jpg,jpeg,webp,bmp,dxf,ger,gerber,kicad_pcb,kicad_sch'],
['Documents / archive','epub,fb2,djvu,rtf,opml,srt,vtt,ass,ics,vcard,gedcom,bib,ris,tei,conllu,zip,tar,gz,zst,zstd,7z'],
['Fonts / graphs / math / games','ttf,otf,woff,woff2,graphml,gexf,dot,gv,tex,latex,tmx,rom']
].map(x=>({category:x[0],exts:x[1].split(',')}));

const allExts=[...new Set(REGISTRY.flatMap(x=>x.exts))];
const browserOpen=new Set('csv tsv txt text log out md markdown json jsonl ndjson yaml yml toml xml html htm sql geojson gpx kml topojson fasta fa fna fastq fq vcf gff gff3 gtf bed newick nwk pdb ent cif mmcif xyz sdf mol smiles srt vtt ass ics vcard gedcom bib ris tei conllu png jpg jpeg webp gif bmp svg tif tiff wav mp3 ogg oga flac m4a aac webm zip hex base64 bin dat'.split(' '));
const browserConvert=new Set('csv tsv json jsonl ndjson yaml yml xml html md txt geojson gpx kml fasta fa fna fastq fq vcf gff gff3 gtf bed newick nwk pdb cif mmcif xyz smiles hex base64 bin png jpg jpeg webp bmp'.split(' '));
const imageExt=new Set('png jpg jpeg webp bmp gif tif tiff'.split(' '));
const audioExt=new Set('wav mp3 ogg oga flac m4a aac webm'.split(' '));
const videoExt=new Set('mp4 mkv mov avi webm'.split(' '));
const textExt=new Set('txt text log out md markdown json jsonl ndjson yaml yml toml xml html htm sql ddl dml csv tsv geojson gpx kml fasta fa fna fastq fq vcf gff gff3 gtf bed newick nwk pdb ent cif mmcif xyz sdf mol smiles srt vtt ass ics vcard gedcom bib ris tei conllu hex base64'.split(' '));

let currentFile=null,currentParsed=null,currentObjectUrl=null;
const $=id=>document.getElementById(id);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function ext(name){const n=name.toLowerCase();if(n.endsWith('.nii.gz'))return'nii.gz';if(n.endsWith('.tar.gz'))return'tar.gz';if(n.endsWith('.ome.tiff'))return'ome.tiff';if(n.endsWith('.ome.tif'))return'ome.tif';const p=n.split('.');return p.length>1?p.pop():''}
function size(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';if(n<1073741824)return(n/1048576).toFixed(2)+' MB';return(n/1073741824).toFixed(2)+' GB'}
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500)}
function parseCsv(text,sep){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(q&&text[i+1]==='"'){cell+='"';i++}else q=!q}else if(c===sep&&!q){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(x=>x!==''))rows.push(row);row=[]}else cell+=c}if(cell!==''||row.length){row.push(cell);if(row.some(x=>x!==''))rows.push(row)}const h=rows.shift()||[];return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k||'column_'+(i+1),r[i]??''])))} 
function flatten(v,p='',out={}){if(v&&typeof v==='object'&&!Array.isArray(v))Object.entries(v).forEach(([k,x])=>flatten(x,p?p+'.'+k:k,out));else out[p]=v;return out}
function toRows(v){if(Array.isArray(v))return v.map(x=>x&&typeof x==='object'?flatten(x):{value:x});if(v&&typeof v==='object')return[flatten(v)];return[{value:v}]}
function rowsToCsv(rows,sep=','){const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))],q=x=>'"'+String(x??'').replace(/"/g,'""')+'"';return[keys.map(q).join(sep),...rows.map(r=>keys.map(k=>q(r[k])).join(sep))].join('\n')}
function rowsToXml(rows){return'<?xml version="1.0" encoding="UTF-8"?><rows>'+rows.map(r=>'<row>'+Object.entries(r).map(([k,v])=>{const n=String(k).replace(/[^A-Za-z0-9_.-]/g,'_');return'<'+n+'>'+esc(v)+'</'+n+'>'}).join('')+'</row>').join('')+'</rows>'}
function rowsToHtml(rows){const k=[...new Set(rows.flatMap(r=>Object.keys(r)))];return'<!doctype html><html><body><table><thead><tr>'+k.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+k.map(x=>'<td>'+esc(r[x])+'</td>').join('')+'</tr>').join('')+'</tbody></table></body></html>'}
function rowsToMd(rows){const k=[...new Set(rows.flatMap(r=>Object.keys(r)))];return'| '+k.join(' | ')+' |\n| '+k.map(()=> '---').join(' | ')+' |\n'+rows.map(r=>'| '+k.map(x=>String(r[x]??'').replace(/\|/g,'\\|')).join(' | ')+' |').join('\n')}
function bytesToHex(b){return[...b].map(x=>x.toString(16).padStart(2,'0')).join(' ')}
function bytesToBase64(b){let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode(...b.subarray(i,i+0x8000));return btoa(s)}
function parseNewick(s){let i=0;function node(){const n={name:'',children:[]};while(i<s.length&&!/[(),;:]/.test(s[i]))n.name+=s[i++];if(s[i]==='('){i++;n.children=[];while(i<s.length&&s[i]!==')'){n.children.push(node());if(s[i]===',')i++}if(s[i]===')')i++}if(s[i]===':'){i++;while(i<s.length&&!/[(),;]/.test(s[i]))i++}return n}return node()}
function parseSpecial(text,e){
 if(e==='csv'||e==='tsv')return{kind:'table',rows:parseCsv(text,e==='tsv'?'\t':',')};
 if(e==='json'||e==='geojson'){const v=JSON.parse(text);return{kind:e==='geojson'?'geojson':'table',value:v,rows:toRows(v)}}
 if(e==='jsonl'||e==='ndjson'){return{kind:'table',rows:text.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)).map(x=>x&&typeof x==='object'?flatten(x):{value:x})}}
 if((e==='yaml'||e==='yml')&&window.jsyaml){const v=window.jsyaml.load(text);return{kind:'table',value:v,rows:toRows(v)}}
 if(e==='newick'||e==='nwk')return{kind:'tree',value:parseNewick(text)};
 if(['fasta','fa','fna'].includes(e)){const out=[];let id='',seq='';text.split(/\r?\n/).forEach(l=>{if(l[0]==='>'){if(id)out.push({id,sequence:seq});id=l.slice(1).trim();seq=''}else if(l.trim())seq+=l.trim()});if(id)out.push({id,sequence:seq});return{kind:'table',rows:out}}
 if(['fastq','fq'].includes(e)){const a=text.split(/\r?\n/).filter(Boolean),out=[];for(let i=0;i+3<a.length;i+=4)out.push({id:a[i].replace(/^@/,''),sequence:a[i+1],quality:a[i+3]});return{kind:'table',rows:out}}
 if(e==='vcf'){const ls=text.split(/\r?\n/).filter(x=>x&&!x.startsWith('##')),h=ls.find(x=>x.startsWith('#CHROM')),hs=h?h.slice(1).split('\t'):[];return{kind:'table',rows:ls.filter(x=>!x.startsWith('#')).map(x=>Object.fromEntries(hs.map((k,i)=>[k,x.split('\t')[i]??''])))}} 
 if(['gff','gff3','gtf','bed'].includes(e))return{kind:'table',rows:text.split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>Object.fromEntries(x.split('\t').map((v,i)=>['field_'+(i+1),v])))};
 return{kind:'text',text}
}
function tableHtml(rows){if(!rows.length)return'<div class="uds-xempty">No rows detected.</div>';const k=[...new Set(rows.slice(0,500).flatMap(r=>Object.keys(r)))];return'<div class="uds-xscroll"><table class="uds-x"><thead><tr>'+k.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(0,500).map(r=>'<tr>'+k.map(x=>'<td>'+esc(r[x])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div><div class="uds-xcount">Showing '+Math.min(rows.length,500)+' of '+rows.length+' rows.</div>'}
function geoPoints(v){const o=[];function w(g){if(!g)return;if(g.type==='FeatureCollection')return g.features.forEach(w);if(g.type==='Feature')return w(g.geometry);if(g.type==='GeometryCollection')return g.geometries.forEach(w);if(g.type==='Point')return o.push(g.coordinates);if(g.coordinates){(function f(x){if(Array.isArray(x[0]))x.forEach(f);else if(x.length>=2)o.push(x)})(g.coordinates)}}w(v);return o}
function renderGeo(v){const p=geoPoints(v).slice(0,2000);if(!p.length)return'<div class="uds-xempty">No coordinates found.</div>';const xs=p.map(x=>+x[0]),ys=p.map(x=>+x[1]),a=Math.min(...xs),b=Math.max(...xs),c=Math.min(...ys),d=Math.max(...ys),sx=x=>30+(x-a)/(b-a||1)*740,sy=y=>370-(y-c)/(d-c||1)*330;return'<svg class="uds-xmap" viewBox="0 0 800 420"><rect width="800" height="420" rx="18" fill="#f7fbff"/>'+p.map(x=>'<circle cx="'+sx(x[0])+'" cy="'+sy(x[1])+'" r="3" fill="#0ba7bb"/>').join('')+'<text x="30" y="400" font-size="12" fill="#66748a">'+a.toFixed(4)+','+c.toFixed(4)+' → '+b.toFixed(4)+','+d.toFixed(4)+'</text></svg>'}
async function openFile(file){
 currentFile=file;if(currentObjectUrl)URL.revokeObjectURL(currentObjectUrl);currentObjectUrl=URL.createObjectURL(file);
 const e=ext(file.name),box=$('udsXPreview');$('udsXStatus').textContent=file.name+' • '+size(file.size)+' • '+(browserOpen.has(e)?'browser-openable':'specialist/native format');
 if(imageExt.has(e)){box.innerHTML='<img class="uds-xmedia" src="'+currentObjectUrl+'" alt="'+esc(file.name)+'">';currentParsed={kind:'media'};return}
 if(audioExt.has(e)){box.innerHTML='<audio class="uds-xaudio" controls src="'+currentObjectUrl+'"></audio>';currentParsed={kind:'media'};return}
 if(videoExt.has(e)){box.innerHTML='<video class="uds-xvideo" controls playsinline src="'+currentObjectUrl+'"></video>';currentParsed={kind:'media'};return}
 if(e==='pdf'){box.innerHTML='<iframe class="uds-xpdf" src="'+currentObjectUrl+'" title="PDF preview"></iframe>';currentParsed={kind:'media'};return}
 if(e==='zip'&&window.JSZip){const z=await JSZip.loadAsync(file);const entries=Object.values(z.files).map(x=>({name:x.name,dir:x.dir,size:x._data?.uncompressedSize||0}));currentParsed={kind:'archive',entries};box.innerHTML='<h4>ZIP contents</h4>'+tableHtml(entries);return}
 if(textExt.has(e)||file.type.startsWith('text/')){const text=await file.text();try{currentParsed=parseSpecial(text,e)}catch(err){currentParsed={kind:'text',text,error:err.message}}if(currentParsed.kind==='table')box.innerHTML=tableHtml(currentParsed.rows);else if(currentParsed.kind==='geojson')box.innerHTML=renderGeo(currentParsed.value)+tableHtml(toRows(currentParsed.value));else if(currentParsed.kind==='tree')box.innerHTML='<pre class="uds-xpre">'+esc(JSON.stringify(currentParsed.value,null,2))+'</pre>';else box.innerHTML='<pre class="uds-xpre">'+esc(text.slice(0,250000))+'</pre>';return}
 const head=new Uint8Array(await file.slice(0,64).arrayBuffer());box.innerHTML='<div class="uds-xbinary"><b>Specialist / binary format</b><p>This format is registered in Omni, but safe browser parsing is not assumed. Use <strong>Open with Local Engine</strong> for native parsing, rendering or conversion.</p><pre>'+esc(bytesToHex(head))+'</pre></div>';currentParsed={kind:'binary',ext:e}
}
function targetsFor(e){if(browserConvert.has(e)){if(['geojson','gpx','kml','topojson'].includes(e))return['json','csv','geojson','svg','html','txt'];if(['fasta','fa','fna','fastq','fq','vcf','gff','gff3','gtf','bed'].includes(e))return['csv','tsv','json','jsonl','txt'];if(['hex','base64','bin','dat'].includes(e))return['hex','base64','txt'];if(imageExt.has(e))return['png','jpg','webp'];return['json','csv','tsv','jsonl','yaml','xml','html','md','txt']}return['local-native','json','csv','txt']}
async function convertBrowser(file,target){
 const e=ext(file.name);
 if(['png','jpg','webp'].includes(target)){if(!imageExt.has(e))throw new Error('Image output requires an image input');const img=new Image();img.src=URL.createObjectURL(file);await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);const m=target==='png'?'image/png':target==='jpg'?'image/jpeg':'image/webp';return new Promise(r=>c.toBlob(r,m,.92))}
 if(target==='hex'||target==='base64'){const b=new Uint8Array(await file.arrayBuffer());return new Blob([target==='hex'?bytesToHex(b):bytesToBase64(b)],{type:'text/plain'})}
 const text=await file.text(),p=parseSpecial(text,e),rows=p.rows||toRows(p.value??text);
 if(target==='json')return new Blob([JSON.stringify(p.value??rows,null,2)],{type:'application/json'});
 if(target==='jsonl')return new Blob([rows.map(x=>JSON.stringify(x)).join('\n')],{type:'application/x-ndjson'});
 if(target==='csv')return new Blob([rowsToCsv(rows)],{type:'text/csv'});
 if(target==='tsv')return new Blob([rowsToCsv(rows,'\t')],{type:'text/tab-separated-values'});
 if(target==='yaml'&&window.jsyaml)return new Blob([window.jsyaml.dump(p.value??rows)],{type:'text/yaml'});
 if(target==='xml')return new Blob([rowsToXml(rows)],{type:'application/xml'});
 if(target==='html')return new Blob([rowsToHtml(rows)],{type:'text/html'});
 if(target==='md')return new Blob([rowsToMd(rows)],{type:'text/markdown'});
 if(target==='geojson'){if(p.kind==='geojson')return new Blob([JSON.stringify(p.value,null,2)],{type:'application/geo+json'});throw new Error('GeoJSON output needs a geospatial source')}
 if(target==='svg'){const d=renderGeo(p.value||{});return new Blob([d],{type:'image/svg+xml'})}
 return new Blob([text],{type:'text/plain'})
}
async function localConvert(file,target){
 const base='http://127.0.0.1:8765',h=await fetch(base+'/api/health',{cache:'no-store'});if(!h.ok)throw new Error('Local Engine is not running');const health=await h.json(),token=health.token||'';
 const up=await fetch(base+'/api/upload',{method:'POST',headers:{Origin:location.origin,'X-Omni-Token':token,'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:file});if(!up.ok)throw new Error('Local upload failed');
 const u=await up.json(),pr=await fetch(base+'/api/process',{method:'POST',headers:{Origin:location.origin,'X-Omni-Token':token,'Content-Type':'application/json'},body:JSON.stringify({op:'data_convert',input:u.file_id,format:target==='local-native'?'json':target,dialect:'sqlite',table:'data'})}),j=await pr.json();if(!pr.ok||!j.ok)throw new Error(j.error||'Local conversion failed');
 const d=await fetch(base+'/api/download/'+encodeURIComponent(j.file_id),{headers:{Origin:location.origin,'X-Omni-Token':token}});if(!d.ok)throw new Error('Local output download failed');return{blob:await d.blob(),name:j.name||'omni-output'}
}
function build(){
 const panel=$('tabUniversalData');if(!panel||$('udsFormatExplorer'))return;
 const card=document.createElement('div');card.className='card';card.id='udsFormatExplorer';
 card.innerHTML='<h2>Universal Format Explorer</h2><div class="sub">Open, render, inspect and convert a much wider set of scientific, geospatial, bioinformatics, signal, binary and data formats. Browser-safe formats stay local to the page; specialist formats escalate to the Local Engine.</div><div class="uds-xbar"><input id="udsXInput" type="file" class="file-input" accept="*/*"><button type="button" class="btn btn-primary" id="udsXOpen">Open / Render</button><select id="udsXTarget" class="form-select"><option>Choose output…</option></select><button type="button" class="btn btn-success" id="udsXConvert">Convert</button><button type="button" class="btn btn-secondary" id="udsXLocal">Open with Local Engine</button></div><div class="uds-xcap" id="udsXCatalog"></div><div class="uds-xstatus" id="udsXStatus">Choose a file to begin.</div><div id="udsXPreview" class="uds-xpreview"><div class="uds-xempty">Browser render area.</div></div>';
 panel.appendChild(card);$('udsXCatalog').innerHTML=REGISTRY.map(x=>'<span><b>'+esc(x.category)+'</b> '+esc(x.exts.map(e=>'.'+e).join(' • '))+'</span>').join('');
 const input=$('udsXInput'),target=$('udsXTarget');
 function refresh(){const f=input.files?.[0];if(!f)return;const e=ext(f.name);target.innerHTML=targetsFor(e).map(x=>'<option value="'+esc(x)+'">'+esc(x==='local-native'?'LOCAL NATIVE':x.toUpperCase())+'</option>').join('');$('udsXStatus').textContent=f.name+' • '+size(f.size)+' • '+(browserOpen.has(e)?'browser-openable':'specialist/native format');}
 input.addEventListener('change',()=>{refresh();const f=input.files?.[0];if(f)openFile(f).catch(err=>$('udsXPreview').innerHTML='<div class="uds-xerror">'+esc(err.message)+'</div>')});
 $('udsXOpen').addEventListener('click',()=>{const f=input.files?.[0];if(!f)return alert('Choose a file first.');openFile(f).catch(e=>alert(e.message))});
 $('udsXConvert').addEventListener('click',async()=>{const f=input.files?.[0],t=target.value;if(!f)return alert('Choose a file first.');if(!t||t==='local-native')return $('udsXLocal').click();try{const b=await convertBrowser(f,t);download(b,'omni-'+f.name.replace(/\.[^.]+$/,'')+'.'+t);$('udsXStatus').textContent='✓ Browser conversion complete'}catch(e){$('udsXStatus').textContent='↻ '+e.message+' — using Local Engine is recommended.'}});
 $('udsXLocal').addEventListener('click',async()=>{const f=input.files?.[0];if(!f)return alert('Choose a file first.');try{const r=await localConvert(f,target.value||'json');download(r.blob,r.name);$('udsXStatus').textContent='✓ Local Engine conversion complete'}catch(e){$('udsXStatus').textContent='✕ Local Engine: '+e.message;alert(e.message)}});
 const main=$('udsInput');if(main){main.setAttribute('accept','*/*');main.addEventListener('change',()=>{const f=main.files?.[0];if(f)openFile(f).catch(()=>{})})}
}
const style=document.createElement('style');style.textContent='.uds-xbar{display:grid;grid-template-columns:1.5fr auto 1fr auto auto;gap:10px;align-items:center;margin-top:14px}.uds-xcap{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;margin-top:14px}.uds-xcap span{display:block;padding:9px 11px;border:1px solid #dce6f0;border-radius:12px;background:#f9fcff;font-size:.72rem;line-height:1.45;color:#52617a}.uds-xstatus{margin-top:12px;padding:10px 12px;border-radius:11px;background:#eef9fb;color:#236274;font-size:.8rem}.uds-xpreview{margin-top:12px;min-height:220px;border:1px solid #dce6f0;border-radius:16px;background:#fff;overflow:hidden;padding:12px}.uds-xempty{display:grid;place-items:center;min-height:190px;color:#7a8799;font-size:.85rem}.uds-xscroll{max-height:460px;overflow:auto}.uds-x{width:100%;border-collapse:collapse;font-size:.72rem}.uds-x th,.uds-x td{padding:7px 8px;border-bottom:1px solid #edf1f5;text-align:left;white-space:nowrap}.uds-x th{position:sticky;top:0;background:#f1f7fa;color:#334155}.uds-xcount{padding-top:8px;color:#718096;font-size:.7rem}.uds-xpre{margin:0;max-height:480px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#26364b}.uds-xmap{display:block;width:100%;max-height:460px}.uds-xmedia{display:block;max-width:100%;max-height:560px;margin:auto;border-radius:12px}.uds-xaudio{width:100%;margin-top:80px}.uds-xvideo{display:block;width:100%;max-height:560px;border-radius:12px;background:#111}.uds-xpdf{width:100%;height:600px;border:0}.uds-xbinary{padding:18px;border-radius:12px;background:#f7fafc;color:#52617a}.uds-xbinary pre{overflow:auto;background:#111827;color:#dbeafe;padding:12px;border-radius:10px;font-size:11px}.uds-xerror{padding:14px;background:#fff2f2;color:#a33}@media(max-width:800px){.uds-xbar{grid-template-columns:1fr 1fr}.uds-xbar .file-input{grid-column:1/-1}.uds-xpdf{height:460px}}';document.head.appendChild(style);
 build();
}
window.OMNI_UDS_FORMATS={registry:REGISTRY,allExtensions:allExts,browserOpen:[...browserOpen],browserConvert:[...browserConvert]};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();