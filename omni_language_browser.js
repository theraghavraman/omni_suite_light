/* Omni Language Engine — Browser Mini Model
 * Browser-only translation adapter.
 * Isolated from Omni Assistant and Private RAG.
 *
 * First target: Hindi <-> English using quantized Marian/Opus-MT ONNX
 * models through Transformers.js. The model runs in the browser and is
 * cached by the browser after the first download.
 */
(() => {
  'use strict';

  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm';
  const MODELS = Object.freeze({
    'hi-en': 'Xenova/opus-mt-hi-en',
    'en-hi': 'Xenova/opus-mt-en-hi'
  });

  let libraryPromise = null;
  const pipelines = new Map();
  const loading = new Map();

  function key(source, target) {
    return String(source || '').trim().toLowerCase() + '-' + String(target || '').trim().toLowerCase();
  }

  async function loadLibrary() {
    if (!libraryPromise) {
      libraryPromise = import(TRANSFORMERS_URL).then(mod => {
        const env = mod.env;
        env.allowRemoteModels = true;
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        env.useWasmCache = true;
        env.cacheKey = 'omni-language-engine-v1';
        return mod;
      });
    }
    return libraryPromise;
  }

  async function getPipeline(source, target) {
    const k = key(source, target);
    if (!MODELS[k]) {
      throw new Error('Browser Mini Model currently supports Hindi ↔ English only. Use Local Engine for other language pairs.');
    }
    if (pipelines.has(k)) return pipelines.get(k);
    if (loading.has(k)) return loading.get(k);

    const promise = loadLibrary().then(({pipeline}) => {
      return pipeline('translation', MODELS[k], {dtype:'q4'});
    }).then(pipe => {
      pipelines.set(k, pipe);
      loading.delete(k);
      return pipe;
    }).catch(err => {
      loading.delete(k);
      throw err;
    });

    loading.set(k, promise);
    return promise;
  }

  const adapter = {
    capabilities: Object.keys(MODELS),
    async translate(text, source, target) {
      const k = key(source, target);
      const pipe = await getPipeline(source, target);
      const result = await pipe(String(text || ''), {max_new_tokens:256, num_beams:2});
      const first = Array.isArray(result) ? result[0] : result;
      return {
        text: first?.translation_text || first?.text || '',
        model: MODELS[k],
        provider: 'browser-mini-model',
        local_in_browser: true
      };
    },
    async status() {
      return {
        mode:'browser',
        model_stack:'Marian/Opus-MT ONNX via Transformers.js',
        supported_pairs:Object.keys(MODELS),
        loaded_pairs:Array.from(pipelines.keys()),
        cache:'browser-cache',
        network_translation_api:false
      };
    }
  };

  if (window.OmniLanguageEngine) window.OmniLanguageEngine.setBrowserAdapter(adapter);
  else window.OMNI_LANGUAGE_BROWSER_ADAPTER = adapter;
})();