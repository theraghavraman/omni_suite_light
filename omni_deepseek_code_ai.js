/* Omni Suite — browser-only DeepSeek Coder helper
 * Model: onnx-community/deepseek-coder-1.3b-instruct-ONNX
 * Runtime: Transformers.js + WebGPU. No Local Engine/API fallback.
 */
(function(){
  'use strict';
  const MODEL='onnx-community/deepseek-coder-1.3b-instruct-ONNX';
  const CDN='https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
  let generator=null, loading=null;

  function webgpuAvailable(){
    return !!(navigator.gpu);
  }
  function setStatus(el,msg,kind){
    if(!el)return;
    el.textContent=msg;
    el.dataset.state=kind||'info';
  }
  async function load(){
    if(generator)return generator;
    if(loading)return loading;
    if(!webgpuAvailable()) throw new Error('WebGPU is not available in this browser. DeepSeek AI stays browser-only and does not fall back to Local Engine.');
    loading=(async()=>{
      const mod=await import(CDN);
      const {pipeline,env}=mod;
      env.allowLocalModels=false;
      env.useBrowserCache=true;
      generator=await pipeline('text-generation',MODEL,{
        device:'webgpu',
        dtype:'q4f16'
      });
      return generator;
    })();
    try{return await loading;}finally{loading=null;}
  }

  function promptFor(kind,text){
    const limit=text.length>14000?text.slice(0,14000)+'\n[Input truncated for browser model]':text;
    if(kind==='sql'){
      return [
        'You are Omni Suite SQL Assistant.',
        'Explain the SQL clearly for a data engineer.',
        'Cover: purpose, tables, joins, filters, aggregations, window/CTE logic, likely risks, and performance considerations.',
        'Do not claim the query was executed. Do not invent schema details.',
        'Keep the answer concise and structured.',
        '',
        'SQL:',
        limit
      ].join('\n');
    }
    return [
      'You are Omni Suite Code Assistant.',
      'Explain the supplied code to a developer.',
      'Cover: purpose, execution flow, important functions, inputs/outputs, dependencies, obvious bugs or risks, and practical improvements.',
      'Do not claim you executed the code. Do not invent runtime results.',
      'Keep the answer concise and structured.',
      '',
      'CODE:',
      limit
    ].join('\n');
  }

  async function explain(kind,text,out,status){
    if(!text.trim()){setStatus(status,'Add SQL/code first.','error');return;}
    setStatus(status,'Loading DeepSeek Coder in your browser… first run is large; later runs use browser cache.','loading');
    try{
      const pipe=await load();
      setStatus(status,'DeepSeek Coder is analyzing locally in this browser…','loading');
      const result=await pipe(promptFor(kind,text),{
        max_new_tokens:420,
        do_sample:false,
        temperature:0.15,
        return_full_text:false
      });
      const generated=result?.[0]?.generated_text;
      out.textContent=typeof generated==='string'?generated:'No explanation was returned.';
      setStatus(status,'✓ Browser AI complete · no Local Engine used','ok');
    }catch(err){
      console.error('Omni DeepSeek browser AI:',err);
      setStatus(status,'AI unavailable: '+(err?.message||String(err)),'error');
    }
  }

  function makePanel(kind){
    const wrap=document.createElement('div');
    wrap.className='card omni-deepseek-card';
    wrap.innerHTML='<div class="code-kicker">DEEPSEEK CODER • BROWSER AI</div>'+
      '<h3 style="margin:4px 0 6px">🤖 Explain with DeepSeek Coder 1.3B</h3>'+
      '<div class="sub">Optional browser-only AI. The model runs with WebGPU; your SQL/code is sent to the model runtime in this page, not to Omni Local Engine.</div>'+
      '<div class="actions-bar" style="margin-top:12px"><button type="button" class="btn btn-primary omni-deepseek-run" data-omni-test="deepseek-explain">✨ Explain in Browser</button><button type="button" class="btn btn-secondary omni-deepseek-clear" data-omni-test="deepseek-clear">Clear</button></div>'+
      '<div class="omni-deepseek-status" aria-live="polite">Ready · model loads only when you click Explain</div>'+
      '<pre class="code-output omni-deepseek-output" style="white-space:pre-wrap;min-height:120px">AI explanation will appear here.</pre>';
    wrap.querySelector('.omni-deepseek-run').addEventListener('click',()=>{
      const source=kind==='sql'?document.getElementById('dbSandboxSql')?.value||'':document.getElementById('codeSource')?.value||'';
      explain(kind,source,wrap.querySelector('.omni-deepseek-output'),wrap.querySelector('.omni-deepseek-status'));
    });
    wrap.querySelector('.omni-deepseek-clear').addEventListener('click',()=>{
      wrap.querySelector('.omni-deepseek-output').textContent='AI explanation will appear here.';
      setStatus(wrap.querySelector('.omni-deepseek-status'),'Ready · model loads only when you click Explain','info');
    });
    return wrap;
  }

  function mount(){
    if(document.getElementById('tabCodeStudio')&&!document.querySelector('[data-deepseek-kind="code"]')){
      const p=makePanel('code');p.dataset.deepseekKind='code';
      document.getElementById('tabCodeStudio').appendChild(p);
    }
    if(document.getElementById('tabDatabaseStudio')&&!document.querySelector('[data-deepseek-kind="sql"]')){
      const p=makePanel('sql');p.dataset.deepseekKind='sql';
      document.getElementById('tabDatabaseStudio').appendChild(p);
    }
  }

  window.OMNI_DEEPSEEK={
    model:MODEL,
    browserOnly:true,
    webgpuAvailable,
    load,
    explain
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();