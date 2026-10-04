/* Omni Suite — Independent Local AI Runtime
 * Deliberately isolated from Local Engine. No shared state, APIs, workers, or DOM dependencies.
 * Runs Transformers.js directly in the browser and exposes window.OmniLocalAI.
 */
(()=>{"use strict";
const CDN="https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";
const EMBED_MODEL="Xenova/all-MiniLM-L6-v2";
const CHAT_MODEL="Xenova/Qwen1.5-0.5B-Chat";
let libPromise=null,embedder=null,chat=null,state="idle";
const listeners=new Set();
function emit(next,detail=""){state=next;listeners.forEach(fn=>{try{fn({state,detail})}catch(e){}})}
async function lib(){if(!libPromise)libPromise=import(CDN);return libPromise}
async function ensureEmbed(){if(embedder)return embedder;emit("loading","Loading local embedding model");const m=await lib();embedder=await m.pipeline("feature-extraction",EMBED_MODEL,{dtype:"q8"});emit("ready","Embedding model ready");return embedder}
async function ensureChat(){if(chat)return chat;emit("loading","Loading local language model");const m=await lib();chat=await m.pipeline("text-generation",CHAT_MODEL,{dtype:"q4",device:navigator.gpu?"webgpu":"wasm"});emit(navigator.gpu?"ready-webgpu":"ready-wasm",navigator.gpu?"Local AI ready on WebGPU":"Local AI ready in WASM");return chat}
async function embed(text){const p=await ensureEmbed();const o=await p(String(text),{pooling:"mean",normalize:true});return Array.from(o.data)}
async function generate(prompt,options={}){const p=await ensureChat();const o=await p(String(prompt),{max_new_tokens:options.max_new_tokens||220,temperature:options.temperature??.15,do_sample:false});const raw=Array.isArray(o)?o[0]?.generated_text||"":String(o);return raw.includes("ANSWER:")?raw.split("ANSWER:").pop().trim():raw.replace(String(prompt),"").trim()}
function capability(){
const ua=navigator.userAgent||"", mobile=/Android|iPhone|iPad|iPod/i.test(ua), memory=navigator.deviceMemory||0;
const cores=navigator.hardwareConcurrency||0, webgpu=!!navigator.gpu;
const constrained=mobile&&((memory&&memory<=3)||(cores&&cores<=4));
return {mobile,memory,cores,webgpu,constrained,mode:webgpu?"WebGPU":"WASM"};
}
function status(){return {state,...capability(),embedding:EMBED_MODEL,chat:CHAT_MODEL,independent:true}}
window.OmniLocalAI={load:async()=>{await ensureEmbed();await ensureChat();return status()},embed,generate,status,capability,onStatus:fn=>(listeners.add(fn),()=>listeners.delete(fn))};
})();