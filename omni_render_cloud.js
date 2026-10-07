/* Omni Suite — Render Cloud Engine bridge
 * Additive only: never replaces browser/local paths. Provides one opt-in cloud button
 * plus a reusable API for studios to hand off heavy jobs to Render.
 */
(function(){
  'use strict';
  const CLOUD=(window.OMNI_CLOUD_ENGINE_URL||'https://omni-cloud-engine.onrender.com').replace(/\/+$/,'');
  const id='omniRenderCloud';
  const css=`
    #${id}Btn{position:fixed;right:18px;bottom:18px;z-index:9998;border:0;border-radius:999px;padding:12px 17px;background:linear-gradient(120deg,#6c5cff,#ff4f9a,#ff8a3d);color:#fff;font-weight:900;box-shadow:0 16px 35px rgba(70,50,160,.32);cursor:pointer}
    #${id}Modal{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(28,27,58,.34);backdrop-filter:blur(8px);padding:18px}
    #${id}Card{width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;border:1px solid rgba(108,92,255,.18);border-radius:24px;padding:22px;box-shadow:0 30px 80px rgba(30,20,90,.28)}
    #${id}Card h2{margin:0 0 6px;color:#1c1b3a}#${id}Card p{color:#69738d;font-size:.82rem;line-height:1.5}
    #${id}Grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}#${id}Grid label{font-size:.72rem;font-weight:800;color:#59637b}
    #${id}Grid input,#${id}Grid select{width:100%;margin-top:5px;padding:10px;border:1px solid #dbe2ef;border-radius:10px}
    #${id}Files{margin-top:12px;padding:14px;border:1px dashed #bfc9dc;border-radius:14px;background:#f8f9ff}
    #${id}Actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}#${id}Actions button{border:0;border-radius:11px;padding:10px 14px;font-weight:800;cursor:pointer}
    #${id}Run{background:#6c5cff;color:#fff}#${id}Close{background:#edf1f7;color:#4b5670}
    #${id}Status{margin-top:12px;padding:10px 12px;border-radius:10px;background:#f1f4f9;color:#647089;font-size:.76rem;white-space:pre-wrap}
    @media(max-width:620px){#${id}Grid{grid-template-columns:1fr}#${id}Btn{right:12px;bottom:12px}}
  `;
  const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
  const modal=document.createElement('div');modal.id=id+'Modal';modal.innerHTML=`
    <div id="${id}Card">
      <h2>☁ Omni Cloud — Render</h2>
      <p>Heavy processing lives in Render. Existing browser and Local Engine buttons are untouched. Upload here when you explicitly want cloud processing.</p>
      <div id="${id}Grid">
        <label>Cloud operation<select id="${id}Op">
          <option value="ffmpeg">Video / FFmpeg</option><option value="image-batch">Batch images</option><option value="pdf-batch">Merge PDF batch</option>
          <option value="ocr">OCR</option><option value="office-convert">Office conversion</option><option value="data-profile">Data profiling</option>
          <option value="data-clean">Data cleaning</option><option value="sql-simulate">Temporary SQL simulation</option><option value="rag-ingest">RAG ingestion</option>
          <option value="vector-search">Vector / semantic index</option><option value="archive">Compression / archive</option><option value="batch-pipeline">Batch pipeline</option>
          <option value="diagnostics">Cloud diagnostics</option><option value="code-format">Code formatting</option><option value="code-clean">Code cleaning</option><option value="metadata">Metadata</option>
        </select></label>
        <label>Output / format<input id="${id}Format" placeholder="e.g. mp4, pdf, docx, webp"></label>
      </div>
      <div id="${id}Files"><input id="${id}Input" type="file" multiple></div>
      <div id="${id}Actions"><button id="${id}Close">Cancel</button><button id="${id}Run">Run on Render</button></div>
      <div id="${id}Status">Ready — nothing is sent until you press Run on Render.</div>
    </div>`;
  document.body.appendChild(modal);
  const btn=document.createElement('button');btn.id=id+'Btn';btn.textContent='☁ Run on Render';btn.title='Send a heavy job to Omni Cloud Engine';document.body.appendChild(btn);
  const op=document.getElementById(id+'Op'),input=document.getElementById(id+'Input'),fmt=document.getElementById(id+'Format'),status=document.getElementById(id+'Status');
  const result=document.getElementById(id+'Result'),resultMeta=document.getElementById(id+'ResultMeta'),downloadBtn=document.getElementById(id+'Download'),previewBtn=document.getElementById(id+'Preview');
  let lastBlob=null,lastName='omni-render-output',lastUrl=null;
  function clearResult(){result.style.display='none';lastBlob=null;lastName='omni-render-output';if(lastUrl){URL.revokeObjectURL(lastUrl);lastUrl=null}}
  function showResult(blob,name){lastBlob=blob;lastName=name||'omni-render-output';if(lastUrl)URL.revokeObjectURL(lastUrl);lastUrl=URL.createObjectURL(blob);resultMeta.textContent=lastName+' · '+Math.max(1,Math.round(blob.size/1024))+' KB';result.style.display='block'}
  downloadBtn.onclick=()=>{if(lastBlob)downloadBlob(lastBlob,lastName)};
  previewBtn.onclick=()=>{if(lastUrl)window.open(lastUrl,'_blank','noopener')};
  function open(){modal.style.display='flex';clearResult();status.textContent='Ready — nothing is sent until you press Run on Render.'} function close(){modal.style.display='none'}
  btn.onclick=open;document.getElementById(id+'Close').onclick=close;modal.addEventListener('click',e=>{if(e.target===modal)close()});
  function downloadBlob(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name||'omni-render-output';a.click();setTimeout(()=>URL.revokeObjectURL(u),60000)}
  async function run(files,operation,options){
    files=Array.from(files||[]); if(!files.length) throw new Error('Select at least one file.');
    status.textContent='Connecting to Render…';
    const fd=new FormData();fd.append('operation',operation||op.value);fd.append('options',JSON.stringify(options||{}));files.forEach(f=>fd.append('files',f,f.name));
    const r=await fetch(CLOUD+'/api/process',{method:'POST',body:fd});const ct=r.headers.get('content-type')||'';
    if(!r.ok){let e={};try{e=await r.json()}catch(_){}throw new Error(e.error||('Render HTTP '+r.status))}
    const blob=await r.blob();const name=r.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1]||'omni-render-output';showResult(blob,name);
    return {blob,name};
  }
  window.OmniRenderCloud={url:CLOUD,run};
  document.getElementById(id+'Run').onclick=async()=>{
    try{
      const options={format:fmt.value.trim()||undefined};
      clearResult();status.textContent='Uploading to Render…';
      await run(input.files,op.value,options);
      status.textContent='✓ Render completed the cloud job. Your output is ready below.';
    }catch(e){result.style.display='none';status.textContent='✕ Render job failed: '+e.message}
  };
})();
