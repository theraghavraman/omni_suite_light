/* Omni Suite — browser engines for the Data and AI & Code studios.
 * Runs Data Clean, privacy scans, Batch Lab, SQLite/Parquet conversion, DynamoDB JSON,
 * the text/BLOB bridges and Indic transliteration entirely in the browser, so they work on
 * GitHub Pages without the Local Engine. Anything the browser cannot do is still handed to
 * the Local Engine, and a missing Local Engine now produces a clear message.
 * Loaded after the inline studio scripts; nothing here changes IDs or markup.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const BF=()=>window.OMNI_BROWSER_FIRST||{};
const SQLJS='https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/';
const PARQUET_WRITER='https://cdn.jsdelivr.net/npm/hyparquet-writer@0.16.11/+esm';
const PARQUET_READER='https://cdn.jsdelivr.net/npm/hyparquet@1.31.3/+esm';

/* ---------- 1. Clear message when the Local Engine is not running ---------- */
const LOCAL_RE=/^https?:\/\/(127\.0\.0\.1|localhost):8765\//;
if(window.fetch&&!window.fetch.__omniLocalAware){
  const nativeFetch=window.fetch.bind(window);
  const wrapped=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    try{return await nativeFetch(input,init);}
    catch(e){
      if(LOCAL_RE.test(url)){
        const err=new Error('This option needs the Omni Local Engine, which is not running on this computer. Start it with setup_and_start (setup_and_start.bat on Windows, setup_and_start.command on macOS/Linux), or pick a browser-supported option.');
        err.cause=e;err.localEngine=true;throw err;
      }
      throw e;
    }
  };
  wrapped.__omniLocalAware=true;window.fetch=wrapped;
}

/* ---------- helpers ---------- */
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'data').replace(/\.[^.]+$/,'')||'data';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('Could not load '+src+' (check your internet connection).'));document.head.appendChild(s);});}
let sqlPromise=null;
function sqlJs(){if(!sqlPromise)sqlPromise=(async()=>{if(!window.initSqlJs)await loadScript(SQLJS+'sql-wasm.js');return window.initSqlJs({locateFile:f=>SQLJS+f});})().catch(e=>{sqlPromise=null;throw e;});return sqlPromise;}
let pqWrite=null,pqRead=null;
async function parquetWriter(){if(!pqWrite)pqWrite=import(PARQUET_WRITER).catch(e=>{pqWrite=null;throw new Error('Parquet writer could not load: '+e.message);});return pqWrite;}
async function parquetReader(){if(!pqRead)pqRead=import(PARQUET_READER).catch(e=>{pqRead=null;throw new Error('Parquet reader could not load: '+e.message);});return pqRead;}
function rememberFile(inputId,dropId,cb){
  const i=$(inputId),d=dropId?$(dropId):i?.closest('.dropzone');
  i?.addEventListener('change',()=>cb(i.multiple?[...(i.files||[])]:(i.files?.[0]||null)));
  d?.addEventListener('drop',e=>{const fs=e.dataTransfer?.files;if(fs?.length)cb(i?.multiple?[...fs]:fs[0]);});
}
function intercept(id,handler){
  // Capture-phase listener on the button itself runs before the original handler.
  // handler returns true when it fully handled the click.
  const el=$(id);if(!el)return;
  el.addEventListener('click',async e=>{
    const plan=handler.plan?handler.plan():true;
    if(!plan)return; // let the original (Local Engine) handler run
    e.stopImmediatePropagation();e.preventDefault();
    if(el.dataset.omniBusy==='1')return;el.dataset.omniBusy='1';
    try{await handler.run(plan);}finally{delete el.dataset.omniBusy;}
  },true);
}
const show=(id,v)=>{const el=$(id);if(el)el.textContent=typeof v==='string'?v:JSON.stringify(v,null,2);};

