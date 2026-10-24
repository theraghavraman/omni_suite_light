/* Redmark Forge — on-demand vendor loader.
 * Every executable CDN and offline asset is integrity-pinned. Hashes come from
 * offline_assets_manifest.json; feature code can use these only via this loader.
 */
(function(){
'use strict';
const LIBS={
  mammoth:{global:'mammoth',local:'vendor/mammoth/mammoth.browser.min.js',cdn:'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js',sha256:'92914a3708cfdf1e62cb553d1856a7fedab21da83d8ee82845de2f897b368cab'},
  docx:{global:'docx',local:'vendor/docx/docx.iife.js',cdn:'https://cdn.jsdelivr.net/npm/docx@9.9.0/dist/index.iife.js',sha256:'14c6e96bdf929d4d895c5efa460409d9a218236d91aab2b6e14faa5a373915cc'},
  pptxgenjs:{global:'PptxGenJS',local:'vendor/pptxgenjs/pptxgen.bundle.js',cdn:'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js',sha256:'4fb9eac5cfefb213e2d8743c2b7151025f31bfb3f834c73c12062916daa0f3f8'},
  exceljs:{global:'ExcelJS',local:'vendor/exceljs/exceljs.min.js',cdn:'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',sha256:'7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9'},
  formulaParser:{global:'FormulaParser',local:'vendor/formula/parser.min.js',cdn:'https://cdn.jsdelivr.net/npm/fast-formula-parser@1.0.19/build/parser.min.js',sha256:'687035c3607cc995c5edc4fbc33075946e0fee6a410812afec564235509b5416'},
  formulajs:{global:'formulajs',local:'vendor/formula/formula.min.js',cdn:'https://cdn.jsdelivr.net/npm/@formulajs/formulajs@4.6.1/lib/browser/formula.min.js',sha256:'580bb2b043dd7b40184e395cd29758faa3ddc90b396cad9f50445d06abf98060'},
  dompurify:{global:'DOMPurify',local:'vendor/dompurify/purify.min.js',cdn:'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js',sha256:'2c90a9b46d6463f26038a29b686e82bc91de01fdac9d5229e7cfe3b360134ea2'},
  mermaid:{global:'mermaid',local:'vendor/mermaid/mermaid.min.js',cdn:'https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js',sha256:'6484afc32872a3aa16cac9a76ba1816a1ed4cc870a6593cc2e17757750f518b2'},
  dagre:{global:'dagre',local:'vendor/dagre/dagre.min.js',cdn:'https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/dist/dagre.min.js',sha256:'2cde82baf0b9232c00aa13932945ff92a17fb08c6885a635592330a4c2c567c5'},
  xlsx:{global:'XLSX',local:'vendor/sheetjs/xlsx.full.min.js',cdn:'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',sha256:'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41'},
  jszip:{global:'JSZip',local:'vendor/jszip/jszip.min.js',cdn:'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',sha256:'acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e'},
  jsqr:{global:'jsQR',local:'vendor/jsqr/jsQR.js',cdn:'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',sha256:'bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859'},
  typescript:{global:'ts',local:'vendor/typescript/typescript.min.js',cdn:'https://cdnjs.cloudflare.com/ajax/libs/typescript/5.9.2/typescript.min.js',sha256:'11748ae7463dddd465341643ba5d09025c4b0769009ddfa84228270b9448bac2'}
};
const SQLJS_BASES=['vendor/sqljs/','https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/'];
const SQLJS_JS_SHA='f1c84000dbc856c9d87f4f3aabc4d3654bd436165db4be3da13751db3a9c20d7';
const SQLJS_WASM_SHA='38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a';
let sqlJsPromise=null,sqlWasmUrl=null;
const pending={};
const toSRI=hex=>'sha256-'+btoa(String.fromCharCode(...hex.match(/../g).map(x=>parseInt(x,16))));
function inject(src,sha256){
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');s.src=src;s.async=true;s.integrity=toSRI(sha256);
    if(/^https:/.test(src))s.crossOrigin='anonymous';
    s.onload=()=>resolve();s.onerror=()=>{s.remove();reject(new Error('Verified library could not be loaded: '+src));};
    document.head.appendChild(s);
  });
}
async function injectGlobal(src,sha256){
  const hadDefine=typeof window.define==='function'&&window.define.amd;
  const saved=hadDefine?window.define:undefined;
  if(hadDefine)window.define=undefined;
  try{await inject(src,sha256);}finally{if(hadDefine)window.define=saved;}
}
async function verifyBytes(url,expected,maxBytes){
  const response=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok)throw new Error('Could not fetch verified asset ('+response.status+').');
  const bytes=await response.arrayBuffer();
  if(!bytes.byteLength||bytes.byteLength>maxBytes)throw new Error('Verified asset size is invalid.');
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==expected)throw new Error('Asset integrity check failed.');
  return bytes;
}
async function sqlJs(){
  if(sqlJsPromise)return sqlJsPromise;
  sqlJsPromise=(async()=>{
    let lastErr=null;
    for(const base of SQLJS_BASES){
      try{
        const wasm=await verifyBytes(base+'sql-wasm.wasm',SQLJS_WASM_SHA,2*1024*1024);
        if(!window.initSqlJs)await injectGlobal(base+'sql-wasm.js',SQLJS_JS_SHA);
        if(!window.initSqlJs)throw new Error('SQLite runtime did not initialize.');
        if(!sqlWasmUrl)sqlWasmUrl=URL.createObjectURL(new Blob([wasm],{type:'application/wasm'}));
        return await window.initSqlJs({locateFile:function(){return sqlWasmUrl;}});
      }catch(e){lastErr=e;try{delete window.initSqlJs;}catch(_){window.initSqlJs=undefined;}}
    }
    throw new Error('Verified sql.js could not be loaded.'+(lastErr?' '+lastErr.message:''));
  })().catch(e=>{sqlJsPromise=null;throw e;});
  return sqlJsPromise;
}
function load(name){
  const lib=LIBS[name];
  if(!lib)return Promise.reject(new Error('Unknown library: '+name));
  if(window[lib.global])return Promise.resolve(window[lib.global]);
  if(pending[name])return pending[name];
  const isFile=location.protocol==='file:';
  pending[name]=(async()=>{
    if(window.OMNI_LIBS){try{const g=await window.OMNI_LIBS.wait(lib.global);if(g)return g;}catch(_){}}
    let lastErr=null;
    for(const src of [lib.local,lib.cdn]){
      try{await injectGlobal(src,lib.sha256);if(window[lib.global])return window[lib.global];}
      catch(e){lastErr=e;try{delete window[lib.global];}catch(_){window[lib.global]=undefined;}}
    }
    delete pending[name];
    throw new Error(lib.global+' failed its pinned integrity check or could not be loaded.'+(isFile?' Run prepare_offline.py for local assets.':'')+(lastErr?' '+lastErr.message:''));
  })();
  return pending[name];
}
function loadAll(names){return Promise.all(names.map(load));}
window.OMNI_VENDOR={load,loadAll,sqlJs,libs:LIBS};
})();
