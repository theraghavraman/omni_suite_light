/* Omni BI Interchange + Code Studio action layer
 * Browser-first, dependency-light implementations for the three recently added studios.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const download=(blob,name)=>{
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),2000);
};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ext=n=>(n.split('.').pop()||'').toLowerCase();

/* ---------------- BI INTERCHANGE ---------------- */
const bi={files:[],model:null,output:''};

function biSetFiles(files){
  bi.files=[...files];
  const box=$('vizInterchangeFiles'); if(!box)return;
  box.innerHTML=bi.files.map((f,i)=>'<div class="viz-file-item"><b>'+esc(f.name)+'</b><span>'+((f.size/1024).toFixed(1))+' KB • '+(i+1)+'</span></div>').join('');
}
function biDropBind(){
  const input=$('vizInterchangeInput'),drop=$('vizInterchangeDrop');
  if(!input||!drop)return;
  const set=e=>{const fs=e.target.files||[];if(fs.length)biSetFiles(fs);};
  input.addEventListener('change',set);
  drop.addEventListener('click',e=>{if(e.target!==input)input.click();});
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');if(e.dataTransfer.files.length)biSetFiles(e.dataTransfer.files);});
}
function extractXmlNames(text){
  const fields=[],measures=[],dimensions=[],filters=[],visuals=[];
  const add=(arr,v)=>{v=String(v||'').trim();if(v&&!arr.includes(v))arr.push(v);};
  for(const m of text.matchAll(/(?:caption|name|column|field)[="']+([^"']{1,160})["']/gi))add(fields,m[1]);
  for(const m of text.matchAll(/(?:calculation|calculatedfield|measure)[\s>][\s\S]{0,160}?(?:name|caption)=["']([^"']+)["']/gi))add(measures,m[1]);
  for(const m of text.matchAll(/<worksheet[^>]*name=["']([^"']+)/gi))add(visuals,m[1]);
  for(const m of text.matchAll(/<dashboard[^>]*name=["']([^"']+)/gi))add(visuals,m[1]);
  for(const m of text.matchAll(/(?:filter|slicer)[^>]*(?:field|column|name)=["']([^"']+)/gi))add(filters,m[1]);
  for(const f of fields) if(!measures.includes(f)&&!dimensions.includes(f))dimensions.push(f);
  return {fields,measures,dimensions,filters,visuals};
}
function extractJsonModel(obj){
  const model={fields:[],measures:[],dimensions:[],filters:[],visuals:[],sources:[]};
  const walk=(v,key='')=>{
    if(v==null)return;
    if(Array.isArray(v)){v.slice(0,1000).forEach(x=>walk(x,key));return;}
    if(typeof v==='object'){for(const [k,x] of Object.entries(v)){const kl=k.toLowerCase();
      if(typeof x==='string' && /name|caption|field|column|measure|dimension|filter|visual|table/.test(kl) && x.length<180){
        const val=x.trim(); if(!val)return;
        if(/measure/.test(kl))model.measures.push(val);
        else if(/filter/.test(kl))model.filters.push(val);
        else if(/visual/.test(kl))model.visuals.push(val);
        else if(/field|column|dimension/.test(kl))model.fields.push(val);
        else if(/table/.test(kl))model.sources.push(val);
      } else walk(x,k);
    }}
  };
  walk(obj);
  for(const k of ['fields','measures','dimensions','filters','visuals','sources'])model[k]=[...new Set(model[k])];
  model.dimensions=model.fields.filter(x=>!model.measures.includes(x));
  return model;
}
async function biReadFile(file){
  const e=ext(file.name);
  if(e==='twbx'){
    if(!window.JSZip)throw new Error('JSZip is not loaded; TWBX extraction is unavailable.');
    const z=await JSZip.loadAsync(await file.arrayBuffer());
    const entries=Object.values(z.files).filter(x=>!x.dir&&/\.(twb|xml|json|txt)$/i.test(x.name)).slice(0,100);
    const parts=[];
    for(const f of entries)parts.push('<!-- '+f.name+' -->\n'+await f.async('string'));
    return parts.join('\n');
  }
  if(e==='pbix')return '';
  return await file.text();
}
async function biAnalyze(){
  if(!bi.files.length){alert('Choose at least one BI/visualization file first.');return;}
  const sources=[],aggregate={fields:[],measures:[],dimensions:[],filters:[],visuals:[],tables:[],columns:[]},notes=[];
  for(const file of bi.files){
    const e=ext(file.name),text=await biReadFile(file);
    sources.push({name:file.name,format:e||'unknown',bytes:file.size});
    if(e==='pbix'){notes.push(file.name+': PBIX is proprietary binary; browser analysis is limited. Use PBIP/PBIR/TMDL for portable semantics.');continue;}
    let m;
    if(['json','pbip','pbir'].includes(e)){try{m=extractJsonModel(JSON.parse(text));}catch{m=extractXmlNames(text);}}
    else m=(/<workbook|<datasource/i.test(text)&&extractTableauXml(text))||extractXmlNames(text);
    for(const k of ['fields','measures','dimensions','filters','visuals','tables','columns'])aggregate[k].push(...(m[k]||[]));
  }
  for(const k of Object.keys(aggregate))aggregate[k]=[...new Set(aggregate[k])].slice(0,500);
  bi.model={schema:'OMNI-VIZ/1.0',generatedAt:new Date().toISOString(),sources,semantic:aggregate,notes};
  $('vizOutput').textContent=JSON.stringify(bi.model,null,2);
  const stats={tables:aggregate.tables.length,fields:aggregate.fields.length,measures:aggregate.measures.length,dimensions:aggregate.dimensions.length,filters:aggregate.filters.length,visuals:aggregate.visuals.length,notes:notes.length};
  $('vizAuditGrid').innerHTML=Object.entries(stats).map(([k,v])=>'<div class="viz-audit-stat"><b>'+v+'</b><span>'+k+'</span></div>').join('');
  $('vizDownloadBtn').disabled=false;
}
function biClean(n){return String(n||'').replace(/^\[|\]$/g,'').replace(/\]\.\[/g,'.').trim();}
function extractTableauXml(text){
  const doc=new DOMParser().parseFromString(text.replace(/<!--[\s\S]*?-->/g,''),'application/xml');
  if(doc.querySelector('parsererror'))return null;
  const tables=[],columns=[],visuals=[],filters=[],seen=new Set();
  doc.querySelectorAll('datasource').forEach(ds=>{
    const dsName=ds.getAttribute('caption')||ds.getAttribute('name')||'';
    if(!dsName||/^Parameters$/i.test(dsName))return;
    if(!tables.includes(dsName))tables.push(dsName);
    ds.querySelectorAll(':scope > column, column').forEach(c=>{
      const raw=c.getAttribute('caption')||c.getAttribute('name');if(!raw)return;
      const name=biClean(raw);if(!name||/^(Number of Records|:Measure Names|Measure Values)$/i.test(name))return;
      const key=dsName+'|'+name;if(seen.has(key))return;seen.add(key);
      const dt=(c.getAttribute('datatype')||'').toLowerCase();
      let role=(c.getAttribute('role')||'').toLowerCase();
      if(!role)role=/^(real|integer|float|double|number)$/.test(dt)?'measure':'dimension';
      const calc=c.querySelector('calculation');
      columns.push({table:dsName,name,role,datatype:dt||'string',aggregation:(c.getAttribute('aggregation')||(role==='measure'?'Sum':'')),formula:calc?.getAttribute('formula')||''});
    });
  });
  doc.querySelectorAll('worksheet[name], dashboard[name]').forEach(w=>visuals.push(w.getAttribute('name')));
  doc.querySelectorAll('filter[column]').forEach(f=>{const v=biClean(String(f.getAttribute('column')).split('].[').pop());if(v&&!filters.includes(v))filters.push(v);});
  if(!columns.length&&!tables.length)return null;
  const measures=columns.filter(c=>c.role==='measure').map(c=>c.name),dimensions=columns.filter(c=>c.role!=='measure').map(c=>c.name);
  return {fields:[...new Set(columns.map(c=>c.name))],measures:[...new Set(measures)],dimensions:[...new Set(dimensions)],filters,visuals,tables,columns};
}
function biQuote(name,dialect){
  const d=String(dialect||'').toLowerCase();
  if(/sql server|t-sql|tsql/.test(d))return '['+String(name).replace(/]/g,']]')+']';
  if(/mysql|bigquery/.test(d))return '`'+String(name).replace(/`/g,'``')+'`';
  return '"'+String(name).replace(/"/g,'""')+'"';
}
function biSql(){
  const m=bi.model?.semantic;if(!m)throw new Error('Analyze the BI definition first.');
  const dialect=$('vizSqlDialect')?.value||'ANSI SQL';
  const typed=($('vizExcelTable')?.value||'').trim();
  const cols=m.columns||[];
  const table=(typed&&typed!=='Data')?typed:(m.tables?.[0]||typed||'Data');
  const q=x=>biQuote(x,dialect);
  if(cols.length){
    const own=cols.filter(c=>!m.tables?.length||c.table===m.tables[0]||table===typed);
    const dims=own.filter(c=>c.role!=='measure'&&!c.formula),meas=own.filter(c=>c.role==='measure'&&!c.formula),calcs=own.filter(c=>c.formula);
    const aggMap={sum:'SUM',avg:'AVG',average:'AVG',count:'COUNT',countd:'COUNT(DISTINCT',min:'MIN',max:'MAX',median:'MEDIAN'};
    const sel=[...dims.map(c=>'  '+q(c.name)),...meas.map(c=>{const a=aggMap[String(c.aggregation||'sum').toLowerCase()]||'SUM';return '  '+(a==='COUNT(DISTINCT'?'COUNT(DISTINCT '+q(c.name)+')':a+'('+q(c.name)+')')+' AS '+q(c.name)})];
    let out='SELECT\n'+(sel.join(',\n')||'  *')+'\nFROM '+q(table);
    if(dims.length&&meas.length)out+='\nGROUP BY\n'+dims.map(c=>'  '+q(c.name)).join(',\n');
    if(dims.length&&meas.length)out+='\nORDER BY\n  '+q(meas[0].name)+' DESC';
    out+=';\n';
    if(calcs.length)out+='\n-- Calculated fields (translate the expression to SQL before use):\n'+calcs.map(c=>'--   '+c.name+' = '+c.formula.replace(/\s+/g,' ')).join('\n')+'\n';
    if(m.filters?.length)out+='\n-- Filters used in the workbook: '+m.filters.join(', ')+'\n';
    if(m.visuals?.length)out+='-- Sheets/dashboards: '+m.visuals.join(', ')+'\n';
    return out+'-- OMNI-VIZ semantic reconstruction · Dialect: '+dialect;
  }
  const fields=[...new Set([...(m.dimensions||[]),...(m.measures||[])])].map(biClean).filter(Boolean).slice(0,80);
  const select=fields.length?fields.map(x=>'  '+q(x)).join(',\n'):'  *';
  return 'SELECT\n'+select+'\nFROM '+q(table)+';\n\n-- OMNI-VIZ semantic reconstruction\n-- Dialect: '+dialect;
}
function biExcel(){
  const m=bi.model?.semantic;if(!m)throw new Error('Analyze the BI definition first.');
  const table=($('vizExcelTable')?.value||'Data').replace(/[^A-Za-z0-9_]/g,'_');
  const rows=['Excel reconstruction template','Source table: '+table,''];
  (m.measures||[]).forEach((x,i)=>rows.push('Measure '+(i+1)+': '+x+'  =  '+table+'[['+x+']]'));
  (m.dimensions||[]).forEach((x,i)=>rows.push('Dimension '+(i+1)+': '+x+'  →  '+table+'[['+x+']]'));
  rows.push('','Use structured-reference formulas and validate aggregation semantics before production use.');
  return rows.join('\n');
}
function biGenerate(){
  if(!bi.model){alert('Analyze & Build OMNI-VIZ first.');return;}
  const mode=$('vizOutputMode')?.value||'omni';let out='';
  if(mode==='omni')out=JSON.stringify(bi.model,null,2);
  else if(mode==='sql')out=biSql();
  else if(mode==='excel')out=biExcel();
  else if(mode==='audit')out=JSON.stringify({schema:'OMNI-VIZ/1.0',sources:bi.model.sources,semantic:bi.model.semantic,notes:bi.model.notes,fidelity:'heuristic browser reconstruction'},null,2);
  else if(mode==='xlsx'){
    if(!window.XLSX){alert('SheetJS is not available in this browser. Use CSV/Excel functions or the Local Engine.');return;}
    const rows=[['OMNI-VIZ field','Type'],...(bi.model.semantic.fields||[]).map(x=>[x,'Field']),...(bi.model.semantic.measures||[]).map(x=>[x,'Measure'])];
    const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'OMNI-VIZ');
    const bytes=XLSX.write(wb,{bookType:'xlsx',type:'array'});download(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'omni-viz-reconstruction.xlsx');out='Excel workbook generated and downloaded.';
  }
  bi.output=out;$('vizOutput').textContent=out;$('vizDownloadBtn').disabled=!out;
}
function biDownload(){
  if(!bi.output)return;
  const mode=$('vizOutputMode')?.value||'omni';
  const extn=mode==='xlsx'?'txt':mode==='omni'?'json':mode==='sql'?'sql':mode==='excel'?'txt':'json';
  download(new Blob([bi.output],{type:'text/plain;charset=utf-8'}),'omni-viz-output.'+extn);
}
function biReset(){bi.files=[];bi.model=null;bi.output='';$('vizInterchangeInput').value='';$('vizInterchangeFiles').innerHTML='';$('vizAuditGrid').innerHTML='';$('vizOutput').textContent='Load a file and run Analyze & Build OMNI-VIZ.';$('vizDownloadBtn').disabled=true;}

/* ---------------- CODE STUDIO ---------------- */
const code={file:null,result:''};
function detectLanguage(text,name){
  const e=ext(name||'');
  const map={py:'Python',js:'JavaScript',ts:'TypeScript',java:'Java',cs:'C#',cpp:'C++',cc:'C++',cxx:'C++',c:'C',go:'Go',rs:'Rust',kt:'Kotlin',swift:'Swift',php:'PHP',rb:'Ruby',sh:'Bash',bash:'Bash',sql:'SQL'};
  if(map[e])return map[e];
  if(/\bpublic\s+static\s+void\s+main\b|System\.out\.println/.test(text))return 'Java';
  if(/\bdef\s+\w+\s*\(|print\s*\(/.test(text))return 'Python';
  if(/console\.log|const\s+\w+\s*=|=>/.test(text))return 'JavaScript';
  if(/SELECT\s+.+\s+FROM\s+/is.test(text))return 'SQL';
  return 'Auto';
}
function codeIndentBlocks(text){
  // Turn source into [{depth, text}] lines. Brace languages use { } nesting; Python-style uses indentation.
  const lines=String(text).replace(/\t/g,'    ').split(/\r?\n/);
  const braces=/[{}]/.test(text)&&!/^\s*def\s+\w+.*:\s*$/m.test(text);
  const out=[];
  if(braces){
    let depth=0;
    for(const raw of lines){
      let l=raw.trim();if(!l)continue;
      while(l.startsWith('}')){depth=Math.max(0,depth-1);l=l.slice(1).trim();}
      if(!l){continue;}
      const opens=(l.match(/\{/g)||[]).length,closes=(l.match(/\}/g)||[]).length;
      out.push({depth,text:l.replace(/\s*\{\s*$/,'').replace(/^\}\s*/,'')});
      depth=Math.max(0,depth+opens-closes);
    }
  }else{
    const stack=[0];
    for(const raw of lines){
      if(!raw.trim())continue;
      const ind=raw.match(/^\s*/)[0].length;
      while(ind<stack[stack.length-1])stack.pop();
      if(ind>stack[stack.length-1])stack.push(ind);
      out.push({depth:stack.length-1,text:raw.trim()});
    }
  }
  return out;
}
function pseudoCode(text){
  const rows=codeIndentBlocks(text),out=['BEGIN PROGRAM'];
  const opens=[];
  const pad=d=>'  '.repeat(d+1);
  const closeTo=d=>{while(opens.length&&opens[opens.length-1]>=d){const x=opens.pop();out.push(pad(x)+'END');}};
  for(const {depth,text:l} of rows){
    let m,line;const isElse=/^(else\b|elif\b|else\s*if\b|catch\b|except\b|finally\b)/i.test(l);
    closeTo(isElse?depth+1:depth);
    if(isElse&&opens.length&&opens[opens.length-1]===depth)opens.pop();
    if(/^(\/\/|#|\/\*|\*|--)/.test(l)){out.push(pad(depth)+'NOTE: '+l.replace(/^(\/\/|#|\/\*+|\*+\/?|--)\s*/,''));continue;}
    let block=true;
    if((m=l.match(/^(?:async\s+)?(?:def|function)\s+(\w+)\s*\(([^)]*)\)/)))line='PROCEDURE '+m[1]+'('+m[2].replace(/:\s*[\w\[\]<>|]+/g,'')+')';
    else if((m=l.match(/^(?:public|private|protected|static|\s)*[\w<>\[\],]+\s+(\w+)\s*\(([^)]*)\)\s*$/))&&!/^(if|for|while|switch|return)\b/.test(l))line='PROCEDURE '+m[1]+'('+m[2]+')';
    else if((m=l.match(/^class\s+(\w+)/)))line='CLASS '+m[1];
    else if((m=l.match(/^(?:else\s*if|elif)\s*\(?(.*?)\)?\s*:?$/)))line='ELSE IF '+m[1]+' THEN';
    else if((m=l.match(/^if\s*\(?(.*?)\)?\s*:?$/)))line='IF '+m[1]+' THEN';
    else if(/^else\s*:?$/.test(l))line='ELSE';
    else if((m=l.match(/^for\s+(\w+)\s+in\s+range\((.*)\)\s*:$/))){const a=m[2].split(',').map(x=>x.trim());line='FOR '+m[1]+' FROM '+(a.length>1?a[0]:'0')+' TO '+(a.length>1?a[1]:a[0])+' - 1';}
    else if((m=l.match(/^for\s+(\w+(?:\s*,\s*\w+)*)\s+in\s+(.+?):$/)))line='FOR EACH '+m[1]+' IN '+m[2];
    else if((m=l.match(/^for\s*\(\s*(?:const|let|var|auto|[\w<>]+)?\s*(\w+)\s+(?:of|in|:)\s+(.+?)\)$/)))line='FOR EACH '+m[1]+' IN '+m[2];
    else if((m=l.match(/^for\s*\((.*?);(.*?);(.*?)\)$/)))line='FOR ('+m[1].trim()+'; WHILE '+m[2].trim()+'; STEP '+m[3].trim()+')';
    else if((m=l.match(/^while\s*\(?(.*?)\)?\s*:?$/)))line='WHILE '+m[1]+' DO';
    else if(/^(try)\s*:?$/.test(l))line='TRY';
    else if((m=l.match(/^(?:catch|except)\s*\(?([^):]*)\)?\s*:?$/)))line='ON ERROR'+(m[1]?' '+m[1].trim():'');
    else{
      block=/:\s*$/.test(l)&&!/^(case|default)\b/.test(l)&&!/[{(\[]\s*$/.test(l)&&/^(with|switch)\b/.test(l);
      if((m=l.match(/^(?:print|console\.log|System\.out\.println|Console\.WriteLine|puts|echo|fmt\.Println)\s*\(?(.*?)\)?;?$/)))line='OUTPUT '+m[1];
      else if((m=l.match(/^return\b\s*(.*?);?$/)))line='RETURN '+m[1];
      else if((m=l.match(/^(?:const|let|var|int|float|double|String|string|auto|bool|boolean|long|char)\s+(\w+)\s*(?::\s*[\w\[\]<>|]+)?\s*=\s*(.+?);?$/)))line='SET '+m[1]+' TO '+m[2];
      else if((m=l.match(/^(\w+(?:\.\w+|\[[^\]]+\])*)\s*([+\-*/]?=)\s*(.+?);?$/))&&!/==/.test(m[2]))line=(m[2]==='='?'SET '+m[1]+' TO '+m[3]:'UPDATE '+m[1]+' '+m[2]+' '+m[3]);
      else line='DO '+l.replace(/;$/,'');
    }
    out.push(pad(depth)+line);
    if(block)opens.push(depth);
  }
  closeTo(0);
  out.push('END PROGRAM');
  return out.join('\n');
}
function pyExprToJs(e){
  return e
    .replace(/\bf(["'])(.*?)\1/g,(m,q,b)=>'`'+b.replace(/`/g,'\\`').replace(/\{([^}]+)\}/g,'${$1}')+'`')
    .replace(/\s+is\s+not\s+None\b/g,' !== null').replace(/\s+is\s+None\b/g,' === null').replace(/\s+not\s+in\s+/g,' NOTIN ')
    .replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false').replace(/\bNone\b/g,'null')
    .replace(/\bnot\s+/g,'!').replace(/(\S+) NOTIN (\S+)/g,'!$2.includes($1)').replace(/(\w+|'[^']*'|"[^"]*")\s+in\s+(\w+)(?=\s*($|\)|&&|\|\|))/g,'$2.includes($1)').replace(/\s+and\s+/g,' && ').replace(/\s+or\s+/g,' || ')
    .replace(/\blen\(([^()]+)\)/g,'$1.length').replace(/\bstr\(([^()]+)\)/g,'String($1)')
    .replace(/\bint\(([^()]+)\)/g,'parseInt($1, 10)').replace(/\bfloat\(([^()]+)\)/g,'parseFloat($1)')
    .replace(/\.append\(/g,'.push(').replace(/(\S)\s*\/\/\s*(\S+)/g,'Math.floor($1 / $2)')
    .replace(/\bprint\((.*)\)$/,'console.log($1)').replace(/\.upper\(\)/g,'.toUpperCase()').replace(/\.lower\(\)/g,'.toLowerCase()').replace(/\.strip\(\)/g,'.trim()')
    ;
}
function pythonToJs(text,ts){
  const rows=codeIndentBlocks(text),out=[],open=[],declared=new Set();
  const pad=d=>'  '.repeat(d);
  const close=d=>{while(open.length&&open[open.length-1]>=d)out.push(pad(open.pop())+'}');};
  for(const {depth,text:l0} of rows){
    let l=l0.replace(/\s+#.*$/,''),m;
    if(/^#/.test(l0)){close(depth);out.push(pad(depth)+'// '+l0.replace(/^#\s?/,''));continue;}
    const cont=/^(elif|else)\b/.test(l)||/^(except|finally)\b/.test(l);
    if(cont){close(depth+1);if(open.length&&open[open.length-1]===depth){open.pop();}}else close(depth);
    const pre=cont?pad(depth)+'} ':pad(depth);
    if((m=l.match(/^def\s+(\w+)\s*\((.*?)\)\s*(?:->\s*[\w\[\], ]+)?:$/))){const params=m[2].split(',').map(x=>x.trim()).filter(x=>x&&x!=='self').map(x=>ts?x.replace(/:\s*int|:\s*float/,': number').replace(/:\s*str/,': string').replace(/:\s*bool/,': boolean'):x.replace(/:\s*[\w\[\], ]+/,'')).join(', ');out.push(pre+'function '+m[1]+'('+params+') {');open.push(depth);continue;}
    if((m=l.match(/^class\s+(\w+)(?:\((\w+)\))?:$/))){out.push(pre+'class '+m[1]+(m[2]&&m[2]!=='object'?' extends '+m[2]:'')+' {');open.push(depth);continue;}
    if((m=l.match(/^if\s+(.+):$/))){out.push(pre+'if ('+pyExprToJs(m[1])+') {');open.push(depth);continue;}
    if((m=l.match(/^elif\s+(.+):$/))){out.push(pre+'else if ('+pyExprToJs(m[1])+') {');open.push(depth);continue;}
    if(/^else:$/.test(l)){out.push(pre+'else {');open.push(depth);continue;}
    if((m=l.match(/^for\s+(\w+)\s+in\s+range\((.+)\):$/))){const a=m[2].split(',').map(x=>pyExprToJs(x.trim()));const [s,e,st]=a.length===1?['0',a[0],'1']:[a[0],a[1],a[2]||'1'];out.push(pre+'for (let '+m[1]+' = '+s+'; '+m[1]+(String(st).startsWith('-')?' > ':' < ')+e+'; '+m[1]+(st==='1'?'++':' += '+st)+') {');open.push(depth);continue;}
    if((m=l.match(/^for\s+(\w+)\s*,\s*(\w+)\s+in\s+enumerate\((.+)\):$/))){out.push(pre+'for (const ['+m[1]+', '+m[2]+'] of '+pyExprToJs(m[3])+'.entries()) {');open.push(depth);continue;}
    if((m=l.match(/^for\s+(\w+)\s*,\s*(\w+)\s+in\s+(.+)\.items\(\):$/))){out.push(pre+'for (const ['+m[1]+', '+m[2]+'] of Object.entries('+pyExprToJs(m[3])+')) {');open.push(depth);continue;}
    if((m=l.match(/^for\s+(\w+)\s+in\s+(.+):$/))){out.push(pre+'for (const '+m[1]+' of '+pyExprToJs(m[2])+') {');open.push(depth);continue;}
    if((m=l.match(/^while\s+(.+):$/))){out.push(pre+'while ('+pyExprToJs(m[1])+') {');open.push(depth);continue;}
    if(/^try:$/.test(l)){out.push(pre+'try {');open.push(depth);continue;}
    if((m=l.match(/^except(?:\s+[\w.]+)?(?:\s+as\s+(\w+))?:$/))){out.push(pre+'catch ('+(m[1]||'err')+') {');open.push(depth);continue;}
    if(/^finally:$/.test(l)){out.push(pre+'finally {');open.push(depth);continue;}
    if(/^pass$/.test(l)){out.push(pad(depth)+'// pass');continue;}
    if(/^(import|from)\s/.test(l)){out.push(pad(depth)+'// TODO (import): '+l);continue;}
    if((m=l.match(/^(\w+)\s*=\s*(.+)$/))&&!/^(==)/.test(m[2])){const key=depth+':'+m[1];const kw=declared.has(m[1])?'':'let ';declared.add(m[1]);out.push(pad(depth)+kw+m[1]+' = '+pyExprToJs(m[2])+';');continue;}
    out.push(pad(depth)+pyExprToJs(l)+(/[;{}]$/.test(l)?'':';'));
  }
  close(0);
  return out.join('\n');
}
function jsExprToPy(e){
  return e
    .replace(/`([^`]*)`/g,(m,b)=>'f"'+b.replace(/"/g,'\\"').replace(/\$\{([^}]+)\}/g,'{$1}')+'"')
    .replace(/===/g,'==').replace(/!==/g,'!=').replace(/&&/g,' and ').replace(/\|\|/g,' or ').replace(/!(?!=)\s*/g,'not ')
    .replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\b(null|undefined)\b/g,'None')
    .replace(/(\w+(?:\.\w+)*)\.length\b/g,'len($1)').replace(/\.push\(/g,'.append(').replace(/\bString\(/g,'str(').replace(/\bparseInt\(([^,()]+)(?:,\s*10)?\)/g,'int($1)').replace(/\bparseFloat\(/g,'float(')
    .replace(/\.toUpperCase\(\)/g,'.upper()').replace(/\.toLowerCase\(\)/g,'.lower()').replace(/\.trim\(\)/g,'.strip()').replace(/\bMath\.floor\(([^()]+)\s*\/\s*([^()]+)\)/g,'$1 // $2')
    .replace(/\bconsole\.log\(/g,'print(').replace(/\s+/g,' ').trim();
}
function jsToPython(text){
  const rows=codeIndentBlocks(text),out=[];let last=-1;
  for(const {depth,text:l0} of rows){
    let l=l0.replace(/;\s*$/,''),m;const pad='    '.repeat(depth);
    if(/^\/\//.test(l)){out.push(pad+'# '+l.replace(/^\/\/\s?/,''));continue;}
    l=l.replace(/\s*\/\/.*$/,'');
    if((m=l.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\((.*?)\)(?:\s*:\s*[\w<>\[\]|]+)?$/))){out.push(pad+'def '+m[1]+'('+m[2].replace(/:\s*[\w<>\[\]|]+/g,'').replace(/\s*=\s*/g,'=')+'):');continue;}
    if((m=l.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\((.*?)\)\s*=>$/))){out.push(pad+'def '+m[1]+'('+m[2]+'):');continue;}
    if((m=l.match(/^class\s+(\w+)(?:\s+extends\s+(\w+))?$/))){out.push(pad+'class '+m[1]+(m[2]?'('+m[2]+')':'')+':');continue;}
    if((m=l.match(/^(?:\}\s*)?else\s+if\s*\((.*)\)$/))){out.push(pad+'elif '+jsExprToPy(m[1])+':');continue;}
    if((m=l.match(/^if\s*\((.*)\)$/))){out.push(pad+'if '+jsExprToPy(m[1])+':');continue;}
    if(/^(?:\}\s*)?else$/.test(l)){out.push(pad+'else:');continue;}
    if((m=l.match(/^for\s*\(\s*(?:let|var)\s+(\w+)\s*=\s*(.+?);\s*\1\s*(<=|<|>=|>)\s*(.+?);\s*\1\s*(\+\+|--|\+=\s*\d+|-=\s*\d+)\s*\)$/))){const step=m[5]==='++'?'':m[5]==='--'?', -1':', '+(m[5].startsWith('-')?'-':'')+m[5].replace(/[+\-=\s]/g,'');let end=jsExprToPy(m[4]);if(m[3]==='<=')end=end+' + 1';if(m[3]==='>=')end=end+' - 1';out.push(pad+'for '+m[1]+' in range('+(jsExprToPy(m[2])==='0'&&!step?'':jsExprToPy(m[2])+', ')+end+step+'):');continue;}
    if((m=l.match(/^for\s*\(\s*(?:const|let|var)\s+\[(\w+)\s*,\s*(\w+)\]\s+of\s+Object\.entries\((.+)\)\s*\)$/))){out.push(pad+'for '+m[1]+', '+m[2]+' in '+jsExprToPy(m[3])+'.items():');continue;}
    if((m=l.match(/^for\s*\(\s*(?:const|let|var)\s+(\w+)\s+(?:of|in)\s+(.+)\)$/))){out.push(pad+'for '+m[1]+' in '+jsExprToPy(m[2])+':');continue;}
    if((m=l.match(/^while\s*\((.*)\)$/))){out.push(pad+'while '+jsExprToPy(m[1])+':');continue;}
    if(/^try$/.test(l)){out.push(pad+'try:');continue;}
    if((m=l.match(/^(?:\}\s*)?catch\s*\(?\s*(\w*)\s*\)?$/))){out.push(pad+'except Exception'+(m[1]?' as '+m[1]:'')+':');continue;}
    if(/^(?:\}\s*)?finally$/.test(l)){out.push(pad+'finally:');continue;}
    if(/^(import|export)\s/.test(l)){out.push(pad+'# TODO (module): '+l);continue;}
    if((m=l.match(/^(?:const|let|var)\s+(\w+)(?:\s*:\s*[\w<>\[\]|]+)?\s*=\s*(.+)$/))){out.push(pad+m[1]+' = '+jsExprToPy(m[2]));continue;}
    out.push(pad+jsExprToPy(l));
  }
  // Python needs a body in empty blocks
  for(let i=0;i<out.length;i++){if(/:\s*$/.test(out[i])&&!/^\s*#/.test(out[i])){const ind=out[i].match(/^\s*/)[0].length,next=out[i+1];if(!next||next.match(/^\s*/)[0].length<=ind)out.splice(i+1,0,' '.repeat(ind+4)+'pass');}}
  return out.join('\n');
}
function translateSyntax(text,src,target){
  if(target==='Pseudo Code')return pseudoCode(text);
  if(src===target||target==='Auto')return text;
  const hashLangs=['Python','Ruby','Bash'];
  const note=(hashLangs.includes(target)?'# ':target==='SQL'?'-- ':'// ')+'OMNI browser translation: '+src+' → '+target+' (review library/API calls before production use)\n';
  let s=text;
  if(src==='Python'&&(target==='JavaScript'||target==='TypeScript'))return note+pythonToJs(text,target==='TypeScript');
  if((src==='JavaScript'||src==='TypeScript')&&target==='Python')return note+jsToPython(text);
  if(src==='TypeScript'&&target==='JavaScript')return note+text.replace(/(\w)\s*:\s*(number|string|boolean|any|void|unknown|never|[A-Z]\w*(?:<[^>]+>)?(?:\[\])?)(?=\s*[,)=;{])/g,'$1').replace(/^\s*(?:export\s+)?(?:interface|type)\s+\w+[\s\S]*?^\}\s*$/gm,'');
  if(src==='JavaScript'&&target==='TypeScript')return note+text;
  if(target==='Python'){
    s=s.replace(/\bSystem\.out\.println\((.*?)\);/g,'print($1)').replace(/\bconsole\.log\((.*?)\);?/g,'print($1)');
    s=s.replace(/\bpublic\s+static\s+void\s+main\s*\([^)]*\)\s*\{/,'def main():');
    s=s.replace(/\belse\s+if\s*\((.*?)\)\s*\{/g,'elif $1:').replace(/\bif\s*\((.*?)\)\s*\{/g,'if $1:').replace(/\belse\s*\{/g,'else:');
    s=s.replace(/\bfor\s*\(\s*(?:int|let|var)\s+(\w+)\s*=\s*0;\s*\1\s*<\s*(\w+)\s*;\s*\1\+\+\s*\)\s*\{/g,'for $1 in range($2):');
    s=s.replace(/;\s*$/gm,'').replace(/^\s*\}\s*$/gm,'').replace(/\btrue\b/g,'True').replace(/\bfalse\b/g,'False').replace(/\bnull\b/g,'None').replace(/&&/g,' and ').replace(/\|\|/g,' or ').replace(/\/\//g,'#');
  }else if(target==='JavaScript'||target==='TypeScript'){
    s=s.replace(/\bSystem\.out\.println\((.*?)\);/g,'console.log($1);').replace(/\bConsole\.WriteLine\((.*?)\);/g,'console.log($1);');
    s=s.replace(/\bpublic\s+static\s+void\s+main\s*\([^)]*\)\s*\{/,'function main() {');
  }else if(target==='Java'){
    s=s.replace(/\bprint\((.*?)\)/g,'System.out.println($1);').replace(/\bconsole\.log\((.*?)\);?/g,'System.out.println($1);');
    s=s.replace(/\bdef\s+(\w+)\s*\((.*?)\)\s*:/g,'public static void $1($2) {');
    s=s.replace(/\bif\s+(.+?):/g,'if ($1) {').replace(/\belif\s+(.+?):/g,'else if ($1) {').replace(/\belse:/g,'else {');
  }else if(target==='C#'){
    s=s.replace(/\bprint\((.*?)\)/g,'Console.WriteLine($1);').replace(/\bconsole\.log\((.*?)\);?/g,'Console.WriteLine($1);').replace(/\bSystem\.out\.println\((.*?)\);/g,'Console.WriteLine($1);');
  }else if(target==='C++'||target==='C'){
    s=s.replace(/\bprint\((.*?)\)/g,target==='C'?'printf("%s\\n", $1);':'std::cout << $1 << std::endl;').replace(/\bconsole\.log\((.*?)\);?/g,target==='C'?'printf("%s\\n", $1);':'std::cout << $1 << std::endl;');
  }else if(target==='SQL'){
    s=s.replace(/\bif\s*\((.*?)\)\s*\{[\s\S]*?\}/g,'-- IF $1').replace(/console\.log\((.*?)\);?/g,'-- OUTPUT $1');
  }
  return note+s;
}
function codeSetFile(f){
  if(!f)return;code.file=f;
  $('codeFileName').value=f.name;
  $('codeDrop').style.display='none';
  f.text().then(t=>{$('codeSource').value=t;});
}
function codeBind(){
  const input=$('codeInput'),drop=$('codeDrop');if(!input||!drop)return;
  input.addEventListener('change',e=>codeSetFile(e.target.files[0]));
  drop.addEventListener('click',e=>{if(e.target!==input)input.click();});
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');codeSetFile(e.dataTransfer.files[0]);});
}
function codeRun(pseudo=false){
  const text=$('codeSource')?.value||'';if(!text.trim()){alert('Paste code or choose a source-code file first.');return;}
  const detected=detectLanguage(text,$('codeFileName')?.value||'');
  const src=($('codeSourceLanguage')?.value||'auto')==='auto'?detected:$('codeSourceLanguage').value;
  const target=pseudo?'Pseudo Code':($('codeTargetLanguage')?.value||'Pseudo Code');
  code.result=pseudo?pseudoCode(text):translateSyntax(text,src,target);
  $('codeOutput').textContent=code.result;
  $('codeMeta').textContent='Detected/source: '+src+' • Target: '+target+' • Browser heuristic translation';
  $('codeAudit').innerHTML='<div class="viz-rules"><span>✓ Syntax-level conversion attempted</span><span>✓ Program logic preserved where recognizable</span><span>△ Libraries/APIs need review</span><span>△ Not a compiler</span></div>';
  $('codeDownloadBtn').disabled=false;
}
function codeDownload(){if(!code.result)return;const target=($('codeTargetLanguage')?.value||'Pseudo Code');const extn={'Pseudo Code':'txt','Python':'py','JavaScript':'js','TypeScript':'ts','Java':'java','C#':'cs','C++':'cpp','C':'c','Go':'go','Rust':'rs','Kotlin':'kt','Swift':'swift','PHP':'php','Ruby':'rb','Bash':'sh','SQL':'sql'}[target]||'txt';download(new Blob([code.result],{type:'text/plain;charset=utf-8'}),'omni-translated.'+extn);}
function codeReset(){code.file=null;code.result='';$('codeInput').value='';$('codeFileName').value='';$('codeSource').value='';$('codeOutput').textContent='Your translated code or pseudo code will appear here.';$('codeMeta').textContent='No source analyzed yet.';$('codeAudit').innerHTML='';$('codeDownloadBtn').disabled=true;$('codeDrop').style.display='block';}

function init(){
  try{
    biDropBind();codeBind();
    $('vizAnalyzeBtn')?.addEventListener('click',()=>biAnalyze().catch(e=>alert('BI Interchange: '+e.message)));
    $('vizGenerateBtn')?.addEventListener('click',()=>{try{biGenerate();}catch(e){alert('BI Interchange: '+e.message);}});
    $('vizDownloadBtn')?.addEventListener('click',biDownload);
    $('vizResetBtn')?.addEventListener('click',biReset);
    $('codeConvertBtn')?.addEventListener('click',()=>{try{codeRun(false);}catch(e){alert('Code Studio: '+e.message);}});
    $('codePseudoBtn')?.addEventListener('click',()=>{try{codeRun(true);}catch(e){alert('Code Studio: '+e.message);}});
    $('codeDownloadBtn')?.addEventListener('click',codeDownload);
    window.OMNI_CODE_STUDIO={translate:codeRun,pseudoCode,download:codeDownload};
    window.OMNI_BI_INTERCHANGE={analyze:biAnalyze,generate:biGenerate};
  }catch(e){console.error('[OMNI studios init]',e);}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();