/* ---------- 2. Reading and writing rows in the browser ---------- */
const BROWSER_READ=new Set(['csv','tsv','txt','log','json','jsonl','ndjson','yaml','yml','xml','html','md','xlsx','xlsm','xlsb','xls','ods','fods','parquet','sqlite','db','sqlite3']);
const BROWSER_WRITE=new Set(['csv','tsv','json','jsonl','ndjson','yaml','xml','html','md','xlsx','ods','sql','sqlite','parquet','jsonschema']);
function plain(v){if(v instanceof Date)return isNaN(v)?null:v.toISOString();if(typeof v==='bigint')return Number.isSafeInteger(Number(v))?Number(v):String(v);if(v instanceof Uint8Array)return Array.from(v).map(b=>b.toString(16).padStart(2,'0')).join('');if(v&&typeof v==='object')return JSON.stringify(v);return v;}
function normalize(rows){return (rows||[]).map(r=>{const o={};for(const [k,v] of Object.entries(r||{}))o[k]=plain(v);return o;});}
function keysOf(rows){const ks=[],seen=new Set();rows.forEach(r=>Object.keys(r).forEach(k=>{if(!seen.has(k)){seen.add(k);ks.push(k);}}));return ks;}
async function readRows(file){
  const e=ext(file.name);
  if(e==='parquet'){const {parquetReadObjects}=await parquetReader();return normalize(await parquetReadObjects({file:await file.arrayBuffer()}));}
  if(e==='sqlite'||e==='db'||e==='sqlite3'){
    const SQL=await sqlJs();const db=new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    try{const t=db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid");const names=t[0]?.values.map(x=>x[0])||[];if(!names.length)throw new Error('The SQLite file has no tables.');
      const out=[];for(const n of names){const r=db.exec('SELECT * FROM "'+String(n).replace(/"/g,'""')+'"')[0];if(!r)continue;r.values.forEach(v=>{const o={};r.columns.forEach((c,i)=>o[c]=v[i]);if(names.length>1)o.__table=n;out.push(o);});}
      return normalize(out);}finally{db.close();}
  }
  if(typeof BF().read!=='function')throw new Error('Browser data reader is not available on this page.');
  let rows=await BF().read(file);
  if(rows.length&&rows.every(r=>'__sheet' in r)&&new Set(rows.map(r=>r.__sheet)).size===1)rows=rows.map(({__sheet,...r})=>r);
  return normalize(rows);
}
function colType(vals){const v=vals.filter(x=>x!==null&&x!==undefined&&x!=='');if(!v.length)return 'STRING';if(v.every(x=>typeof x==='boolean'))return 'BOOLEAN';if(v.every(x=>typeof x==='number'&&Number.isFinite(x))){return v.every(x=>Number.isInteger(x)&&Math.abs(x)<2147483648)?'INT32':'DOUBLE';}return 'STRING';}
function sqlIdent(n,dialect){const d=String(dialect||'').toLowerCase();if(d==='tsql')return '['+String(n).replace(/]/g,']]')+']';if(d==='mysql'||d==='bigquery'||d==='databricks'||d==='spark'||d==='hive')return '`'+String(n).replace(/`/g,'``')+'`';return '"'+String(n).replace(/"/g,'""')+'"';}
function sqlType(t,dialect){const d=String(dialect||'').toLowerCase();if(t==='INT32')return d==='bigquery'?'INT64':'INTEGER';if(t==='DOUBLE')return d==='bigquery'?'FLOAT64':d==='tsql'?'FLOAT':'DOUBLE PRECISION'.replace('DOUBLE PRECISION',d==='mysql'||d==='sqlite'||d==='duckdb'?'DOUBLE':'DOUBLE PRECISION');if(t==='BOOLEAN')return d==='tsql'?'BIT':'BOOLEAN';return d==='tsql'?'NVARCHAR(MAX)':d==='bigquery'?'STRING':d==='oracle'?'VARCHAR2(4000)':'TEXT';}
function sqlLit(v,t,dialect){if(v===null||v===undefined||v==='')return 'NULL';if(t==='BOOLEAN')return String(dialect).toLowerCase()==='tsql'?(v?'1':'0'):(v?'TRUE':'FALSE');if(t==='INT32'||t==='DOUBLE')return String(v);return "'"+String(v).replace(/'/g,"''")+"'";}
function toSql(rows,dialect,table){const ks=keysOf(rows),types=Object.fromEntries(ks.map(k=>[k,colType(rows.map(r=>r[k]))])),tn=sqlIdent(table||'data',dialect);
  return 'CREATE TABLE '+tn+' (\n'+ks.map(k=>'  '+sqlIdent(k,dialect)+' '+sqlType(types[k],dialect)).join(',\n')+'\n);\n\n'+rows.map(r=>'INSERT INTO '+tn+' ('+ks.map(k=>sqlIdent(k,dialect)).join(', ')+') VALUES ('+ks.map(k=>sqlLit(r[k],types[k],dialect)).join(', ')+');').join('\n')+'\n';}
function toXml(rows){const esc=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));const tag=k=>{let t=String(k).replace(/[^A-Za-z0-9_.-]/g,'_');if(!/^[A-Za-z_]/.test(t))t='_'+t;return t;};
  return '<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n'+rows.map(r=>'  <row>'+Object.entries(r).map(([k,v])=>'<'+tag(k)+'>'+(v===null||v===undefined?'':esc(v))+'</'+tag(k)+'>').join('')+'</row>').join('\n')+'\n</rows>\n';}
function toMd(rows){const ks=keysOf(rows),cell=v=>String(v??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');return '| '+ks.map(cell).join(' | ')+' |\n| '+ks.map(()=>'---').join(' | ')+' |\n'+rows.map(r=>'| '+ks.map(k=>cell(r[k])).join(' | ')+' |').join('\n')+'\n';}
const NUM_RE=/^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
function inferTypes(rows){
  // CSV/TSV values arrive as text; give typed formats real numbers and booleans.
  // Leading-zero codes ("007") and long digit strings (phone numbers, IDs) stay text.
  const ks=keysOf(rows),conv={};
  ks.forEach(k=>{const v=rows.map(r=>r[k]).filter(x=>x!==null&&x!==undefined&&x!=='');
    if(!v.length||!v.some(x=>typeof x==='string'))return;
    if(v.every(x=>typeof x==='number'||(typeof x==='string'&&NUM_RE.test(x.trim()))))conv[k]=x=>{if(typeof x==='number')return x;const n=Number(String(x).trim());return Number.isFinite(n)?n:x;};
    else if(v.every(x=>typeof x==='boolean'||(typeof x==='string'&&/^(true|false)$/i.test(x.trim()))))conv[k]=x=>typeof x==='boolean'?x:/^true$/i.test(String(x).trim());});
  if(!Object.keys(conv).length)return rows;
  return rows.map(r=>{const o={...r};for(const k in conv){if(o[k]===''||o[k]===undefined)o[k]=null;else if(o[k]!==null)o[k]=conv[k](o[k]);}return o;});
}
async function writeRows(rows,format,opts={}){
  const f=String(format).toLowerCase();
  if(['parquet','sqlite','sql','jsonschema','xlsx','ods'].includes(f))rows=inferTypes(rows);
  const ks=keysOf(rows);
  const sheet=()=>{if(!window.XLSX)throw new Error('The spreadsheet engine (SheetJS) did not load. Check your internet connection and reload.');return window.XLSX.utils.json_to_sheet(rows,{header:ks});};
  if(f==='csv'||f==='tsv')return {blob:new Blob([window.XLSX?window.XLSX.utils.sheet_to_csv(sheet(),{FS:f==='tsv'?'\t':','}):ks.join(',')+'\n'+rows.map(r=>ks.map(k=>{const v=r[k]??'';return /[",\n]/.test(v)?'"'+String(v).replace(/"/g,'""')+'"':v;}).join(',')).join('\n')],{type:'text/csv'}),ext:f};
  if(f==='json')return {blob:new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}),ext:'json'};
  if(f==='jsonl'||f==='ndjson')return {blob:new Blob([rows.map(r=>JSON.stringify(r)).join('\n')+'\n'],{type:'application/x-ndjson'}),ext:f};
  if(f==='yaml'){if(!window.jsyaml)throw new Error('The YAML engine did not load. Check your internet connection and reload.');return {blob:new Blob([window.jsyaml.dump(rows,{noRefs:true})],{type:'text/yaml'}),ext:'yaml'};}
  if(f==='xml')return {blob:new Blob([toXml(rows)],{type:'application/xml'}),ext:'xml'};
  if(f==='html')return {blob:new Blob(['<!doctype html><meta charset="utf-8"><title>Data</title>'+window.XLSX.utils.sheet_to_html(sheet())],{type:'text/html'}),ext:'html'};
  if(f==='md')return {blob:new Blob([toMd(rows)],{type:'text/markdown'}),ext:'md'};
  if(f==='xlsx'||f==='ods'){const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,sheet(),'Data');return {blob:new Blob([window.XLSX.write(wb,{bookType:f,type:'array',compression:true})]),ext:f};}
  if(f==='sql')return {blob:new Blob([toSql(rows,opts.dialect||'sqlite',opts.table||'data')],{type:'application/sql'}),ext:'sql'};
  if(f==='jsonschema'){const p={};ks.forEach(k=>{const t=colType(rows.map(r=>r[k]));p[k]={type:t==='INT32'?'integer':t==='DOUBLE'?'number':t==='BOOLEAN'?'boolean':'string'};});return {blob:new Blob([JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',type:'array',items:{type:'object',properties:p}},null,2)],{type:'application/schema+json'}),ext:'schema.json'};}
  if(f==='sqlite'){
    const SQL=await sqlJs(),db=new SQL.Database(),table=(opts.table||'data').replace(/[^A-Za-z0-9_]+/g,'_')||'data';
    const types=Object.fromEntries(ks.map(k=>[k,colType(rows.map(r=>r[k]))])),q=k=>'"'+String(k).replace(/"/g,'""')+'"';
    db.run('CREATE TABLE '+q(table)+' ('+ks.map(k=>q(k)+' '+(types[k]==='INT32'?'INTEGER':types[k]==='DOUBLE'?'REAL':types[k]==='BOOLEAN'?'INTEGER':'TEXT')).join(', ')+')');
    const st=db.prepare('INSERT INTO '+q(table)+' VALUES ('+ks.map(()=>'?').join(',')+')');
    db.run('BEGIN');rows.forEach(r=>st.run(ks.map(k=>{const v=r[k];if(v===''||v===undefined)return null;if(typeof v==='boolean')return v?1:0;return v;})));db.run('COMMIT');st.free();
    const bytes=db.export();db.close();return {blob:new Blob([bytes],{type:'application/vnd.sqlite3'}),ext:'sqlite'};
  }
  if(f==='parquet'){
    const {parquetWriteBuffer}=await parquetWriter();
    const columnData=ks.map(k=>{const vals=rows.map(r=>r[k]===''?null:r[k]??null),t=colType(vals);return {name:String(k),type:t,data:vals.map(v=>v===null?null:t==='STRING'?String(v):v)};});
    return {blob:new Blob([parquetWriteBuffer({columnData})],{type:'application/vnd.apache.parquet'}),ext:'parquet'};
  }
  throw new Error('No browser writer for .'+f);
}
window.OMNI_BROWSER_PLUS={readRows,writeRows,BROWSER_READ,BROWSER_WRITE};

/* ---------- 3. Data Studio: SQLite / Parquet in the browser, DynamoDB JSON ---------- */
let dataFile=null,nosqlFile=null,textFile=null,blobFile=null,cleanFile=null,batchFiles=[];
rememberFile('dataConvertInput','dataConvertDrop',f=>{dataFile=f;const e=ext(f?.name);if(f&&['parquet','sqlite','db','sqlite3'].includes(e)){const m=$('dataConvertMeta');if(m)setTimeout(()=>{m.textContent=(f.size/1048576).toFixed(2)+' MB • browser-first';},0);}});
document.getElementById('dataConvertReset')?.addEventListener('click',()=>{dataFile=null;});
const NEW_BROWSER_TARGETS=new Set(['sqlite','parquet']),NEW_BROWSER_INPUTS=new Set(['parquet','sqlite','db','sqlite3']);
intercept('dataConvertRun',{
  plan(){if(!dataFile)return null;const t=$('dataConvertTarget')?.value,e=ext(dataFile.name);
    if((NEW_BROWSER_TARGETS.has(t)||NEW_BROWSER_INPUTS.has(e))&&BROWSER_READ.has(e)&&BROWSER_WRITE.has(t))return {t};return null;},
  async run({t}){
    const cap=$('dataConvertCapability')||(()=>{const el=document.createElement('div');el.id='dataConvertCapability';el.style.cssText='margin:10px 0;padding:9px 12px;border-radius:10px;font-size:.88rem;border:1px solid #d9e2f2;background:#f7faff;color:#34415c';$('dataConvertRun')?.parentElement?.prepend(el);return el;})();
    try{cap.textContent='● Browser conversion — no upload required';
      const rows=await readRows(dataFile);const out=await writeRows(rows,t,{dialect:$('dataConvertDialect')?.value,table:$('dataConvertTable')?.value||base(dataFile.name)});
      save(out.blob,base(dataFile.name)+'.'+out.ext);cap.textContent='✓ Converted '+rows.length+' rows to '+t.toUpperCase()+' in your browser';
    }catch(e){cap.textContent='✕ Conversion failed: '+e.message;alert('Data Converter: '+e.message);}
  }
});
rememberFile('nosqlInput','nosqlDrop',f=>nosqlFile=f);
function ddbAttr(v){if(v===null||v===undefined)return {NULL:true};if(typeof v==='boolean')return {BOOL:v};if(typeof v==='number')return {N:String(v)};if(Array.isArray(v))return {L:v.map(ddbAttr)};if(typeof v==='object')return {M:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,ddbAttr(x)]))};return {S:String(v)};}
intercept('nosqlRun',{
  plan(){return nosqlFile&&$('nosqlTarget')?.value==='dynamodb-json'&&['json','jsonl'].includes($('nosqlSource')?.value)?{}:null;},
  async run(){
    try{const t=await nosqlFile.text(),src=$('nosqlSource').value;let v=src==='jsonl'?t.split(/\r?\n/).filter(Boolean).map(JSON.parse):JSON.parse(t);
      if(!Array.isArray(v))v=Array.isArray(v?.data)?v.data:Array.isArray(v?.items)?v.items:[v];
      const objs=v.map(x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{value:x});
      const items=inferTypes(objs).map(x=>Object.fromEntries(Object.entries(x).map(([k,y])=>[k,ddbAttr(y===''?null:y)])));
      save(new Blob([JSON.stringify({Items:items,Count:items.length},null,2)],{type:'application/json'}),base(nosqlFile.name)+'.dynamodb.json');
    }catch(e){alert('NoSQL Bridge: '+e.message);}
  }
});

/* ---------- 4. Text and BLOB bridges (browser) ---------- */
rememberFile('textBridgeInput','textBridgeDrop',f=>textFile=f);
rememberFile('blobBridgeInput','blobBridgeDrop',f=>blobFile=f);
intercept('textBridgeRun',{async run(){
  if(!textFile)return alert('Choose a file first.');
  try{const text=await textFile.text(),rows=text.replace(/\r/g,'').split('\n').map((t,i)=>({line_number:i+1,text:t,characters:t.length,words:(t.match(/\S+/g)||[]).length})).filter(r=>r.text.trim());
    const out=await writeRows(rows,$('textBridgeTarget')?.value||'jsonl');save(out.blob,base(textFile.name)+'.lines.'+out.ext);
  }catch(e){alert('Text bridge: '+e.message);}
}});
function toBytes(src,kind){if(kind==='binary')return src;const s=new TextDecoder().decode(src).replace(/\s+/g,'');if(kind==='hex'){const h=s.replace(/^0x/i,'').replace(/^\\x/i,'');if(!/^[0-9a-f]*$/i.test(h)||h.length%2)throw new Error('The file is not valid hexadecimal.');const b=new Uint8Array(h.length/2);for(let i=0;i<b.length;i++)b[i]=parseInt(h.substr(i*2,2),16);return b;}
  let b64=s.replace(/-/g,'+').replace(/_/g,'/');while(b64.length%4)b64+='=';let bin;try{bin=atob(b64);}catch(_){throw new Error('The file is not valid base64.');}return Uint8Array.from(bin,c=>c.charCodeAt(0));}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
intercept('blobBridgeRun',{async run(){
  if(!blobFile)return alert('Choose a file first.');
  try{const bytes=toBytes(new Uint8Array(await blobFile.arrayBuffer()),$('blobBridgeSource')?.value||'binary'),t=$('blobBridgeTarget')?.value||'base64',b=base(blobFile.name);
    if(t==='base64')save(new Blob([b64(bytes)],{type:'text/plain'}),b+'.b64.txt');
    else if(t==='hex')save(new Blob([hex(bytes)],{type:'text/plain'}),b+'.hex.txt');
    else if(t==='binary')save(new Blob([bytes],{type:'application/octet-stream'}),b+'.bin');
    else if(t==='sql')save(new Blob(["CREATE TABLE blobs (name TEXT, size_bytes INTEGER, content BLOB);\nINSERT INTO blobs (name, size_bytes, content) VALUES ('"+blobFile.name.replace(/'/g,"''")+"', "+bytes.length+", X'"+hex(bytes)+"');\n"],{type:'application/sql'}),b+'.blob.sql');
  }catch(e){alert('BLOB bridge: '+e.message);}
}});

/* ---------- 5. Data Clean and privacy scan ---------- */
rememberFile('cleanInput',null,f=>cleanFile=f);
const cleanReadable=()=>cleanFile&&BROWSER_READ.has(ext(cleanFile.name));
function snake(k){return String(k).trim().replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase()||'column';}
const isEmpty=v=>v===null||v===undefined||(typeof v==='string'&&v.trim()==='');
const isNumLike=v=>typeof v==='number'||(typeof v==='string'&&v.trim()!==''&&!isNaN(Number(v.trim())));
function cleanRows(rows,actions){
  const report={};let cols=keysOf(rows);
  if(actions.includes('lower_columns')){const used=new Set(),map={};cols.forEach(c=>{let n=snake(c),i=2;while(used.has(n))n=snake(c)+'_'+(i++);used.add(n);map[c]=n;});rows=rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[map[k]||k,v])));report.lower_columns={renamed:cols.filter(c=>map[c]!==c).length};cols=cols.map(c=>map[c]);}
  if(actions.includes('trim_strings')){let n=0;rows=rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>{if(typeof v==='string'){const t=v.trim().replace(/\s{2,}/g,' ');if(t!==v)n++;return [k,t];}return [k,v];})));report.trim_strings={cells_changed:n};}
  if(actions.includes('drop_empty_rows')){const before=rows.length;rows=rows.filter(r=>cols.some(c=>!isEmpty(r[c])));report.drop_empty_rows={removed:before-rows.length};}
  if(actions.includes('drop_duplicates')){const before=rows.length,seen=new Set();rows=rows.filter(r=>{const key=JSON.stringify(cols.map(c=>r[c]??null));if(seen.has(key))return false;seen.add(key);return true;});report.drop_duplicates={removed:before-rows.length};}
  if(actions.includes('fill_numeric_zero')){const numeric=cols.filter(c=>{const v=rows.map(r=>r[c]).filter(x=>!isEmpty(x));return v.length&&v.every(isNumLike);});let n=0;rows=rows.map(r=>{const o={...r};numeric.forEach(c=>{if(isEmpty(o[c])){o[c]=0;n++;}});return o;});report.fill_numeric_zero={columns:numeric,cells_filled:n};}
  if(actions.includes('sort_columns')){cols=[...cols].sort((a,b)=>String(a).localeCompare(String(b)));rows=rows.map(r=>Object.fromEntries(cols.map(c=>[c,r[c]??null])));report.sort_columns={order:cols};}
  return {rows,report};
}
intercept('cleanBtn',{
  plan(){return cleanReadable()&&BROWSER_WRITE.has($('cleanTarget')?.value||'csv')?{}:null;},
  async run(){
    try{const actions=[...document.querySelectorAll('.clean-action:checked')].map(x=>x.value);
      if(!actions.length)throw new Error('Select at least one cleaning action.');
      show('cleanOutput','Cleaning in your browser…');
      const rows=await readRows(cleanFile),{rows:clean,report}=cleanRows(rows,actions),fmt=$('cleanTarget')?.value||'csv',out=await writeRows(clean,fmt,{table:snake(base(cleanFile.name))});
      const name=base(cleanFile.name)+'.cleaned.'+out.ext;save(out.blob,name);
      show('cleanOutput',{ok:true,engine:'browser (no upload)',input:cleanFile.name,output:name,rows_in:rows.length,rows_out:clean.length,columns:keysOf(clean).length,actions:report});
    }catch(e){show('cleanOutput','ERROR: '+e.message);}
  }
});
function luhn(d){let s=0,alt=false;for(let i=d.length-1;i>=0;i--){let n=+d[i];if(alt){n*=2;if(n>9)n-=9;}s+=n;alt=!alt;}return s%10===0;}
const VD=[[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]],VP=[[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
function verhoeff(d){let c=0;const a=d.split('').reverse().map(Number);a.forEach((n,i)=>{c=VD[c][VP[i%8][n]];});return c===0;}
const DETECTORS=[
  {type:'email',risk:'medium',re:/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g},
  {type:'aadhaar_number',risk:'high',re:/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,ok:m=>verhoeff(m.replace(/\D/g,''))},
  {type:'pan_number',risk:'high',re:/\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/g},
  {type:'payment_card',risk:'high',re:/\b(?:\d[ -]?){12,18}\d\b/g,ok:m=>{const d=m.replace(/\D/g,'');return d.length>=13&&d.length<=19&&luhn(d)&&!/^(\d)\1+$/.test(d);}},
  {type:'indian_phone',risk:'medium',re:/(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g},
  {type:'international_phone',risk:'medium',re:/\+(?!91)\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{0,4}\b/g},
  {type:'ifsc_code',risk:'low',re:/\b[A-Z]{4}0[A-Z0-9]{6}\b/g},
  {type:'us_ssn',risk:'high',re:/\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g},
  {type:'ip_address',risk:'low',re:/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g},
  {type:'secret_or_api_key',risk:'high',re:/\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g},
];
const NAME_HINTS=[[/(^|_)(e-?mail)/i,'email'],[/phone|mobile|contact_no|whatsapp/i,'phone'],[/aadh?aar|uidai/i,'aadhaar_number'],[/(^|_)pan(_|$)|pan_?(no|number|card)/i,'pan_number'],[/passport/i,'passport'],[/(^|_)(dob|birth)/i,'date_of_birth'],[/address|street|pincode|zip|postal/i,'address'],[/(^|_)(first_?|last_?|full_?)?name(_|$)/i,'person_name'],[/salary|income|ctc|wage/i,'financial'],[/password|passwd|secret|token|api_?key/i,'credential'],[/card|cvv|iban|account_?(no|number)|ifsc/i,'financial_account'],[/gender|religion|caste|health|diagnos/i,'sensitive_attribute']];
const mask=v=>{const s=String(v);if(s.length<=4)return '****';return s.slice(0,2)+'*'.repeat(Math.max(2,s.length-4))+s.slice(-2);};
function privacyScan(rows,name){
  const cols=keysOf(rows),findings=[];
  cols.forEach(c=>{const vals=rows.map(r=>r[c]).filter(v=>!isEmpty(v)).map(String);const per={};
    vals.forEach(v=>{const claimed=[];DETECTORS.forEach(d=>{const ms=(v.match(d.re)||[]).map(m=>m.trim()).filter(m=>(!d.ok||d.ok(m))&&!claimed.some(x=>x.includes(m.replace(/\D/g,''))||m.includes(x)));if(ms.length){claimed.push(...ms.map(m=>/\d/.test(m)?m.replace(/\D/g,''):m));(per[d.type]=per[d.type]||{risk:d.risk,matches:0,samples:[]}).matches+=ms.length;if(per[d.type].samples.length<2)per[d.type].samples.push(mask(ms[0]));}});});
    Object.entries(per).forEach(([type,x])=>findings.push({column:c,type,detected_by:'value pattern',matches:x.matches,share_of_rows:+(x.matches/Math.max(1,vals.length)).toFixed(2),risk:x.risk,masked_samples:x.samples}));
    const hint=NAME_HINTS.find(([re])=>re.test(snake(c)));if(hint&&!findings.some(f=>f.column===c))findings.push({column:c,type:hint[1],detected_by:'column name',matches:vals.length,risk:/aadhaar|pan|passport|credential|financial_account/.test(hint[1])?'high':'medium'});
  });
  const high=findings.filter(f=>f.risk==='high').length,med=findings.filter(f=>f.risk==='medium').length;
  return {engine:'browser (no upload)',file:name,rows:rows.length,columns_scanned:cols.length,overall_risk:high?'high':med?'medium':findings.length?'low':'none found',findings,
    recommendations:findings.length?['Mask or drop the flagged columns before sharing the file.','Use Data Clean to export a copy without them.','Detection is heuristic: review the flagged columns before relying on this report.']:['No common personal-data patterns were found. Detection is heuristic; review before sharing.']};
}
intercept('privacyBtn',{
  plan(){return cleanReadable()?{}:null;},
  async run(){try{show('cleanOutput','Scanning in your browser for likely sensitive data…');show('cleanOutput',privacyScan(await readRows(cleanFile),cleanFile.name));}catch(e){show('cleanOutput','ERROR: '+e.message);}}
});

/* ---------- 6. Batch Lab ---------- */
rememberFile('batchInput','batchDrop',fs=>{batchFiles=Array.isArray(fs)?fs:fs?[fs]:[];});
let lastBatch=null,lastManifest=null;
async function batchOne(file,op,target){
  const t0=performance.now(),r={input:file.name,bytes_in:file.size,op};
  try{
    if(!BROWSER_READ.has(ext(file.name)))throw new Error('.'+ext(file.name)+' needs the Local Engine (no browser reader for this format).');
    const rows=await readRows(file);r.rows=rows.length;
    if(op==='privacy_scan'){const rep=privacyScan(rows,file.name);r.overall_risk=rep.overall_risk;r.findings=rep.findings;}
    else{if(!BROWSER_WRITE.has(target))throw new Error(target+' output needs the Local Engine.');const out=await writeRows(rows,target,{table:snake(base(file.name))});r.output=base(file.name)+'.'+out.ext;r.bytes_out=out.blob.size;r._blob=out.blob;}
    r.ok=true;
  }catch(e){r.ok=false;r.error=e.message||String(e);r._file=file;}
  r.ms=Math.round(performance.now()-t0);return r;
}
async function runBatch(files,op,target){
  show('batchOutput','Processing '+files.length+' file(s) in your browser…');
  const results=[];
  for(let i=0;i<files.length;i++){show('batchOutput','Processing '+(i+1)+'/'+files.length+' · '+files[i].name+' …');results.push(await batchOne(files[i],op,target));await new Promise(r=>setTimeout(r,0));}
  return results;
}
function publish(results,op,target,prior){
  const merged=prior?prior.map(p=>results.find(r=>r.input===p.input)||p):results;
  const ok=merged.filter(r=>r.ok),failed=merged.filter(r=>!r.ok);
  lastBatch={results:merged,op,target};
  const manifest={engine:'browser (no upload)',generated_at:new Date().toISOString(),operation:op,target:op==='privacy_scan'?null:target,total:merged.length,succeeded:ok.length,failed:failed.length,results:merged.map(({_blob,_file,...x})=>x)};
  lastManifest=new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'});
  show('batchOutput',manifest);
  const retry=$('batchRetryBtn'),dl=$('batchDownloadBtn');if(retry)retry.disabled=!failed.length;if(dl)dl.disabled=false;
  return {ok,failed};
}
async function deliver(ok,op){
  if(op==='privacy_scan'||!ok.length)return;
  const fresh=ok.filter(r=>r._blob);if(!fresh.length)return;
  if(fresh.length===1){save(fresh[0]._blob,fresh[0].output);return;}
  if(window.JSZip){const z=new window.JSZip();const used=new Set();fresh.forEach(r=>{let n=r.output;if(used.has(n)){r.output=n=base(r.input)+'_'+ext(r.input)+'.'+ext(n);}let i=2;while(used.has(n))n=base(r.output)+'_'+(i++)+'.'+ext(r.output);used.add(n);z.file(n,r._blob);});z.file('omni-batch-manifest.json',lastManifest);save(await z.generateAsync({type:'blob'}),'omni-batch-output.zip');}
  else fresh.forEach(r=>save(r._blob,r.output));
}
intercept('batchRunBtn',{async run(){
  try{const files=batchFiles.length?batchFiles:[...($('batchInput')?.files||[])];if(!files.length)throw new Error('Choose one or more files first.');
    const op=$('batchOp')?.value||'data_convert',target=$('batchTarget')?.value||'csv';
    const results=await runBatch(files,op,target);
    // settle unique output names first so the manifest matches the zip
    const seen=new Set();results.filter(r=>r.ok&&r.output).forEach(r=>{if(seen.has(r.output))r.output=base(r.input)+'_'+ext(r.input)+'.'+ext(r.output);seen.add(r.output);});
    const {ok}=publish(results,op,target);await deliver(ok,op);
  }catch(e){show('batchOutput','ERROR: '+e.message);}
}});
intercept('batchRetryBtn',{
  plan(){return lastBatch?{}:null;},
  async run(){
    try{const failed=lastBatch.results.filter(r=>!r.ok);if(!failed.length){show('batchOutput','No failed files to retry.');return;}
      const results=await runBatch(failed.map(r=>r._file).filter(Boolean),lastBatch.op,lastBatch.target);
      const before=lastBatch.results;const {ok}=publish(results,lastBatch.op,lastBatch.target,before);await deliver(ok.filter(r=>results.includes(r)),lastBatch.op);
    }catch(e){show('batchOutput','ERROR: '+e.message);}
  }
});
intercept('batchDownloadBtn',{plan(){return lastManifest?{}:null;},async run(){save(lastManifest,'omni-batch-manifest.json');}});

/* ---------- 7. Indic transliteration fallback (no model needed) ---------- */
const SCRIPTS={deva:0x0900,beng:0x0980,guru:0x0A00,gujr:0x0A80,orya:0x0B00,taml:0x0B80,telu:0x0C00,knda:0x0C80,mlym:0x0D00};
const LANG_SCRIPT={hi:'deva',mr:'deva',ne:'deva',sa:'deva',mai:'deva',brx:'deva',doi:'deva',gom:'deva',kok:'deva',bn:'beng',asm:'beng',as:'beng',mni:'beng',pa:'guru',gu:'gujr',or:'orya',ta:'taml',te:'telu',kn:'knda',ml:'mlym'};
const SCHWA_DROP=new Set(['deva','beng','guru','gujr']);
const IND_V={0x05:'a',0x06:'aa',0x07:'i',0x08:'ee',0x09:'u',0x0A:'oo',0x0B:'ri',0x0C:'lri',0x0D:'e',0x0E:'e',0x0F:'e',0x10:'ai',0x11:'o',0x12:'o',0x13:'o',0x14:'au',0x60:'rri',0x61:'lri'};
const CONS={0x15:'k',0x16:'kh',0x17:'g',0x18:'gh',0x19:'ng',0x1A:'ch',0x1B:'chh',0x1C:'j',0x1D:'jh',0x1E:'ny',0x1F:'t',0x20:'th',0x21:'d',0x22:'dh',0x23:'n',0x24:'t',0x25:'th',0x26:'d',0x27:'dh',0x28:'n',0x29:'n',0x2A:'p',0x2B:'ph',0x2C:'b',0x2D:'bh',0x2E:'m',0x2F:'y',0x30:'r',0x31:'r',0x32:'l',0x33:'l',0x34:'zh',0x35:'v',0x36:'sh',0x37:'sh',0x38:'s',0x39:'h',0x58:'q',0x59:'kh',0x5A:'gh',0x5B:'z',0x5C:'r',0x5D:'rh',0x5E:'f',0x5F:'y'};
const SIGN={0x3E:'aa',0x3F:'i',0x40:'ee',0x41:'u',0x42:'oo',0x43:'ri',0x44:'rri',0x45:'e',0x46:'e',0x47:'e',0x48:'ai',0x49:'o',0x4A:'o',0x4B:'o',0x4C:'au',0x62:'lri',0x63:'lri'};
function scriptOf(text){for(const ch of text){const c=ch.codePointAt(0);for(const [k,b] of Object.entries(SCRIPTS))if(c>=b&&c<b+0x80)return k;}return /[A-Za-z]/.test(text)?'latn':null;}
function brahmicToLatin(text,script){
  const b=SCRIPTS[script];let out='',i=0;const cps=[...text].map(c=>c.codePointAt(0));const word=[];// syllables: {t,inh,cons}
  const flush=()=>{if(!word.length)return;
    if(SCHWA_DROP.has(script)){
      // Hindi-style schwa deletion: drop a medial inherent "a" between a voiced syllable and a consonant+vowel syllable (aapka, bachpan) …
      // applied right to left: the final inherent vowel first (bharat, kamal) …
      const last=word[word.length-1];if(word.length>1&&last.inh){last.t=last.t.slice(0,-1);last.inh=false;}
      for(let k=word.length-2;k>=1;k--){const prev=word[k-1],cur=word[k],next=word[k+1];if(cur.inh&&/[aeiou]$/.test(prev.t)&&next.cons&&/[aeiou]/.test(next.t)&&!next.half){cur.t=cur.t.slice(0,-1);cur.inh=false;}}
    }
    out+=word.map(x=>x.t).join('');word.length=0;};
  while(i<cps.length){const c=cps[i],o=c-b;
    if(c>=b&&c<b+0x80){
      if(CONS[o]!==undefined){let cons=CONS[o];let j=i+1;if(cps[j]===b+0x3C){j++;}
        if(cps[j]===b+0x4D){word.push({t:cons,cons:true,half:true});i=j+1;continue;}
        if(SIGN[cps[j]-b]!==undefined&&cps[j]>=b&&cps[j]<b+0x80){word.push({t:cons+SIGN[cps[j]-b],cons:true});i=j+1;continue;}
        word.push({t:cons+'a',cons:true,inh:true});i=j;continue;}
      if(IND_V[o]!==undefined){word.push({t:IND_V[o]});i++;continue;}
      if(o===0x02||o===0x01){word.push({t:script==='deva'||script==='beng'||script==='guru'||script==='gujr'?'n':'m'});i++;continue;}
      if(o===0x03){word.push({t:'h'});i++;continue;}
      if(script==='guru'&&o===0x70){word.push({t:'n'});i++;continue;}// tippi (nasal)
      if(script==='guru'&&o===0x71){const nx=cps[i+1]-b;if(CONS[nx]!==undefined)word.push({t:CONS[nx][0]});i++;continue;}// addak (doubles next consonant)
      if(o>=0x66&&o<=0x6F){flush();out+=String(o-0x66);i++;continue;}
      if(o===0x64||o===0x65){flush();out+='.';i++;continue;}
      if(o===0x50){word.push({t:'om'});i++;continue;}
      i++;continue;}
    if(script==='beng'&&(c===0x09F0||c===0x09F1)){word.push({t:c===0x09F0?'ra':'wa',cons:true,inh:true});i++;continue;}
    flush();out+=String.fromCodePoint(c);i++;}
  flush();return out.replace(/aa(?=\b)/g,'a');
}
function brahmicToBrahmic(text,from,to){const fb=SCRIPTS[from],tb=SCRIPTS[to];return [...text].map(ch=>{const c=ch.codePointAt(0);if(c>=fb&&c<fb+0x80){const n=tb+(c-fb);return String.fromCodePoint(n);}return ch;}).join('');}
const L_VOW=[['aa','आ','ा'],['ai','ऐ','ै'],['au','औ','ौ'],['ee','ई','ी'],['ii','ई','ी'],['oo','ऊ','ू'],['uu','ऊ','ू'],['ri','ऋ','ृ'],['a','अ',''],['i','इ','ि'],['u','उ','ु'],['e','ए','े'],['o','ओ','ो']];
const L_CON=[['chh','छ'],['kh','ख'],['gh','घ'],['ch','च'],['jh','झ'],['th','थ'],['dh','ध'],['ph','फ'],['bh','भ'],['sh','श'],['ng','ङ'],['ny','ञ'],['zh','ऴ'],['k','क'],['g','ग'],['c','क'],['j','ज'],['t','त'],['d','द'],['n','न'],['p','प'],['b','ब'],['m','म'],['y','य'],['r','र'],['l','ल'],['v','व'],['w','व'],['s','स'],['h','ह'],['f','फ़'],['z','ज़'],['q','क़'],['x','क्स']];
function latinToDeva(text){
  return text.replace(/[A-Za-z]+/g,word=>{const w=word.toLowerCase();let i=0,out='',prevCons=false;
    while(i<w.length){const v=L_VOW.find(([k])=>w.startsWith(k,i));if(v){out+=prevCons?v[2]:v[1];prevCons=false;i+=v[0].length;continue;}
      const c=L_CON.find(([k])=>w.startsWith(k,i));if(c){if(prevCons)out+='्';out+=c[1];prevCons=true;i+=c[0].length;continue;}
      out+=w[i];prevCons=false;i++;}
    return out;});
}
function builtInTransliterate(text,target){
  const from=scriptOf(text);if(!from)throw new Error('Could not detect the input script.');
  const tgt=target==='Latn'?'latn':LANG_SCRIPT[target];
  if(!tgt)throw new Error('The built-in transliterator supports Latin and the Brahmic Indian scripts (Hindi, Marathi, Nepali, Bengali, Assamese, Punjabi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam). '+target+' needs the Language Engine model.');
  if(from===tgt)return text;
  if(tgt==='latn')return brahmicToLatin(text,from);
  if(from==='latn'){const d=latinToDeva(text);return tgt==='deva'?d:brahmicToBrahmic(d,'deva',tgt);}
  return brahmicToBrahmic(text,from,tgt);
}
window.OMNI_BROWSER_PLUS.transliterate=builtInTransliterate;
intercept('languageTranslitBtn',{async run(){
  const input=$('languageInputText')?.value?.trim(),out=$('languageTranslitOutput'),st=$('languageTranslitStatus'),btn=$('languageTranslitBtn');
  const status=t=>{if(st)st.textContent=t;};
  if(!input){status('Enter text first.');return;}
  const target=$('languageTranslitTarget')?.value||'Latn';btn.disabled=true;if(out)out.style.display='none';
  status('Transliterating…');
  try{
    let r=null;
    try{if(window.OmniLanguageEngine?.transliterate)r=await window.OmniLanguageEngine.transliterate(input,$('languageSource')?.value,target,{topk:4});}catch(_){r=null;}
    if(r&&r.text){if(out){out.value=r.text;out.style.display='block';}status((r.model||'Language Engine')+' • '+(r.provider||'local')+' • isolated from Assistant/RAG');return;}
    const text=builtInTransliterate(input,target);
    if(out){out.value=text;out.style.display='block';}
    status('Built-in rule-based transliterator • runs in your browser • install the Language Engine model for context-aware results');
  }catch(e){status('Transliteration unavailable: '+(e.message||e));}
  finally{btn.disabled=false;}
}});
})();
