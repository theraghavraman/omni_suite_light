/* Omni Browser AI Engine
 * Isolated browser inference subsystem for contextual AI Assist controls.
 * This engine is intentionally separate from Omni Assistant, Private RAG,
 * and Omni Language Engine. Models are loaded lazily on first use and cached.
 */
(()=>{"use strict";

const CDN="https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const VERSION="1.3.0";
const MODEL_REGISTRY=Object.freeze({
  general:{label:"SmolLM2 135M",task:"text-generation",model:"onnx-community/SmolLM2-135M-Instruct-ONNX",dtype:"q4",role:"General browser AI"},
  embeddings:{label:"all-MiniLM-L6-v2",task:"feature-extraction",model:"Xenova/all-MiniLM-L6-v2",dtype:"q4",role:"Embeddings / semantic similarity"},
  summarizer:{label:"FLAN-T5 Small",task:"text2text-generation",model:"Xenova/flan-t5-small",dtype:"q4",role:"Lightweight summarization and document instructions"},
  asr:{label:"Whisper Tiny",task:"automatic-speech-recognition",model:"Xenova/whisper-tiny",dtype:"q4",role:"Speech to text"},
  tts:{label:"Supertonic TTS",task:"text-to-speech",model:"onnx-community/Supertonic-TTS-ONNX",dtype:"fp32",role:"Text to speech"},
  caption:{label:"ViT-GPT2",task:"image-to-text",model:"Xenova/vit-gpt2-image-captioning",dtype:"q4",role:"Image captioning"},
  objects:{label:"DETR",task:"object-detection",model:"Xenova/detr-resnet-50",dtype:"q4",role:"Object detection"},
  background:{label:"MODNet",task:"background-removal",model:"Xenova/modnet",dtype:"fp32",role:"Background removal"},
  advancedOcr:{label:"TrOCR Small",task:"image-to-text",model:"Xenova/trocr-small-printed",dtype:"q4",role:"Advanced printed OCR"},
  documentQa:{label:"Donut DocVQA",task:"document-question-answering",model:"Xenova/donut-base-finetuned-docvqa",dtype:"q4",role:"Document understanding"},
  ner:{label:"Multilingual NER",task:"token-classification",model:"Xenova/bert-base-multilingual-cased-ner-hrl",dtype:"q4",role:"Entity extraction"},
  depth:{label:"Depth Anything V2 Small",task:"depth-estimation",model:"onnx-community/depth-anything-v2-small",dtype:"q4",role:"Image depth"},
  stronger:{label:"Qwen2.5 0.5B Instruct (Experimental)",task:"text-generation",model:"onnx-community/Qwen2.5-0.5B-Instruct",dtype:"q4",role:"Optional experimental document AI"}
});
const loaded=new Map(), loading=new Map();
let transformers=null;

async function runtime(){
  if(transformers)return transformers;
  transformers=await import(CDN);
  transformers.env.allowLocalModels=false;
  transformers.env.allowRemoteModels=true;
  transformers.env.useBrowserCache=true;
  return transformers;
}
function gpu(){return !!(navigator.gpu&&window.isSecureContext)}
function dtypeFor(m){if(m.dtype==="fp32")return "fp32";return m.dtype||"q4"}
async function load(key){
  if(loaded.has(key))return loaded.get(key);
  if(loading.has(key))return loading.get(key);
  const spec=MODEL_REGISTRY[key];
  if(!spec)throw new Error("Unknown browser AI model: "+key);
  const p=(async()=>{
    const m=await runtime();
    const useGpu=gpu() && ["general","caption","objects","depth","advancedOcr","stronger"].includes(key);
    const options={dtype:(key==="stronger" ? (useGpu?"q4f16":"q4") : dtypeFor(spec))};
    if(useGpu)options.device="webgpu";
    const pipe=await m.pipeline(spec.task,spec.model,options);
    loaded.set(key,pipe);
    return pipe;
  })().catch(e=>{loading.delete(key);throw e});
  loading.set(key,p);
  return p;
}
function trimText(t,n=7000){return String(t||"").replace(/\u0000/g," ").replace(/\s+/g," ").trim().slice(0,n)}
function cleanGeneratedText(s){let x=String(s||"").replace(/\s+/g," ").trim();x=x.replace(/^(answer|summary|response)\s*:\s*/i,"").trim();const w=x.split(/\s+/),o=[];for(const v of w){if(o.length>=3&&v===o[o.length-1]&&v===o[o.length-2])continue;o.push(v)}return o.join(" ")}
function textFromOutput(o){
  if(Array.isArray(o)){
    if(o[0]?.generated_text!=null){const g=o[0].generated_text;if(Array.isArray(g))return String(g[g.length-1]?.content||g[g.length-1]?.text||"");return String(g);}
    if(o[0]?.summary_text!=null)return String(o[0].summary_text);
    if(o[0]?.text!=null)return String(o[0].text);
    if(o[0]?.answer!=null)return String(o[0].answer);
  }
  if(o?.generated_text!=null)return String(o.generated_text);
  if(o?.summary_text!=null)return String(o.summary_text);
  if(o?.text!=null)return String(o.text);
  return JSON.stringify(o,null,2);
}
async function generate(prompt,options={}){
  const key=options.model||"general";
  const pipe=await load(key);
  const p=trimText(prompt,options.maxInput||6500);
  let out;
  if(key==="summarizer"){out=await pipe("summarize: "+p,{max_new_tokens:options.maxNewTokens||120,num_beams:4,no_repeat_ngram_size:3,return_full_text:false});}else if(key==="stronger"){
    const messages=[{role:"system",content:"You are a precise document-analysis assistant. Use only facts supplied by the user. Never invent missing details. Do not repeat phrases or sections. Give a concise, well-structured final answer."},{role:"user",content:p}];
    out=await pipe(messages,{max_new_tokens:options.maxNewTokens||220,do_sample:false,return_full_text:false,enable_thinking:false});
  }else{
    out=await pipe(p,{max_new_tokens:options.maxNewTokens||180,do_sample:false,return_full_text:false});
  }
  return cleanGeneratedText(textFromOutput(out))||"No usable answer was generated.";
}
async function summarize(text,options={}){
  const pipe=await load("summarizer");
  const out=await pipe(trimText(text,options.maxInput||6000),{max_new_tokens:options.maxNewTokens||180,min_length:20});
  return textFromOutput(out);
}
async function embed(text){
  const pipe=await load("embeddings");
  const out=await pipe(trimText(text,5000),{pooling:"mean",normalize:true});
  return Array.from(out.data);
}
async function caption(image){
  const pipe=await load("caption");
  const out=await pipe(image,{max_new_tokens:80});
  return textFromOutput(out);
}
async function detect(image){
  const pipe=await load("objects");
  const out=await pipe(image,{threshold:0.35});
  return (out||[]).map(x=>({label:x.label,score:Number(x.score||0),box:x.box||null}));
}
async function removeBackground(image){
  const pipe=await load("background");
  const out=await pipe(image);
  const item=Array.isArray(out)?out[0]:out;
  if(item?.toBlob)return await item.toBlob();
  if(item?.save){const c=document.createElement("canvas");item.toCanvas?.(c);return await new Promise(r=>c.toBlob(r,"image/png"))}
  throw new Error("Background-removal model returned no browser image output.");
}
async function transcribe(audio,options={}){
  const pipe=await load("asr");
  const out=await pipe(audio,{chunk_length_s:30,stride_length_s:5,return_timestamps:!!options.timestamps});
  return out?.text||textFromOutput(out);
}
async function speak(text){
  const pipe=await load("tts");
  return await pipe(trimText(text,3000));
}
async function advancedOcr(image){
  const pipe=await load("advancedOcr");
  const out=await pipe(image,{max_new_tokens:160});
  return textFromOutput(out);
}
async function docQa(image,question){
  const pipe=await load("documentQa");
  const out=await pipe(image,String(question||"What is this document about?"));
  return textFromOutput(out);
}
async function entities(text){
  const pipe=await load("ner");
  return await pipe(trimText(text,4500),{aggregation_strategy:"simple"});
}
async function depth(image){
  const pipe=await load("depth");
  return await pipe(image);
}
function status(){
  const out={version:VERSION,isolated_from_assistant:true,isolated_from_rag:true,isolated_from_language_engine:true,models:{}};
  Object.entries(MODEL_REGISTRY).forEach(([k,v])=>{out.models[k]={...v,loaded:loaded.has(k),loading:loading.has(k)}});
  out.runtime={webgpu:gpu(),browser_cache:true,models_loaded:loaded.size};
  return out;
}
window.OmniBrowserAI=Object.freeze({version:VERSION,registry:MODEL_REGISTRY,status,load,generate,summarize,embed,caption,detect,removeBackground,transcribe,speak,advancedOcr,docQa,entities,depth});
})();