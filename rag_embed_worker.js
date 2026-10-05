/* Omni Suite — RAG embedding worker
 * Keeps Transformers.js inference off the page's main/UI thread.
 */
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";

const MODEL="Xenova/all-MiniLM-L6-v2";
let extractor=null;

async function init(){
  if(extractor)return;
  let device="wasm",dtype="q8";
  try{if(self.navigator?.gpu){const adapter=await self.navigator.gpu.requestAdapter();if(adapter){device="webgpu";dtype="fp16"}}}catch(_){}
  try{
    extractor=await pipeline("feature-extraction",MODEL,{device,dtype});
    self.postMessage({type:"ready",device});
  }catch(e){
    if(device==="webgpu"){
      extractor=await pipeline("feature-extraction",MODEL,{device:"wasm",dtype:"q8"});
      self.postMessage({type:"ready",device:"wasm"});
    }else throw e;
  }
}

self.onmessage=async e=>{
  const d=e.data||{};
  try{
    if(d.type==="init"){await init();return}
    if(d.type!=="embed")return;
    await init();
    const texts=Array.isArray(d.texts)?d.texts:[];
    const vectors=[];
    for(let i=0;i<texts.length;i++){
      const o=await extractor(texts[i],{pooling:"mean",normalize:true});
      vectors.push(Array.from(o.data));
      self.postMessage({type:"progress",done:i+1,total:texts.length});
    }
    self.postMessage({type:"result",id:d.id,vectors});
  }catch(err){
    self.postMessage({type:"error",id:d.id,message:err?.message||String(err)});
  }
};