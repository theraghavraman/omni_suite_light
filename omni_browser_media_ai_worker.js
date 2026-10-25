/* Omni Suite — on-device media AI worker (module worker).
 * Runs background removal, depth estimation and speech-to-text with Transformers.js
 * off the page's main thread, so the studio stays responsive while a model works.
 * Models download once from Hugging Face on first use and are then served from the
 * browser cache. Nothing is uploaded: images and audio never leave this device.
 */
import { pipeline, env, RawImage } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";

env.allowLocalModels = false;
env.useBrowserCache = true;

// dtype per device. WebGPU runs half precision fast; the WASM (CPU) path needs either
// full precision (BiRefNet ships no 8-bit build) or 8-bit quantised weights.
const MODELS = {
  background: { task: "background-removal", id: "onnx-community/BiRefNet_lite-ONNX", webgpu: "fp16", wasm: "fp32" },
  depth: { task: "depth-estimation", id: "onnx-community/depth-anything-v2-small", webgpu: "fp16", wasm: "q8" },
  // Whisper's 8-bit build is the smallest reliable option and is fast enough on CPU.
  transcribe: { task: "automatic-speech-recognition", id: "onnx-community/whisper-base", wasmOnly: true, wasm: "q8" },
};

const ready = new Map();   // kind -> {pipe, device}
const loading = new Map(); // kind -> Promise<{pipe, device}>

async function hasWebGPU() {
  try { return !!(self.navigator?.gpu && await self.navigator.gpu.requestAdapter()); }
  catch (_) { return false; }
}

function load(kind, id) {
  if (ready.has(kind)) return Promise.resolve(ready.get(kind));
  if (loading.has(kind)) return loading.get(kind);
  const m = MODELS[kind];
  const progress_callback = x => {
    if (x && x.status === "progress" && x.file) {
      self.postMessage({ type: "progress", id, file: x.file, loaded: x.loaded || 0, total: x.total || 0 });
    }
  };
  const p = (async () => {
    const gpu = !m.wasmOnly && await hasWebGPU();
    if (gpu) {
      try {
        return { pipe: await pipeline(m.task, m.id, { device: "webgpu", dtype: m.webgpu, progress_callback }), device: "webgpu" };
      } catch (err) {
        console.warn("[Omni media AI] WebGPU load failed; retrying on CPU (WASM).", err);
      }
    }
    return { pipe: await pipeline(m.task, m.id, { device: "wasm", dtype: m.wasm, progress_callback }), device: "wasm" };
  })();
  loading.set(kind, p);
  return p.then(r => { ready.set(kind, r); loading.delete(kind); return r; },
                e => { loading.delete(kind); throw e; });
}

self.onmessage = async e => {
  const { id, kind, input } = e.data || {};
  try {
    if (!MODELS[kind]) throw new Error("Unknown on-device AI task: " + kind);
    self.postMessage({ type: "status", id, stage: ready.has(kind) ? "running" : "loading" });
    const { pipe, device } = await load(kind, id);
    self.postMessage({ type: "status", id, stage: "running", device });

    if (kind === "background") {
      const image = await RawImage.fromBlob(input);
      const cutout = await pipe(image);                 // RGBA image, background made transparent
      const blob = await cutout.toBlob("image/png");
      self.postMessage({ type: "result", id, blob, width: cutout.width, height: cutout.height, device, model: MODELS[kind].id });
      return;
    }
    if (kind === "depth") {
      const image = await RawImage.fromBlob(input);
      const { depth } = await pipe(image);              // greyscale: brighter = closer
      const blob = await depth.toBlob("image/png");
      self.postMessage({ type: "result", id, blob, width: depth.width, height: depth.height, device, model: MODELS[kind].id });
      return;
    }
    // transcribe: input is mono Float32Array PCM at 16 kHz, decoded on the page.
    const out = await pipe(input, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(out) ? out.map(x => x.text).join(" ") : out?.text || "").replace(/\s+/g, " ").trim();
    self.postMessage({ type: "result", id, text, device, model: MODELS[kind].id });
  } catch (err) {
    self.postMessage({ type: "error", id, message: err?.message || String(err) });
  }
};
