/* Omni Suite — Independent Local AI Runtime
 * Deliberately isolated from Local Engine. No shared state, APIs, workers, or DOM dependencies.
 * Runs Transformers.js directly in the browser and exposes window.OmniLocalAI.
 */
(()=>{"use strict";
const CDN="https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const EMBED_MODEL="Xenova/all-MiniLM-L6-v2";
const CHAT_MODEL="onnx-community/gemma-3-270m-it-ONNX";
let libPromise=null,embedder=null,chat=null,state="idle";
const listeners=new Set();
function emit(next,detail=""){state=next;listeners.forEach(fn=>{try{fn({state,detail})}catch(e){}})}
async function lib(){if(!libPromise)libPromise=import(CDN);return libPromise}
async function ensureEmbed(){if(embedder)return embedder;emit("loading","Loading local embedding model");const m=await lib();embedder=await m.pipeline("feature-extraction",EMBED_MODEL,{dtype:"q8"});emit("ready","Embedding model ready");return embedder}
async function ensureChat(){if(chat)return chat;emit("loading","Loading Gemma 3 270M local language model");const m=await lib();let device="wasm",dtype="q4";try{if(navigator.gpu){const adapter=await navigator.gpu.requestAdapter();if(adapter){device="webgpu"}}}catch(e){}try{chat=await m.pipeline("text-generation",CHAT_MODEL,{dtype,device});emit(device==="webgpu"?"ready-webgpu":"ready-wasm",device==="webgpu"?"Gemma 3 270M ready on WebGPU":"Gemma 3 270M ready in WASM");return chat}catch(e){if(device==="webgpu"){emit("loading","WebGPU failed; retrying Gemma 3 270M in WASM");chat=await m.pipeline("text-generation",CHAT_MODEL,{dtype:"q4",device:"wasm"});emit("ready-wasm","Gemma 3 270M ready in WASM");return chat}throw e}}
async function embed(text){const p=await ensureEmbed();const o=await p(String(text),{pooling:"mean",normalize:true});return Array.from(o.data)}
async function generate(prompt,options={}){const p=await ensureChat();const o=await p([{role:"user",content:String(prompt)}],{max_new_tokens:options.max_new_tokens||120,temperature:options.temperature??.15,do_sample:false});const g=Array.isArray(o)?o[0]?.generated_text:null;const raw=Array.isArray(g)?(g[g.length-1]?.content||""):typeof g==="string"?g:String(g||o);return raw.includes("ANSWER:")?raw.split("ANSWER:").pop().trim():raw.replace(String(prompt),"").trim()}
function capability(){
const ua=navigator.userAgent||"", mobile=/Android|iPhone|iPad|iPod/i.test(ua), memory=navigator.deviceMemory||0;
const cores=navigator.hardwareConcurrency||0, webgpu=!!navigator.gpu;
const constrained=mobile&&((memory&&memory<=3)||(cores&&cores<=4));
return {mobile,memory,cores,webgpu,constrained,mode:webgpu?"WebGPU":"WASM"};
}
function status(){return {state,...capability(),embedding:EMBED_MODEL,chat:CHAT_MODEL,independent:true}}
window.OmniLocalAI={load:async()=>{await ensureEmbed();await ensureChat();return status()},embed,generate,status,capability,onStatus:fn=>(listeners.add(fn),()=>listeners.delete(fn))};
})();