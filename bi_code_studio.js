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
  const sources=[],aggregate={fields:[],measures:[],dimensions:[],filters:[],visuals:[]},notes=[];
  for(const file of bi.files){
    const e=ext(file.name),text=await biReadFile(file);
    sources.push({name:file.name,format:e||'unknown',bytes:file.size});
    if(e==='pbix'){notes.push(file.name+': PBIX is proprietary binary; browser analysis is limited. Use PBIP/PBIR/TMDL for portable semantics.');continue;}
    let m;
    if(['json','pbip','pbir'].includes(e)){try{m=extractJsonModel(JSON.parse(text));}catch{m=extractXmlNames(text);}}
    else m=extractXmlNames(text);
    for(const k of ['fields','measures','dimensions','filters','visuals'])aggregate[k].push(...(m[k]||[]));
  }
  for(const k of Object.keys(aggregate))aggregate[k]=[...new Set(aggregate[k])].slice(0,500);
  bi.model={schema:'OMNI-VIZ/1.0',generatedAt:new Date().toISOString(),sources,semantic:aggregate,notes};
  $('vizOutput').textContent=JSON.stringify(bi.model,null,2);
  const stats={fields:aggregate.fields.length,measures:aggregate.measures.length,dimensions:aggregate.dimensions.length,filters:aggregate.filters.length,visuals:aggregate.visuals.length,notes:notes.length};
  $('vizAuditGrid').innerHTML=Object.entries(stats).map(([k,v])=>'<div class="viz-audit-stat"><b>'+v+'</b><span>'+k+'</span></div>').join('');
  $('vizDownloadBtn').disabled=false;
}
function biSql(){
  const m=bi.model?.semantic;if(!m)throw new Error('Analyze the BI definition first.');
  const table=($('vizExcelTable')?.value||'Data').replace(/[^A-Za-z0-9_$]/g,'_');
  const fields=[...new Set([...(m.dimensions||[]),...(m.measures||[]),...(m.fields||[])])].slice(0,80);
  const select=fields.length?fields.map(x=>'  "'+String(x).replace(/"/g,'""')+'"').join(',\n'):'  *';
  return 'SELECT\n'+select+'\nFROM "'+table+'";\n\n-- OMNI-VIZ semantic reconstruction\n-- Dialect: '+($('vizSqlDialect')?.value||'ANSI SQL');
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
function pseudoCode(text){
  const lines=text.split(/\r?\n/),out=['BEGIN PROGRAM'];
  let indent=0;
  const emit=s=>out.push('  '.repeat(Math.max(0,indent))+s);
  for(const raw of lines){
    const l=raw.trim(); if(!l)continue;
    if(/^\}|^\]|^end\b/i.test(l)){indent=Math.max(0,indent-1);continue;}
    if(/^\/\/|^#|^\/\*/.test(l)){emit('COMMENT: '+l.replace(/^\/\/|^#|^\/\*/,'').trim());continue;}
    let m;
    if((m=l.match(/^if\s*\((.*?)\)\s*\{?$|^if\s+(.+?)\s*:?$/i))){emit('IF '+(m[1]||m[2])+' THEN');indent++;continue;}
    if((m=l.match(/^else\s*if\s*\((.*?)\)\s*\{?$|^elif\s+(.+?)\s*:?$/i))){indent=Math.max(0,indent-1);emit('ELSE IF '+(m[1]||m[2])+' THEN');indent++;continue;}
    if(/^else\b/i.test(l)){indent=Math.max(0,indent-1);emit('ELSE');indent++;continue;}
    if((m=l.match(/(?:for\s*\((?:[^;]+;)?([^;]+);|for\s+(\w+)\s+in\s+)(.+?)(?:\)|:)?$/i))){emit('FOR EACH '+(m[2]||m[1]||'item')+' IN '+(m[3]||'collection'));indent++;continue;}
    if(/^while\s*\((.*?)\)|^while\s+(.+?):/i.test(l)){m=l.match(/^while\s*\((.*?)\)|^while\s+(.+?):/i);emit('WHILE '+(m[1]||m[2])+' DO');indent++;continue;}
    if((m=l.match(/(?:System\.out\.println|console\.log|print)\s*\((.*)\)/i))){emit('OUTPUT '+m[1]);continue;}
    if((m=l.match(/(?:return)\s+(.+?);?$/i))){emit('RETURN '+m[1]);continue;}
    if((m=l.match(/(?:int|float|double|string|String|let|const|var|auto)\s+(\w+)\s*=\s*(.+?);?$/i))){emit('SET '+m[1]+' = '+m[2]);continue;}
    if(/^class\s+(\w+)/i.test(l)){emit('DEFINE CLASS '+l.match(/^class\s+(\w+)/i)[1]);indent++;continue;}
    if(/^(public|private|protected)?\s*(static\s+)?[\w<>\[\]]+\s+\w+\s*\(/.test(l)||/^def\s+\w+\s*\(/.test(l)||/^function\s+\w+/.test(l)){emit('DEFINE PROCEDURE: '+l.replace(/[{}]/g,''));continue;}
    emit('EXECUTE: '+l.replace(/[{}]/g,'').trim());
  }
  while(indent-->0)out.push('  '.repeat(indent)+'END BLOCK');
  out.push('END PROGRAM');return out.join('\n');
}
function translateSyntax(text,src,target){
  if(target==='Pseudo Code')return pseudoCode(text);
  if(src===target||target==='Auto')return text;
  let s=text;
  if(target==='Python'){
    s=s.replace(/\bSystem\.out\.println\((.*?)\);/g,'print($1)').replace(/\bconsole\.log\((.*?)\);?/g,'print($1)');
    s=s.replace(/\b(boolean|bool)\b/g,'bool').replace(/\b(int|Integer|long|float|double)\b/g,'int');
    s=s.replace(/\bpublic\s+static\s+void\s+main\s*\([^)]*\)\s*\{/,'def main():');
    s=s.replace(/\belse\s+if\s*\((.*?)\)\s*\{/g,'elif $1:').replace(/\bif\s*\((.*?)\)\s*\{/g,'if $1:').replace(/\belse\s*\{/g,'else:');
    s=s.replace(/\bfor\s*\(\s*(?:int|let|var)\s+(\w+)\s*=\s*0;\s*\1\s*<\s*(\w+)\s*;\s*\1\+\+\s*\)\s*\{/g,'for $1 in range($2):');
    s=s.replace(/;\s*$/gm,'').replace(/[{}]/g,'');
  }else if(target==='JavaScript'||target==='TypeScript'){
    s=s.replace(/\bSystem\.out\.println\((.*?)\);/g,'console.log($1);').replace(/\bprint\((.*?)\)/g,'console.log($1);');
    s=s.replace(/\bpublic\s+static\s+void\s+main\s*\([^)]*\)\s*\{/,'function main(){');
    s=s.replace(/\bdef\s+(\w+)\s*\((.*?)\)\s*:/g,'function $1($2){');
    s=s.replace(/\bif\s+(.+?):/g,'if ($1) {').replace(/\belif\s+(.+?):/g,'else if ($1) {').replace(/\belse:/g,'else {');
    s=s.replace(/\b(\w+)\s*:\s*([^\n]+)/g,'$1 = $2;');
  }else if(target==='Java'){
    s=s.replace(/\bprint\((.*?)\)/g,'System.out.println($1);').replace(/\bconsole\.log\((.*?)\);?/g,'System.out.println($1);');
    s=s.replace(/\bdef\s+(\w+)\s*\((.*?)\)\s*:/g,'public static void $1($2) {');
    s=s.replace(/\bif\s+(.+?):/g,'if ($1) {').replace(/\belif\s+(.+?):/g,'else if ($1) {').replace(/\belse:/g,'else {');
  }else if(target==='C#'){
    s=s.replace(/\bprint\((.*?)\)/g,'Console.WriteLine($1);').replace(/\bconsole\.log\((.*?)\);?/g,'Console.WriteLine($1);');
  }else if(target==='C++'||target==='C'){
    s=s.replace(/\bprint\((.*?)\)/g,'std::cout << $1 << std::endl;').replace(/\bconsole\.log\((.*?)\);?/g,'std::cout << $1 << std::endl;');
  }else if(target==='SQL'){
    s=s.replace(/\bif\s*\((.*?)\)\s*\{[\s\S]*?\}/g,'-- IF $1').replace(/console\.log\((.*?)\);?/g,'-- OUTPUT $1');
  }
  return '// OMNI browser heuristic translation: '+src+' → '+target+'\n// Review framework/API semantics before production use.\n'+s;
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