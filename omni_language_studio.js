(() => {
  'use strict';
  function $(id){return document.getElementById(id);}
  function setStatus(id,text){const el=$(id);if(el)el.textContent=text;}

  const state={localRoutes:new Set(),browserPairs:new Set(),localDetected:false};
  const ROUTE_LABELS={
    en_indic:'English → Indic',
    indic_en:'Indic → English',
    indic_indic:'Indic → Indic'
  };

  function pairSupported(source,target){
    const src=String(source||'').trim().toLowerCase().replace('-','_');
    const tgt=String(target||'').trim().toLowerCase().replace('-','_');
    if(!src||!tgt||src===tgt)return true;
    if(state.browserPairs.has(src.replace('_','-')+'-'+tgt.replace('_','-')))return true;
    if(src==='en')return state.localRoutes.has('en_indic');
    if(tgt==='en')return state.localRoutes.has('indic_en');
    return state.localRoutes.has('indic_indic');
  }

  function updateLanguageChoices(){
    const source=$('languageSource'),target=$('languageTarget');
    if(!source||!target)return;
    [...source.options].forEach(option=>{
      const available=pairSupported(option.value,target.value);
      option.disabled=!available&&option.value!==source.value;
      option.title=available?'Available with the currently detected translation engines':'Not available for the selected target with the currently detected models';
    });
    [...target.options].forEach(option=>{
      const available=pairSupported(source.value,option.value);
      option.disabled=!available&&option.value!==target.value;
      option.title=available?'Available with the currently detected translation engines':'Not available for the selected source with the currently detected models';
    });
    const hint=$('languageTranslateStatus');
    if(hint&&!hint.dataset.running){
      if(pairSupported(source.value,target.value)){
        hint.textContent=state.localDetected
          ?'Runs in the browser when supported, otherwise on the Local Engine.'
          :'Hindi ↔ English runs in the browser. Start the Local Engine for more language pairs.';
      }else{
        hint.textContent='This language pair is not available in the detected models. Check Local Engine status or choose another pair.';
      }
    }
  }

  async function refresh(){
    if(!window.OmniLanguageEngine){setStatus('languageEngineStatus','Language Engine runtime is not loaded.');return;}
    setStatus('languageEngineStatus','Checking local model capabilities…');
    try{
      const s=await window.OmniLanguageEngine.status();
      const caps=s.local?.capabilities||{};
      // /api/health publishes these exact capability keys. The older UI looked
      // for caps.translation/caps.transliteration, so it always said "not installed".
      const translationRoutes=Array.isArray(caps.language_translation)
        ?caps.language_translation
        :(Array.isArray(caps.translation)?caps.translation:[]);
      const transliterationModels=Array.isArray(caps.language_transliteration)
        ?caps.language_transliteration
        :(Array.isArray(caps.transliteration)?caps.transliteration:[]);
      state.localRoutes=new Set(translationRoutes.map(x=>String(x).toLowerCase()));
      state.browserPairs=new Set((s.browser?.supported_pairs||[]).map(x=>String(x).toLowerCase()));
      state.localDetected=Boolean(s.local);
      const routeSummary=translationRoutes.length
        ?translationRoutes.map(x=>ROUTE_LABELS[x]||x).join(', ')
        :'not installed';
      const transliterationSummary=transliterationModels.length
        ?transliterationModels.join(', ')
        :'not installed';
      setStatus('languageEngineStatus',[
        'Engine: '+s.engine+' '+s.version,
        'Isolation: Assistant '+(s.isolated_from_assistant?'OFF':'UNKNOWN')+' • RAG '+(s.isolated_from_rag?'OFF':'UNKNOWN'),
        'Local Engine: '+(s.local?'detected':'not running'),
        'Translation models: '+routeSummary,
        'Transliteration model: '+transliterationSummary,
        'Browser mini model: '+(s.browser?.supported_pairs?.join(', ')||'not configured'),
        'Browser models loaded: '+(s.browser?.loaded_pairs?.join(', ')||'none yet'),
        'Browser cache: '+(s.browser?.cache||'not configured'),
        'Network translation API: disabled'
      ].join('\n'));
      updateLanguageChoices();
    }catch(e){
      state.localRoutes.clear();
      state.localDetected=false;
      updateLanguageChoices();
      setStatus('languageEngineStatus','Status error: '+(e.message||e));
    }
  }

  async function translate(){
    const input=$('languageInputText')?.value?.trim();
    if(!input){setStatus('languageTranslateStatus','Enter text first.');return;}
    const source=$('languageSource'),target=$('languageTarget');
    if(!pairSupported(source.value,target.value)){
      setStatus('languageTranslateStatus','This language pair is not available in the detected models. Refresh Local Engine status or choose another pair.');
      return;
    }
    const btn=$('languageTranslateBtn');btn.disabled=true;
    $('languageTranslateOutput').style.display='none';
    const hint=$('languageTranslateStatus');
    if(hint)hint.dataset.running='1';
    setStatus('languageTranslateStatus','Translating… the first run downloads the model.');
    try{
      const r=await window.OmniLanguageEngine.translate(input,source.value,target.value,{max_new_tokens:512});
      $('languageTranslateOutput').value=r.text||'';
      $('languageTranslateOutput').style.display='block';
      setStatus('languageTranslateStatus',(r.model||'Language Engine')+' • '+(r.provider||'local')+' • isolated from Assistant/RAG');
    }catch(e){setStatus('languageTranslateStatus','Translation unavailable: '+(e.message||e));}
    finally{btn.disabled=false;if(hint)delete hint.dataset.running;updateLanguageChoices();}
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
    $('languageSource')?.addEventListener('change',updateLanguageChoices);
    $('languageTarget')?.addEventListener('change',updateLanguageChoices);
    updateLanguageChoices();
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();