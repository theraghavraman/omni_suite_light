(() => {
  'use strict';
  function $(id){return document.getElementById(id);}
  function setStatus(id,text){const el=$(id);if(el)el.textContent=text;}
  async function refresh(){
    if(!window.OmniLanguageEngine){setStatus('languageEngineStatus','Language Engine runtime is not loaded.');return;}
    try{
      const s=await window.OmniLanguageEngine.status();
      const caps=s.local?.capabilities||{};
      setStatus('languageEngineStatus',[
        'Engine: '+s.engine+' '+s.version,
        'Isolation: Assistant '+(s.isolated_from_assistant?'OFF':'UNKNOWN')+' • RAG '+(s.isolated_from_rag?'OFF':'UNKNOWN'),
        'Local Engine: '+(s.local?'detected':'not running'),
        'Translation models: '+(caps.translation?.join(', ')||'not installed'),
        'Transliteration model: '+(caps.transliteration?.join(', ')||'not installed'),
        'Browser adapter: '+(s.browser_adapter?'available':'not configured'),
        'Network translation fallback: disabled'
      ].join('\n'));
    }catch(e){setStatus('languageEngineStatus','Status error: '+(e.message||e));}
  }
  async function translate(){
    const input=$('languageInputText')?.value?.trim();
    if(!input){setStatus('languageTranslateStatus','Enter text first.');return;}
    const btn=$('languageTranslateBtn');btn.disabled=true;
    $('languageTranslateOutput').style.display='none';
    setStatus('languageTranslateStatus','Running the isolated translation model locally…');
    try{
      const r=await window.OmniLanguageEngine.translate(input,$('languageSource').value,$('languageTarget').value,{max_new_tokens:512});
      $('languageTranslateOutput').value=r.text||'';
      $('languageTranslateOutput').style.display='block';
      setStatus('languageTranslateStatus',(r.model||'Language Engine')+' • '+(r.provider||'local')+' • isolated from Assistant/RAG');
    }catch(e){setStatus('languageTranslateStatus','Translation unavailable: '+(e.message||e));}
    finally{btn.disabled=false;}
  }
  async function transliterate(){
    const input=$('languageInputText')?.value?.trim();
    if(!input){setStatus('languageTranslitStatus','Enter text first.');return;}
    const btn=$('languageTranslitBtn');btn.disabled=true;
    $('languageTranslitOutput').style.display='none';
    setStatus('languageTranslitStatus','Running the isolated transliteration model locally…');
    try{
      const r=await window.OmniLanguageEngine.transliterate(input,$('languageSource').value,$('languageTranslitTarget').value,{topk:4});
      $('languageTranslitOutput').value=r.text||'';
      $('languageTranslitOutput').style.display='block';
      setStatus('languageTranslitStatus',(r.model||'Language Engine')+' • '+(r.provider||'local')+' • isolated from Assistant/RAG');
    }catch(e){setStatus('languageTranslitStatus','Transliteration unavailable: '+(e.message||e));}
    finally{btn.disabled=false;}
  }
  function init(){
    $('languageRefreshStatus')?.addEventListener('click',refresh);
    $('languageTranslateBtn')?.addEventListener('click',translate);
    $('languageTranslitBtn')?.addEventListener('click',transliterate);
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();