/* Redmark Forge ETL Studio — Apache Hop local bridge.
 * Apache Hop remains the pipeline designer/runtime; this module connects the UI
 * to a loopback-only Hop Server through the authenticated Omni Local Engine.
 */
(function(){
  'use strict';
  const BASE='http://127.0.0.1:8765';
  const $=id=>document.getElementById(id);
  let token='';
  const state={connected:false,projects:[]};

  function status(message,kind){
    const el=$('etlStatus');
    if(!el)return;
    el.textContent=message;
    el.className='etl-status '+(kind||'info');
  }
  function output(message){
    const el=$('etlOutput');
    if(el)el.textContent=message;
  }
  function credentials(){
    return {
      username:($('etlUsername')?.value||'cluster').trim(),
      password:$('etlPassword')?.value||'cluster'
    };
  }
  async function getToken(){
    if(token)return token;
    if(window.OMNI_TOKEN){token=window.OMNI_TOKEN;return token;}
    const r=await fetch(BASE+'/api/health',{cache:'no-store'});
    if(!r.ok)throw new Error('Omni Local Engine is unavailable (HTTP '+r.status+'). Start it with Omni.command / Omni.bat.');
    const h=await r.json();
    if(!h.token)throw new Error('The Local Engine did not provide an access token. Open Redmark Forge from the current Local Engine build.');
    token=h.token;
    return token;
  }
  async function api(path,method,payload){
    await getToken();
    const options={method:method||'GET',cache:'no-store',headers:{'X-Omni-Token':token}};
    if(payload!==undefined){
      options.headers['Content-Type']='application/json';
      options.body=JSON.stringify(payload);
    }
    const r=await fetch(BASE+path,options);
    let data={};
    try{data=await r.json();}catch(_){data={error:'The Local Engine returned an unreadable response.'};}
    if(!r.ok||data.ok===false)throw new Error(data.error||('Local Engine HTTP '+r.status));
    return data;
  }
  function setConnected(connected){
    state.connected=!!connected;
    const badge=$('etlConnectionBadge');
    if(badge){
      badge.textContent=connected?'HOP SERVER ONLINE':'NOT CONNECTED';
      badge.classList.toggle('online',!!connected);
    }
    const run=$('etlRun');
    if(run)run.disabled=!connected||!$('etlPipeline')?.value;
  }
  function renderProjects(data){
    const select=$('etlPipeline');
    const count=$('etlPipelineCount');
    const folder=$('etlProjectFolder');
    if(folder)folder.textContent=data.folder||'~/OmniETL/projects';
    state.projects=Array.isArray(data.pipelines)?data.pipelines:[];
    if(count)count.textContent=String(state.projects.length);
    if(!select)return;
    const previous=select.value;
    select.replaceChildren();
    if(!state.projects.length){
      const opt=document.createElement('option');
      opt.value='';
      opt.textContent='No .hpl pipelines found';
      select.appendChild(opt);
    }else{
      const placeholder=document.createElement('option');
      placeholder.value='';
      placeholder.textContent='Choose a pipeline…';
      select.appendChild(placeholder);
      state.projects.forEach(p=>{
        const opt=document.createElement('option');
        opt.value=p.path;
        opt.textContent=p.path;
        select.appendChild(opt);
      });
      if(state.projects.some(p=>p.path===previous))select.value=previous;
    }
    const run=$('etlRun');
    if(run)run.disabled=!state.connected||!select.value;
  }
  async function checkConnection(){
    const button=$('etlConnect');
    if(button){button.disabled=true;button.textContent='Checking…';}
    status('Checking Apache Hop on 127.0.0.1:8081…','info');
    try{
      const data=await api('/api/etl/hop/status','POST',credentials());
      if(!data.reachable){
        setConnected(false);
        status(data.error||'Hop Server is not running. Start it locally, then try again.','warning');
        output('Apache Hop is not connected.\n\n1. Install Apache Hop.\n2. Start Hop Server on 127.0.0.1:8081.\n3. Enter the Hop Server username/password and retry.\n\nSetup guide: ETL_STUDIO.md');
        return;
      }
      setConnected(true);
      status('Connected to Apache Hop at '+data.endpoint,'success');
      output('Apache Hop responded successfully.\nHTTP status: '+data.http_status+'\n\nPipeline execution is routed through Omni Local Engine. Use Refresh Pipelines to load .hpl files from your local ETL project folder.');
      await refreshProjects(true);
    }catch(e){
      setConnected(false);
      status(e.message,'error');
      output('Connection check failed.\n\n'+e.message+'\n\nStart the Omni Local Engine and confirm Hop Server is listening on 127.0.0.1:8081.');
    }finally{
      if(button){button.disabled=false;button.textContent='Check Connection';}
    }
  }
  async function refreshProjects(silent){
    const button=$('etlRefresh');
    if(button){button.disabled=true;button.textContent='Refreshing…';}
    try{
      const data=await api('/api/etl/hop/projects','GET');
      renderProjects(data);
      if(!silent)status(state.projects.length+' pipeline'+(state.projects.length===1?'':'s')+' found.','success');
      if(!state.projects.length&&!silent)output('No .hpl pipeline files were found.\n\nSave or copy Apache Hop pipeline files into:\n'+(data.folder||'~/OmniETL/projects')+'\n\nThen select Refresh Pipelines.');
    }catch(e){
      if(!silent)status(e.message,'error');
    }finally{
      if(button){button.disabled=false;button.textContent='Refresh Pipelines';}
    }
  }
  async function runPipeline(){
    const select=$('etlPipeline');
    const path=select?.value||'';
    if(!path){status('Choose a pipeline first.','warning');return;}
    const p=state.projects.find(x=>x.path===path);
    const name=p?.name||path;
    if(!window.confirm('Run Apache Hop pipeline "'+name+'"?\n\nThis can read, transform, and write data using the connections configured in that pipeline.'))return;
    const button=$('etlRun');
    if(button){button.disabled=true;button.textContent='Running…';}
    status('Executing '+name+'…','info');
    output('Starting pipeline: '+path+'\nWaiting for Hop Server response…');
    try{
      const data=await api('/api/etl/hop/run','POST',{...credentials(),path});
      status(data.success?'Pipeline completed.':'Hop Server returned a response.','success');
      output('Pipeline: '+path+'\nResult: '+(data.message||'Execution request completed')+'\nHTTP status: '+data.http_status+'\n\nResponse:\n'+(data.response||'(no response body)'));
    }catch(e){
      status('Pipeline execution failed.','error');
      output('Execution failed for '+path+'\n\n'+e.message+'\n\nCheck Hop Server logs and the pipeline connection settings.');
    }finally{
      if(button){button.textContent='Run Pipeline';button.disabled=!state.connected||!select?.value;}
    }
  }
  function openLocal(url){
    const w=window.open(url,'_blank','noopener,noreferrer');
    if(!w)status('Your browser blocked the new tab. Open '+url+' manually.','warning');
  }
  function wire(){
    const connect=$('etlConnect'),refresh=$('etlRefresh'),run=$('etlRun'),select=$('etlPipeline');
    if(connect&&!connect.dataset.wired){connect.dataset.wired='1';connect.addEventListener('click',checkConnection);}
    if(refresh&&!refresh.dataset.wired){refresh.dataset.wired='1';refresh.addEventListener('click',()=>refreshProjects(false));}
    if(run&&!run.dataset.wired){run.dataset.wired='1';run.addEventListener('click',runPipeline);}
    if(select&&!select.dataset.wired){select.dataset.wired='1';select.addEventListener('change',()=>{if(run)run.disabled=!state.connected||!select.value;});}
    const designer=$('etlOpenDesigner');
    if(designer&&!designer.dataset.wired){designer.dataset.wired='1';designer.addEventListener('click',()=>openLocal('http://127.0.0.1:8080/ui'));}
    const server=$('etlOpenServer');
    if(server&&!server.dataset.wired){server.dataset.wired='1';server.addEventListener('click',()=>openLocal('http://127.0.0.1:8081'));}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
  document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('.nav-btn[data-tab="tabETLStudio"]'))setTimeout(wire,0);});
  window.OMNI_ETL_STUDIO={checkConnection,refreshProjects,runPipeline};
})();