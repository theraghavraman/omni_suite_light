/* Omni Universal Data & Signal Studio
 * Browser-first canonicalization and media/export layer.
 * Handles geospatial, weather, telemetry/scientific, audio/signal, encoded/binary,
 * CSV/JSON/NDJSON/GeoJSON/GPX/KML and generic numeric datasets.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const state={raw:null,sourceName:'',kind:'unknown',records:[],meta:{},audio:null,animation:null};

function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function ext(n){return (n.split('.').pop()||'').toLowerCase();}
function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);}
function setStatus(msg,ok=true){const e=$('udsStatus');if(e){e.textContent=msg;e.className='uds-status '+(ok?'ok':'warn');}}
function prettyBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB';}
function guessKind(name,text){
 const e=ext(name),t=(text||'').trim();
 if(['geojson','geojsonl'].includes(e)||/^\s*[{[]/.test(t)&&/"(type|features|geometry)"\s*:/.test(t))return 'geo';
 if(['gpx'].includes(e)||/<gpx[\s>]/i.test(t))return 'geo';
 if(['kml'].includes(e)||/<kml[\s>]/i.test(t))return 'geo';
 if(['csv','tsv','ndjson','jsonl'].includes(e))return e==='csv'||e==='tsv'?'table':'records';
 if(['json','xml','yaml','yml'].includes(e))return e==='json'?'records':'structured';
 if(['wav','mp3','ogg','flac','m4a','aac','webm'].includes(e))return 'audio';
 if(['bin','dat','raw','hex','base64'].includes(e))return 'binary';
 if(['fits','fit','nc','h5','hdf','cdf','grib','grib2'].includes(e))return 'scientific-binary';
 if(['txt','log','sql'].includes(e))return 'text';
 if(/^data:audio\//.test(t))return 'audio';
 return 'unknown';
}
function parseCSV(text,sep=','){
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
 if(!lines.length)return [];
 const out=[];let row=[],cur='',q=false;
 for(let i=0;i<lines.join('\n').length;i++){const c=lines.join('\n')[i];if(c==='"'){if(q&&lines.join('\n')[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===sep&&!q){row.push(cur);cur='';}else if(c==='\n'&&!q){row.push(cur);out.push(row);row=[];cur='';}else cur+=c;}
 if(cur||row.length){row.push(cur);out.push(row);}
 const head=out.shift().map(x=>x.trim());return out.map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??''])));
}
function normalize(obj){
 let rows=[];
 if(Array.isArray(obj)) rows=obj;
 else if(obj&&Array.isArray(obj.data)) rows=obj.data;
 else if(obj&&Array.isArray(obj.results)) rows=obj.results;
 else if(obj&&Array.isArray(obj.features)) return obj.features.map((f,i)=>({id:i,...(f.properties||{}),...((f.geometry&&f.geometry.type==='Point')?{lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]}:{geometry:f.geometry})}));
 else if(obj&&typeof obj==='object') rows=[obj];
 return rows.map((r,i)=>{const o={...r,_index:i};const lat=Number(o.lat??o.latitude??o.y??o.LATITUDE??o.Latitude);const lon=Number(o.lon??o.lng??o.longitude??o.x??o.LONGITUDE??o.Longitude);if(Number.isFinite(lat)&&Number.isFinite(lon)){o.lat=lat;o.lon=lon;o._geo=true;}return o;});
}
function numericFields(rows){if(!rows.length)return[];return [...new Set(rows.flatMap(r=>Object.entries(r).filter(([k,v])=>k[0]!=='_'&&v!==''&&Number.isFinite(Number(v))).map(([k])=>k)))].slice(0,40);}
function parseGPX(text){const pts=[];const re=/<trkpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;let m,i=0;while((m=re.exec(text))){const s=m[3];const tm=(s.match(/<time>([^<]+)/i)||[])[1];const ele=(s.match(/<ele>([^<]+)/i)||[])[1];pts.push({lat:+m[1],lon:+m[2],time:tm||'',elevation:ele?+ele:null,_index:i++});}return pts;}
function parseKML(text){const pts=[];const re=/<Placemark[\s\S]*?<coordinates>([^<]+)<\/coordinates>[\s\S]*?<\/Placemark>/gi;let m,i=0;while((m=re.exec(text))){const parts=m[1].trim().split(/\s+/);parts.forEach(p=>{const a=p.split(',');if(a.length>=2)pts.push({lon:+a[0],lat:+a[1],elevation:a[2]?+a[2]:null,_index:i++});});}return pts;}
function parseInput(name,text,buf){
 const k=guessKind(name,text);state.kind=k;
 if(k==='table')state.records=parseCSV(text,ext(name)==='tsv'?'\t':',');
 else if(k==='records'){try{const j=ext(name)==='ndjson'||ext(name)==='jsonl'?text.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)):JSON.parse(text);state.records=normalize(j);}catch(e){state.records=[];throw new Error('JSON/NDJSON parse failed: '+e.message);}}
 else if(k==='geo'){if(ext(name)==='gpx')state.records=parseGPX(text);else if(ext(name)==='kml')state.records=parseKML(text);else state.records=normalize(JSON.parse(text));}
 else if(k==='text'){state.records=text.split(/\r?\n/).filter(Boolean).map((line,i)=>({_index:i,line}));}
 else if(k==='binary'||k==='scientific-binary'){state.records=[];}
 else if(k==='audio'){state.audio=buf;state.records=[];}
 else {try{state.records=normalize(JSON.parse(text));state.kind='records';}catch{state.records=text.split(/\r?\n/).filter(Boolean).map((line,i)=>({_index:i,line}));state.kind='text';}}
 state.raw=text;state.sourceName=name;state.meta={bytes:buf?.byteLength||text.length,kind:state.kind,rows:state.records.length,numeric:numericFields(state.records)};
 renderPreview();updateControls();
}
async function loadFile(f){const buf=await f.arrayBuffer();let text='';if(!['audio','binary','scientific-binary'].includes(guessKind(f.name,''))){text=new TextDecoder().decode(buf);}else if(['txt','csv','json','geojson','gpx','kml','ndjson','jsonl','tsv'].includes(ext(f.name))){text=new TextDecoder().decode(buf);}parseInput(f.name,text,buf);}
function renderPreview(){
 const meta=$('udsMeta');if(meta)meta.innerHTML='<div class="uds-pill"><b>'+esc(state.kind.toUpperCase())+'</b><span>'+prettyBytes(state.meta.bytes||0)+'</span></div><div class="uds-pill"><b>'+state.records.length+'</b><span>normalized rows</span></div><div class="uds-pill"><b>'+state.meta.numeric.length+'</b><span>numeric fields</span></div>';
 const p=$('udsPreview');if(!p)return;
 if(state.audio){p.innerHTML='<audio controls src="'+URL.createObjectURL(new Blob([state.audio]))+'"></audio>';return;}
 const rows=state.records.slice(0,8);if(!rows.length){p.innerHTML='<div class="uds-empty">Binary/scientific or unsupported-native data loaded. Use the conversion/export layer or Local Engine for native decoding.</div>';return;}
 const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,8);
 p.innerHTML='<div class="uds-table-wrap"><table><thead><tr>'+keys.map(k=>'<th>'+esc(k)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+keys.map(k=>'<td>'+esc(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function updateControls(){
 const nums=numericFields(state.records),sel=$('udsField');if(sel)sel.innerHTML=nums.map(x=>'<option>'+esc(x)+'</option>').join('')||'<option value="">Auto</option>';
 const type=$('udsVizType');if(type)type.value=state.records.some(r=>r._geo)?'map':state.audio?'audio':'chart';
}
function rowsForExport(){
 return state.records.map(r=>{const o={};for(const [k,v] of Object.entries(r)){if(k!=='_index'&&k!=='_geo')o[k]=v;}return o;});
}
function geoJSON(){
 const features=state.records.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon)).map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[r.lon,r.lat]},properties:Object.fromEntries(Object.entries(r).filter(([k])=>!['_index','_geo','lat','lon'].includes(k)))}));
 return {type:'FeatureCollection',features};
}
function csvOut(rows){
 const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];const q=v=>{const s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);return '"'+s.replace(/"/g,'""')+'"';};return [keys.map(q).join(','),...rows.map(r=>keys.map(k=>q(r[k])).join(','))].join('\n');
}
function draw(){
 const c=$('udsCanvas');if(!c)return;const dpr=devicePixelRatio||1,w=c.clientWidth||800,h=380;c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);x.clearRect(0,0,w,h);x.fillStyle='#f7f9ff';x.fillRect(0,0,w,h);
 const rows=state.records,field=$('udsField')?.value||numericFields(rows)[0];
 if(state.audio){drawWave(x,w,h);return;}
 const pts=rows.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon));
 if($('udsVizType')?.value==='map'||pts.length){const minx=Math.min(...pts.map(r=>r.lon)),maxx=Math.max(...pts.map(r=>r.lon)),miny=Math.min(...pts.map(r=>r.lat)),maxy=Math.max(...pts.map(r=>r.lat));const sx=Math.max(maxx-minx,1e-9),sy=Math.max(maxy-miny,1e-9);x.strokeStyle='#dce3ef';for(let i=1;i<8;i++){x.beginPath();x.moveTo(i*w/8,0);x.lineTo(i*w/8,h);x.stroke();x.beginPath();x.moveTo(0,i*h/8);x.lineTo(w,i*h/8);x.stroke();}pts.slice(0,10000).forEach(r=>{const px=20+(r.lon-minx)/sx*(w-40),py=h-20-(r.lat-miny)/sy*(h-40);x.beginPath();x.arc(px,py,Math.max(2,Math.min(7,4)),0,Math.PI*2);x.fillStyle='#635bff';x.fill();});return;}
 const vals=rows.map(r=>Number(r[field])).filter(Number.isFinite);if(!vals.length){x.fillStyle='#65718a';x.font='16px sans-serif';x.fillText('No numeric field available for visualization',24,40);return;}const min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;x.strokeStyle='#dce3ef';for(let i=1;i<6;i++){x.beginPath();x.moveTo(0,i*h/6);x.lineTo(w,i*h/6);x.stroke();}x.strokeStyle='#635bff';x.lineWidth=2; x.beginPath();vals.slice(0,5000).forEach((v,i)=>{const px=20+i/(Math.max(1,Math.min(vals.length,5000)-1))*(w-40),py=h-20-(v-min)/span*(h-40);i?x.lineTo(px,py):x.moveTo(px,py);});x.stroke();x.lineWidth=1;
}
function drawWave(x,w,h){const u=state.audio;if(!u)return;const a=new Uint8Array(u);let step=Math.max(1,Math.floor(a.length/(w*2)));x.strokeStyle='#ec4899';x.beginPath();for(let i=0;i<w;i++){let lo=255,hi=0;for(let j=0;j<step&&i*step+j<a.length;j++){const v=a[i*step+j];lo=Math.min(lo,v);hi=Math.max(hi,v);}const y1=h/2+(lo-128)/128*(h*.42),y2=h/2+(hi-128)/128*(h*.42);x.moveTo(i,y1);x.lineTo(i,y2);}x.stroke();}
function sonify(duration=8){
 const vals=state.records.map(r=>Number(r[$('udsField')?.value])).filter(Number.isFinite);if(!vals.length)throw new Error('Select a numeric field first.');
 const sr=44100,n=sr*duration,buf=new ArrayBuffer(44+n*2),dv=new DataView(buf);function w(o,s){for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));}w(0,'RIFF');dv.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);w(36,'data');dv.setUint32(40,n*2,true);
 const mn=Math.min(...vals),mx=Math.max(...vals),sp=mx-mn||1;for(let i=0;i<n;i++){const p=i/(n-1),idx=Math.floor(p*(vals.length-1)),v=(vals[idx]-mn)/sp;const freq=140+v*900,env=.22+.5*Math.min(1,4*Math.min(p,1-p));const s=Math.sin(2*Math.PI*freq*i/sr)*env;dv.setInt16(44+i*2,Math.max(-1,Math.min(1,s))*32767,true);}return new Blob([buf],{type:'audio/wav'});
}
function htmlReport(){
 const g=state.records.some(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon));return '<!doctype html><meta charset="utf-8"><title>Omni Data Report</title><style>body{font-family:system-ui;margin:30px;background:#f5f7fb;color:#182033}table{border-collapse:collapse;width:100%}td,th{padding:7px;border:1px solid #dce3ef;text-align:left}</style><h1>Omni Universal Data Report</h1><p>Source: '+esc(state.sourceName)+' · Type: '+esc(state.kind)+' · Rows: '+state.records.length+'</p><pre>'+esc(JSON.stringify({meta:state.meta,geojson:g?geoJSON():null},null,2))+'</pre>';
}
async function exportAs(fmt){
 if(fmt==='json'){downloadBlob(new Blob([JSON.stringify(rowsForExport(),null,2)],{type:'application/json'}),state.sourceName.replace(/\.[^.]+$/,'')+'.json');}
 else if(fmt==='csv'){downloadBlob(new Blob([csvOut(rowsForExport())],{type:'text/csv'}),state.sourceName.replace(/\.[^.]+$/,'')+'.csv');}
 else if(fmt==='geojson'){downloadBlob(new Blob([JSON.stringify(geoJSON(),null,2)],{type:'application/geo+json'}),state.sourceName.replace(/\.[^.]+$/,'')+'.geojson');}
 else if(fmt==='svg'){const pts=state.records.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon));if(!pts.length)throw new Error('SVG map requires latitude/longitude records.');const minx=Math.min(...pts.map(r=>r.lon)),maxx=Math.max(...pts.map(r=>r.lon)),miny=Math.min(...pts.map(r=>r.lat)),maxy=Math.max(...pts.map(r=>r.lat)),sx=maxx-minx||1,sy=maxy-miny||1;const circles=pts.map(r=>'<circle cx="'+(20+(r.lon-minx)/sx*760).toFixed(1)+'" cy="'+(380-(r.lat-miny)/sy*340).toFixed(1)+'" r="3"/>').join('');downloadBlob(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="100%" height="100%" fill="#f7f9ff"/><g fill="#635bff">'+circles+'</g></svg>'],{type:'image/svg+xml'}),'omni-map.svg');}
 else if(fmt==='png'){draw();const c=$('udsCanvas');const b=await new Promise(r=>c.toBlob(r,'image/png'));downloadBlob(b,'omni-data-visualization.png');}
 else if(fmt==='wav'){downloadBlob(sonify(Number($('udsDuration')?.value||8)),'omni-data-sonification.wav');}
 else if(fmt==='html'){downloadBlob(new Blob([htmlReport()],{type:'text/html'}),'omni-data-report.html');}
 else if(fmt==='txt'){downloadBlob(new Blob([state.records.map(r=>Object.entries(r).map(([k,v])=>k+'='+v).join(' | ')).join('\n')],{type:'text/plain'}),'omni-data.txt');}
}
async function fetchURL(){
 const u=$('udsUrl')?.value.trim();if(!u)throw new Error('Enter a public URL/API endpoint.');setStatus('Fetching…');const r=await fetch(u,{mode:'cors'});if(!r.ok)throw new Error('HTTP '+r.status+' — the source may not permit browser CORS.');const ct=r.headers.get('content-type')||'';const buf=await r.arrayBuffer();const name=(u.split('/').pop()||'remote-data').split('?')[0]||'remote-data';const text=/json|text|csv|xml|geo\+json|gpx|kml/i.test(ct)?new TextDecoder().decode(buf):'';if(/audio\//i.test(ct))state.audio=buf;parseInput(name,text,buf);setStatus('Fetched '+name);}
function bind(){
 const d=$('udsDrop'),i=$('udsInput');if(!d||!i)return;
 const set=f=>f&&loadFile(f).catch(e=>setStatus(e.message,false));
 i.addEventListener('change',e=>set(e.target.files[0]));d.addEventListener('click',e=>{if(e.target!==i)i.click()});d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('dragover')});d.addEventListener('dragleave',()=>d.classList.remove('dragover'));d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('dragover');set(e.dataTransfer.files[0])});
 $('udsFetch')?.addEventListener('click',()=>fetchURL().catch(e=>setStatus(e.message,false)));
 $('udsVisualize')?.addEventListener('click',()=>{draw();setStatus('Visualization rendered');});
 $('udsExport')?.addEventListener('click',()=>exportAs($('udsFormat').value).catch(e=>setStatus(e.message,false)));
 $('udsSonify')?.addEventListener('click',()=>{try{downloadBlob(sonify(Number($('udsDuration').value||8)),'omni-data-sonification.wav');setStatus('Sonification generated');}catch(e){setStatus(e.message,false)}});
 $('udsReset')?.addEventListener('click',()=>location.reload());
 $('udsPreset')?.addEventListener('change',e=>{const v=e.target.value;if(v)$('udsUrl').value=v;});
 window.addEventListener('resize',()=>{if(state.records.length||state.audio)draw();});
}
bind();
window.OMNI_UNIVERSAL_DATA={state,exportAs,sonify,fetchURL};
})();