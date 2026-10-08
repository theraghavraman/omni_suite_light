/* Redmark Forge — on-demand vendor loader
 * Loads pinned, permissively licensed browser libraries only when a studio needs them.
 * Each library is tried from ./vendor/ first (offline installs created by prepare_offline.py)
 * and falls back to a pinned CDN URL. Every library listed here is MIT, BSD-2-Clause or
 * Apache-2.0 / MPL-2.0 (DOMPurify) licensed — see THIRD_PARTY_NOTICES.md.
 */
(function(){
'use strict';
const LIBS={
  mammoth:{global:'mammoth',local:'vendor/mammoth/mammoth.browser.min.js',cdn:'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js'},
  docx:{global:'docx',local:'vendor/docx/docx.iife.js',cdn:'https://cdn.jsdelivr.net/npm/docx@9.9.0/dist/index.iife.js'},
  pptxgenjs:{global:'PptxGenJS',local:'vendor/pptxgenjs/pptxgen.bundle.js',cdn:'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js'},
  exceljs:{global:'ExcelJS',local:'vendor/exceljs/exceljs.min.js',cdn:'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'},
  formulaParser:{global:'FormulaParser',local:'vendor/formula/parser.min.js',cdn:'https://cdn.jsdelivr.net/npm/fast-formula-parser@1.0.19/build/parser.min.js'},
  formulajs:{global:'formulajs',local:'vendor/formula/formula.min.js',cdn:'https://cdn.jsdelivr.net/npm/@formulajs/formulajs@4.6.1/lib/browser/formula.min.js'},
  dompurify:{global:'DOMPurify',local:'vendor/dompurify/purify.min.js',cdn:'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js'},
  mermaid:{global:'mermaid',local:'vendor/mermaid/mermaid.min.js',cdn:'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js'},
  dagre:{global:'dagre',local:'vendor/dagre/dagre.min.js',cdn:'https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/dist/dagre.min.js'},
  xlsx:{global:'XLSX',local:'vendor/sheetjs/xlsx.full.min.js',cdn:'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'},
  jszip:{global:'JSZip',local:'vendor/jszip/jszip.min.js',cdn:'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'}
};
const pending={};
function inject(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;s.async=true;
    s.onload=()=>resolve();
    s.onerror=()=>{s.remove();reject(new Error('Could not load '+src));};
    document.head.appendChild(s);
  });
}
/* Some UMD bundles detect an AMD loader and register themselves with it instead of
 * window. Temporarily hide `define` while one of our scripts executes. */
async function injectGlobal(src){
  const hadDefine=typeof window.define==='function'&&window.define.amd;
  const saved=hadDefine?window.define:undefined;
  if(hadDefine)window.define=undefined;
  try{await inject(src);}finally{if(hadDefine)window.define=saved;}
}
function load(name){
  const lib=LIBS[name];
  if(!lib)return Promise.reject(new Error('Unknown library: '+name));
  if(window[lib.global])return Promise.resolve(window[lib.global]);
  if(pending[name])return pending[name];
  const isFile=location.protocol==='file:';
  pending[name]=(async()=>{
    const order=[lib.local,lib.cdn];
    let lastErr=null;
    for(const src of order){
      try{await injectGlobal(src);if(window[lib.global])return window[lib.global];}
      catch(e){lastErr=e;}
    }
    delete pending[name];
    throw new Error((name==='mermaid'?'Mermaid':name)+' could not be loaded. '+(isFile?'Run prepare_offline.py once (or start the Local Engine) for offline use, or ':'')+'check your internet connection.'+(lastErr?' ('+lastErr.message+')':''));
  })();
  return pending[name];
}
function loadAll(names){return Promise.all(names.map(load));}
window.OMNI_VENDOR={load,loadAll,libs:LIBS};
})();
