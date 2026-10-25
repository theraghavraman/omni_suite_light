/* Omni Suite — Local AI Assist runtime
 * Text and vision-LLM tasks: Browser UI -> loopback Python Local Engine -> Ollama or LM Studio.
 * Background removal, depth maps and transcription are not LLM tasks; they run on-device in
 * this browser through omni_browser_media_ai.js (window.OmniMediaAI), with no Local Engine needed.
 */
(()=>{"use strict";
const BASE="http://127.0.0.1:8765";
let cached=null,pending=null;
async function status(){
 if(pending)return pending;
 pending=(async()=>{const r=await fetch(BASE+"/api/ai/status",{cache:"no-store"});if(!r.ok)throw new Error("Local AI bridge unavailable. Start Omni Local Engine.");return await r.json()})().finally(()=>{pending=null});
 cached=await pending;return cached;
}
async function call(body){
 const s=await status();
 const r=await fetch(BASE+"/api/process",{method:"POST",headers:{"Content-Type":"application/json","X-Omni-Token":s.token},body:JSON.stringify(body)});
 let j={};try{j=await r.json()}catch(e){}
 if(!r.ok||j.ok===false)throw new Error(j.error||("Local AI request failed ("+r.status+")"));
 return j;
}
const clean=x=>String(x||"").replace(/\s+/g," ").trim();
async function generate(prompt,o={}){
 const j=await call({op:"ai_generate",prompt:String(prompt||"").slice(0,30000),max_tokens:o.maxNewTokens||220,temperature:o.temperature??0.2,image_data_url:o.imageDataUrl||null});
 return clean(j.text)||"No usable answer was generated.";
}
async function summarize(text,o={}){
 return generate("Summarize the following Studio content. Preserve concrete facts and remove repetition.\n\n"+String(text||"").slice(0,30000),o);
}
async function embed(text){
 const j=await call({op:"ai_embed",text:String(text||"").slice(0,12000)});
 return Array.from(j.vector||[]);
}
async function caption(image){return generate("Describe the supplied image accurately. Mention only visible content and useful document details.",{maxNewTokens:160,imageDataUrl:image})}
async function docQa(image,q){return generate("Answer this question about the supplied document image. Use only visible evidence.\nQUESTION: "+String(q||""),{maxNewTokens:180,imageDataUrl:image})}
async function advancedOcr(image){return generate("Read the text visible in this image as accurately as possible. Return the transcription only.",{maxNewTokens:500,imageDataUrl:image})}
async function entities(text){const x=await generate("Extract named entities from this text. Return one entity per line as ENTITY — TYPE.\n\n"+String(text||"").slice(0,18000),{maxNewTokens:180});return x.split("\n").filter(Boolean).map(word=>({word,entity_group:"LOCAL_LLM",score:1}))}
async function detect(image){const x=await generate("List the important visible objects in this image, one per line.",{maxNewTokens:160,imageDataUrl:image});return x.split("\n").filter(Boolean).map(label=>({label,score:1,box:null}))}
function media(){if(!window.OmniMediaAI)throw new Error("On-device media AI (omni_browser_media_ai.js) is not loaded.");return window.OmniMediaAI}
async function transcribe(file,o={}){return media().transcribe(file,o)}
async function speak(){throw new Error("No browser TTS model is used. Use the Local Engine/native TTS path.")}
async function removeBackground(file,o={}){return media().removeBackground(file,o)}
async function depth(file,o={}){return media().depth(file,o)}
function localStatus(){
 const s=cached||{};
 return {version:"2.0.0-local",local_only:true,browser_cache:false,models:{},runtime:{provider:s.provider||"unknown",model:s.model||"",models_loaded:s.model?1:0,backend:"Python Local Engine → Ollama/LM Studio"}};
}
window.OmniBrowserAI=Object.freeze({version:"2.0.0-local",registry:{},status:localStatus,load:status,generate,summarize,embed,caption,detect,removeBackground,transcribe,speak,advancedOcr,docQa,entities,depth});
})();