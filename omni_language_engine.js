/* Omni Language Engine (OLE)
 * Isolated multilingual translation + transliteration runtime.
 * This module is independent from omni_assistant.js, rag_studio.js and the
 * assistant/RAG model stack. No third-party web translation fallback is used.
 */
(() => {
  'use strict';
  const VERSION = '1.0.0';
  const API_VERSION = 1;
  const state = { lastProvider:null, localHealth:null, localBase:null, localToken:null, browserAdapter:null };

  async function localHealth() {
    try {
      const base = String(window.OMNI_LANGUAGE_LOCAL_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
      const response = await fetch(base + '/api/health', {cache:'no-store'});
      if (!response.ok) return null;
      const health = await response.json();
      if (!health?.token || Number(health.engine_api_version || 0) < 4) return null;
      state.localHealth = health;
      state.localBase = base;
      state.localToken = health.token;
      return health;
    } catch (_) { return null; }
  }

  async function localProcess(payload) {
    const base = state.localBase || String(window.OMNI_LANGUAGE_LOCAL_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
    if (!state.localToken) await localHealth();
    if (!state.localToken) throw new Error('Omni Language Local Engine is not running or is not authorized.');
    const response = await fetch(base + '/api/process', {
      method:'POST',
      headers:{Origin:location.origin,'X-Omni-Token':state.localToken,'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok === false) throw new Error(result?.error || 'Local language engine failed.');
    return result;
  }

  function adapter() { return state.browserAdapter || window.OMNI_LANGUAGE_BROWSER_ADAPTER || null; }
  function textOf(value) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error('No text was supplied to the language engine.');
    return text;
  }
  function code(value) { return String(value || '').trim().replace('-', '_'); }

  async function translate(text, source, target, options = {}) {
    const value = textOf(text), src = code(source), tgt = code(target);
    if (!src || !tgt) throw new Error('Source and target languages are required.');
    if (src === tgt) return {text:value, provider:'identity', model:null};

    const local = await localHealth();
    if (local?.capabilities?.language_translation?.length) {
      const result = await localProcess({
        op:'language_translate', text:value, source:src, target:tgt,
        max_new_tokens:Number(options.max_new_tokens || 512)
      });
      state.lastProvider = 'local';
      return Object.assign({provider:'local', model:result.model || 'IndicTrans2'}, result);
    }

    const a = adapter();
    if (a && typeof a.translate === 'function') {
      const result = await a.translate(value, src, tgt, options);
      state.lastProvider = 'browser';
      return Object.assign({provider:'browser'}, result || {});
    }
    throw new Error('Omni Language Engine is not installed for this language pair. No text was sent to a web translation service.');
  }

  async function transliterate(text, source, targetScript, options = {}) {
    const value = textOf(text), src = code(source), target = code(targetScript || 'Latn');
    const local = await localHealth();
    if (local?.capabilities?.language_transliteration?.length) {
      const result = await localProcess({
        op:'language_transliterate', text:value, source:src, target,
        topk:Number(options.topk || 4)
      });
      state.lastProvider = 'local';
      return Object.assign({provider:'local', model:result.model || 'IndicXlit'}, result);
    }
    const a = adapter();
    if (a && typeof a.transliterate === 'function') {
      const result = await a.transliterate(value, src, target, options);
      state.lastProvider = 'browser';
      return Object.assign({provider:'browser'}, result || {});
    }
    throw new Error('Omni Language Engine transliteration model is not installed. No text was sent to a web service.');
  }

  async function status() {
    const local = await localHealth();
    return {
      engine:'Omni Language Engine', version:VERSION, api_version:API_VERSION,
      isolated_from_assistant:true, isolated_from_rag:true,
      local, browser_adapter:Boolean(adapter()), last_provider:state.lastProvider
    };
  }

  window.OmniLanguageEngine = Object.freeze({
    version:VERSION, translate, transliterate, status,
    setBrowserAdapter(a) {
      if (a !== null && typeof a !== 'object') throw new TypeError('Browser language adapter must be an object or null.');
      state.browserAdapter = a;
    }
  });
})();