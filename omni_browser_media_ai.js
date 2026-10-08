/* Omni Suite — on-device media AI (background removal, depth map, transcription).
 * Page-side half: starts omni_browser_media_ai_worker.js, decodes audio with the
 * browser's AudioContext (not available inside workers), reports model-download
 * progress, and exposes window.OmniMediaAI. Used by AI Assist (omni_browser_ai.js).
 * These tasks run in the browser — no Local Engine, no upload. Models download
 * once from Hugging Face on first use and are cached by the browser.
 */
(()=>{"use strict";
const SCRIPT_URL=(document.currentScript&&document.currentScript.src)||location.href;
const WORKER_URL=new URL("./omni_browser_media_ai_worker.js?v=1",SCRIPT_URL).href;
const MAX_AUDIO_SECONDS=30*60; // decoded 16 kHz audio is held in memory; longer files should be trimmed first
const MODELS={
 background:{name:"BiRefNet lite",download:"≈115 MB with WebGPU, ≈225 MB without"},
 depth:{name:"Depth Anything V2 Small",download:"≈50 MB with WebGPU, ≈27 MB without"},
 transcribe:{name:"Whisper base",download:"≈77 MB"}
};
let worker=null,seq=0;
const pending=new Map();

function fail(message){
 for(const [,p] of pending)p.reject(new Error(message));
 pending.clear();
 if(worker){try{worker.terminate()}catch(_){}}
 worker=null;
}
function getWorker(){
 if(worker)return worker;
 if(typeof Worker==="undefined")throw new Error("This browser cannot run background AI workers.");
 worker=new Worker(WORKER_URL,{type:"module"});
 worker.onmessage=e=>{
  const d=e.data||{},p=pending.get(d.id);if(!p)return;
  if(d.type==="progress"){
   p.files[d.file]={loaded:d.loaded,total:d.total};
   let loaded=0,total=0;for(const f of Object.values(p.files)){loaded+=f.loaded;total+=f.total}
   p.onProgress({stage:"download",loaded,total,percent:total?Math.min(100,Math.round(loaded/total*100)):null});
  }else if(d.type==="status"){
   p.onProgress({stage:d.stage,device:d.device});
  }else if(d.type==="result"){pending.delete(d.id);p.resolve(d)}
  else if(d.type==="error"){pending.delete(d.id);p.reject(new Error(d.message||"On-device AI failed."))}
 };
 // A worker that cannot even start (blocked CDN import, unsupported module workers) fires "error".
 worker.onerror=e=>{e.preventDefault?.();fail("The on-device AI runtime could not start. Check the internet connection for the first model download, then try again.")};
 return worker;
}
function call(kind,input,opts={},transfer=[]){
 return new Promise((resolve,reject)=>{
  const id=++seq;
  pending.set(id,{resolve,reject,files:{},onProgress:typeof opts.onProgress==="function"?opts.onProgress:()=>{}});
  try{getWorker().postMessage({id,kind,input},transfer)}catch(e){pending.delete(id);reject(e)}
 });
}
function asImageBlob(file){
 if(!(file instanceof Blob))throw new Error("Choose an image first.");
 if(file.type&&!file.type.startsWith("image/"))throw new Error(file.name+" is not an image this browser can read.");
 return file;
}
async function decodeAudio(file){
 if(!(file instanceof Blob))throw new Error("Choose an audio or video file first.");
 const AC=window.AudioContext||window.webkitAudioContext;
 if(!AC)throw new Error("This browser cannot decode audio for transcription.");
 let ctx;
 try{ctx=new AC({sampleRate:16000})}catch(_){throw new Error("This browser cannot resample audio to 16 kHz for transcription.")}
 try{
  let buf;
  try{buf=await ctx.decodeAudioData(await file.arrayBuffer())}
  catch(_){throw new Error("This browser could not read the audio track in "+(file.name||"this file")+". Convert it to MP3 or WAV in Audio Studio, then try again.")}
  if(buf.duration>MAX_AUDIO_SECONDS)throw new Error("This recording is "+Math.round(buf.duration/60)+" minutes long. On-device transcription supports up to "+MAX_AUDIO_SECONDS/60+" minutes — trim it in Audio or Video Studio first.");
  const n=buf.numberOfChannels,len=buf.length,mono=new Float32Array(len);
  for(let c=0;c<n;c++){const ch=buf.getChannelData(c);for(let i=0;i<len;i++)mono[i]+=ch[i]/n}
  return {samples:mono,seconds:buf.duration};
 }finally{try{await ctx.close()}catch(_){}}
}
async function removeBackground(file,opts={}){
 const r=await call("background",asImageBlob(file),opts);
 return {blob:r.blob,width:r.width,height:r.height,device:r.device,model:MODELS.background.name};
}
async function depth(file,opts={}){
 const r=await call("depth",asImageBlob(file),opts);
 return {blob:r.blob,width:r.width,height:r.height,device:r.device,model:MODELS.depth.name};
}
async function transcribe(file,opts={}){
 (opts.onProgress||(()=>{}))({stage:"decoding"});
 const {samples,seconds}=await decodeAudio(file);
 if(!seconds||!samples.length)throw new Error("The file has no audio to transcribe.");
 const r=await call("transcribe",samples,opts,[samples.buffer]);
 return {text:r.text||"",seconds,device:r.device,model:MODELS.transcribe.name};
}
window.OmniMediaAI=Object.freeze({version:"1.0.0",models:MODELS,removeBackground,depth,transcribe});
})();
