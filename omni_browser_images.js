/* Omni Suite — Image Tools engine.
 * Robust decoding (EXIF orientation, SVG, TIFF, HEIC/HEIF), real AVIF/GIF/TIFF/BMP/ICO/TGA/PDF output,
 * per-file error isolation in the batch converter, DPI written into JPEG/PNG files, and an optional
 * "max file size" target for form uploads. Heavy codecs load only when a file needs them.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const CDN='https://cdn.jsdelivr.net/npm/';
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'image').replace(/\.[^.]+$/,'')||'image';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const notify=(m,e)=>{if(window.omniNotify)window.omniNotify(m,e);};
const fmtSize=b=>b>=1048576?(b/1048576).toFixed(2)+' MB':(b/1024).toFixed(1)+' KB';
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('Could not load '+src.split('/').slice(-1)[0]+' — check your internet connection.'));document.head.appendChild(s);});}
const once={};const lazy=(k,f)=>once[k]||(once[k]=f().catch(e=>{delete once[k];throw e;}));
const utif=()=>lazy('utif',async()=>{if(!window.pako)await loadScript(CDN+'pako@1.0.11/dist/pako.min.js');if(!window.UTIF)await loadScript(CDN+'utif@3.1.0/UTIF.js');return window.UTIF;});
const heic=()=>lazy('heic',async()=>{if(!window.heic2any)await loadScript(CDN+'heic2any@0.0.4/dist/heic2any.min.js');return window.heic2any;});
const gifenc=()=>lazy('gif',()=>import(CDN+'gifenc@1.0.3/dist/gifenc.esm.js'));
const avifEnc=()=>lazy('avif',async()=>{const mod=await import(CDN+'@jsquash/avif@2.1.1/encode.js/+esm');const wasm=await WebAssembly.compileStreaming(fetch(CDN+'@jsquash/avif@2.1.1/codec/enc/avif_enc.wasm'));await mod.init(wasm);return mod.default;});

/* ---------- decode anything to a canvas ---------- */
const isHeic=f=>/^(heic|heif)$/.test(ext(f.name))||/heic|heif/.test(f.type||'');
const isTiff=f=>/^tiff?$/.test(ext(f.name))||/tiff/.test(f.type||'');
const isSvg=f=>ext(f.name)==='svg'||/svg/.test(f.type||'');
function canvasOf(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
async function decode(file){
  if(isHeic(file)){const conv=await heic();const out=await conv({blob:file,toType:'image/png'});file=Array.isArray(out)?out[0]:out;}
  if(isTiff(file)){const U=await utif();const buf=await file.arrayBuffer();const ifds=U.decode(buf);if(!ifds.length)throw new Error('No image inside the TIFF.');U.decodeImage(buf,ifds[0]);const rgba=U.toRGBA8(ifds[0]);const c=canvasOf(ifds[0].width,ifds[0].height);c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer),c.width,c.height),0,0);return c;}
  if(isSvg(file)){let txt=await file.text();const doc=new DOMParser().parseFromString(txt,'image/svg+xml');const svg=doc.documentElement;let w=parseFloat(svg.getAttribute('width')),h=parseFloat(svg.getAttribute('height'));const vb=(svg.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number);if(!(w>0&&h>0)){w=vb[2]||512;h=vb[3]||512;}const k=Math.max(1,1024/Math.max(w,h));svg.setAttribute('width',w*k);svg.setAttribute('height',h*k);txt=new XMLSerializer().serializeToString(svg);
    const url=URL.createObjectURL(new Blob([txt],{type:'image/svg+xml'}));try{const im=new Image();await new Promise((r,j)=>{im.onload=r;im.onerror=()=>j(new Error('This SVG could not be rendered.'));im.src=url;});const c=canvasOf(w*k,h*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c;}finally{URL.revokeObjectURL(url);}}
  let bmp;try{bmp=await createImageBitmap(file,{imageOrientation:'from-image'});}
  catch(_){const url=URL.createObjectURL(file);try{const im=new Image();await new Promise((r,j)=>{im.onload=r;im.onerror=()=>j(new Error('This browser cannot decode '+file.name+'. Formats like JPEG XL, PSD or RAW need the Local Engine.'));im.src=url;});bmp=im;}finally{URL.revokeObjectURL(url);}}
  const c=canvasOf(bmp.width||bmp.naturalWidth,bmp.height||bmp.naturalHeight);c.getContext('2d').drawImage(bmp,0,0);if(bmp.close)bmp.close();return c;
}

/* ---------- encoders ---------- */
const flatten=(c,bg='#ffffff')=>{const o=canvasOf(c.width,c.height),g=o.getContext('2d');g.fillStyle=bg;g.fillRect(0,0,o.width,o.height);g.drawImage(c,0,0);return o;};
const toBlob=(c,mime,q)=>new Promise(r=>c.toBlob(r,mime,q));
function setDpi(bytes,mime,dpi){
  dpi=Math.round(dpi);if(!dpi)return bytes;const b=new Uint8Array(bytes);
  if(mime==='image/jpeg'&&b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF&&b[3]===0xE0&&b[6]===0x4A&&b[7]===0x46){b[13]=1;b[14]=dpi>>8;b[15]=dpi&255;b[16]=dpi>>8;b[17]=dpi&255;return b;}
  if(mime==='image/png'&&b[0]===0x89&&b[1]===0x50){// insert pHYs after IHDR (33 bytes in)
    const ppm=Math.round(dpi/0.0254);const chunk=new Uint8Array(21);const dv=new DataView(chunk.buffer);dv.setUint32(0,9);chunk.set([0x70,0x48,0x59,0x73],4);dv.setUint32(8,ppm);dv.setUint32(12,ppm);chunk[16]=1;dv.setUint32(17,crc32(chunk.subarray(4,17)));
    let p=8,ins=33;while(p<b.length){const len=new DataView(b.buffer,b.byteOffset+p).getUint32(0);const type=String.fromCharCode(...b.subarray(p+4,p+8));if(type==='pHYs'){const o=new Uint8Array(b.length-(len+12));o.set(b.subarray(0,p));o.set(b.subarray(p+len+12),p);return setDpi(o,mime,dpi);}if(type==='IHDR')ins=p+len+12;if(type==='IDAT')break;p+=len+12;}
    const o=new Uint8Array(b.length+21);o.set(b.subarray(0,ins));o.set(chunk,ins);o.set(b.subarray(ins),ins+21);return o;}
  return b;
}
let CRC=null;function crc32(d){if(!CRC){CRC=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;CRC[n]=c>>>0;}}let c=0xFFFFFFFF;for(let i=0;i<d.length;i++)c=CRC[(c^d[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function bmpEncode(c){const w=c.width,h=c.height,d=c.getContext('2d').getImageData(0,0,w,h).data,row=Math.ceil(w*3/4)*4,size=54+row*h,o=new Uint8Array(size),v=new DataView(o.buffer);o[0]=66;o[1]=77;v.setUint32(2,size,true);v.setUint32(10,54,true);v.setUint32(14,40,true);v.setInt32(18,w,true);v.setInt32(22,h,true);v.setUint16(26,1,true);v.setUint16(28,24,true);v.setUint32(34,row*h,true);v.setInt32(38,2835,true);v.setInt32(42,2835,true);
  for(let y=0;y<h;y++){const r=54+(h-1-y)*row;for(let x=0;x<w;x++){const i=(y*w+x)*4,a=d[i+3]/255;o[r+x*3]=Math.round(d[i+2]*a+255*(1-a));o[r+x*3+1]=Math.round(d[i+1]*a+255*(1-a));o[r+x*3+2]=Math.round(d[i]*a+255*(1-a));}}return new Blob([o],{type:'image/bmp'});}
function tgaEncode(c){const w=c.width,h=c.height,d=c.getContext('2d').getImageData(0,0,w,h).data,o=new Uint8Array(18+w*h*4);o[2]=2;o[12]=w&255;o[13]=w>>8;o[14]=h&255;o[15]=h>>8;o[16]=32;o[17]=0x28;for(let i=0,j=18;i<d.length;i+=4,j+=4){o[j]=d[i+2];o[j+1]=d[i+1];o[j+2]=d[i];o[j+3]=d[i+3];}return new Blob([o],{type:'image/x-tga'});}
async function icoEncode(c){const sizes=[16,24,32,48,64,128,256].filter(s=>s<=Math.max(16,Math.min(256,Math.max(c.width,c.height))));const pngs=[];for(const s of sizes){const t=canvasOf(s,s),g=t.getContext('2d');g.imageSmoothingQuality='high';const k=Math.min(s/c.width,s/c.height);g.drawImage(c,(s-c.width*k)/2,(s-c.height*k)/2,c.width*k,c.height*k);pngs.push(new Uint8Array(await (await toBlob(t,'image/png')).arrayBuffer()));}
  const head=6+16*sizes.length,total=head+pngs.reduce((a,p)=>a+p.length,0),o=new Uint8Array(total),v=new DataView(o.buffer);v.setUint16(2,1,true);v.setUint16(4,sizes.length,true);let off=head;sizes.forEach((s,i)=>{const e=6+16*i;o[e]=s>=256?0:s;o[e+1]=s>=256?0:s;v.setUint16(e+4,1,true);v.setUint16(e+6,32,true);v.setUint32(e+8,pngs[i].length,true);v.setUint32(e+12,off,true);o.set(pngs[i],off);off+=pngs[i].length;});return new Blob([o],{type:'image/x-icon'});}
async function tiffEncode(c){const U=await utif();const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return new Blob([U.encodeImage(d.buffer,c.width,c.height)],{type:'image/tiff'});}
async function gifEncode(c){const {GIFEncoder,quantize,applyPalette}=await gifenc();const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const pal=quantize(d,256,{format:'rgba4444',oneBitAlpha:true});const idx=applyPalette(d,pal,'rgba4444');const g=GIFEncoder();const tr=pal.findIndex(p=>p[3]===0);g.writeFrame(idx,c.width,c.height,{palette:pal,transparent:tr>=0,transparentIndex:Math.max(0,tr)});g.finish();return new Blob([g.bytes()],{type:'image/gif'});}
async function avifEncode(c,q){const enc=await avifEnc();const d=c.getContext('2d').getImageData(0,0,c.width,c.height);return new Blob([await enc(d,{quality:Math.round(q*100*0.8),speed:7})],{type:'image/avif'});}
async function pdfEncode(c,dpi=150){if(!window.PDFLib)throw new Error('PDF engine is not loaded.');const doc=await PDFLib.PDFDocument.create();const jpg=new Uint8Array(await (await toBlob(flatten(c),'image/jpeg',0.92)).arrayBuffer());const img=await doc.embedJpg(jpg);const w=c.width*72/dpi,h=c.height*72/dpi;doc.addPage([w,h]).drawImage(img,{x:0,y:0,width:w,height:h});return new Blob([await doc.save()],{type:'application/pdf'});}
async function svgEncode(c){const png=await toBlob(c,'image/png');const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(png);});return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+c.width+'" height="'+c.height+'" viewBox="0 0 '+c.width+' '+c.height+'"><image width="'+c.width+'" height="'+c.height+'" xlink:href="'+b64+'"/></svg>'],{type:'image/svg+xml'});}
const ENCODERS=new Set(['png','jpg','jpeg','webp','avif','gif','tiff','tif','bmp','ico','tga','pdf','svg']);
async function encode(c,fmt,{quality=0.92,dpi=0}={}){
  const f=fmt==='jpeg'?'jpg':fmt==='tif'?'tiff':fmt;
  if(f==='png'||f==='jpg'||f==='webp'){const mime=f==='jpg'?'image/jpeg':'image/'+f;const src=f==='jpg'?flatten(c):c;const b=await toBlob(src,mime,f==='png'?undefined:quality);if(!b||b.type!==mime)throw new Error(f.toUpperCase()+' encoding is not supported by this browser.');return dpi?new Blob([setDpi(await b.arrayBuffer(),mime,dpi)],{type:mime}):b;}
  if(f==='avif'){const native=await toBlob(c,'image/avif',quality);if(native&&native.type==='image/avif')return native;return avifEncode(c,quality);}
  if(f==='gif')return gifEncode(c);if(f==='tiff')return tiffEncode(c);if(f==='bmp')return bmpEncode(c);if(f==='ico')return icoEncode(c);if(f==='tga')return tgaEncode(c);if(f==='pdf')return pdfEncode(c,dpi||150);if(f==='svg')return svgEncode(c);
  throw new Error(f.toUpperCase()+' output needs the Local Engine.');
}
// smallest quality that fits under maxBytes (JPEG/WebP/AVIF); shrinks dimensions as a last resort
async function encodeUnder(c,fmt,maxBytes,opts){let lo=0.3,hi=0.95,best=null;for(let i=0;i<7;i++){const q=(lo+hi)/2;const b=await encode(c,fmt,{...opts,quality:q});if(b.size<=maxBytes){best=b;lo=q;}else hi=q;}
  if(best)return {blob:best,scaled:false};let cur=c;for(let s=0;s<6&&!best;s++){const n=canvasOf(cur.width*0.85,cur.height*0.85);n.getContext('2d').drawImage(cur,0,0,n.width,n.height);cur=n;const b=await encode(cur,fmt,{...opts,quality:0.5});if(b.size<=maxBytes)best=b;}
  if(!best)throw new Error('Could not get under '+fmtSize(maxBytes)+' — choose a larger limit.');return {blob:best,scaled:true,canvas:cur};}
window.OMNI_IMAGES={decode,encode,encodeUnder,setDpi};

/* ================= 1. batch converter ================= */
let batch=[],results=[];const inp=$('imgInput');
if(inp){inp.setAttribute('accept','image/*,.heic,.heif,.tif,.tiff,.svg,.bmp,.ico');}
const pickBatch=list=>{batch=[...list];setTimeout(()=>{const s=$('imgSummary');if(s&&batch.length){$('imgDropzone')&&($('imgDropzone').style.display='none');$('imgControls')&&($('imgControls').style.display='flex');s.textContent=batch.length+' image(s) selected';}},0);};
inp?.addEventListener('change',()=>pickBatch(inp.files||[]));$('imgDropzone')?.addEventListener('drop',e=>{if(e.dataTransfer?.files?.length)pickBatch(e.dataTransfer.files);});
$('imgResetBtn')?.addEventListener('click',()=>{batch=[];results=[];});
// mark AVIF honestly: it now works via a WebAssembly encoder
const avifOpt=$('imgTargetFmt')&&[...$('imgTargetFmt').options].find(o=>o.value==='avif');if(avifOpt)avifOpt.textContent='AVIF (smallest files)';
$('imgRunBtn')?.addEventListener('click',async e=>{
  if(!batch.length)return;e.stopImmediatePropagation();e.preventDefault();const btn=$('imgRunBtn');if(btn.dataset.busy)return;btn.dataset.busy='1';btn.disabled=true;const label=btn.textContent;
  const fmt=$('imgTargetFmt')?.value||'png',q=parseFloat($('imgQualitySelect')?.value)||0.92;const grid=$('imgGrid');results=[];if(grid)grid.innerHTML='';const fails=[];let inBytes=0,outBytes=0;
  try{for(let i=0;i<batch.length;i++){const f=batch[i];btn.textContent='Converting '+(i+1)+'/'+batch.length+'…';
      try{const c=await decode(f);const blob=await encode(c,fmt,{quality:q});const oe=fmt==='jpeg'?'jpg':fmt;let name=base(f.name)+'.'+oe;if(results.some(r=>r.name===name))name=base(f.name)+'_'+ext(f.name)+'.'+oe;let k=2;while(results.some(r=>r.name===name))name=base(f.name)+'_'+(k++)+'.'+oe;results.push({name,blob});inBytes+=f.size;outBytes+=blob.size;
        if(grid){const card=document.createElement('div');card.className='page-card';const pw=document.createElement('div');pw.className='page-preview-wrapper';const im=document.createElement('img');im.alt=name;const prev=canvasOf(Math.min(400,c.width),Math.min(400,c.width)*c.height/c.width);prev.getContext('2d').drawImage(c,0,0,prev.width,prev.height);im.src=prev.toDataURL('image/jpeg',0.8);pw.appendChild(im);
          const pm=document.createElement('div');pm.className='page-meta';const pn=document.createElement('div');pn.className='page-num';pn.style.fontSize='0.8rem';pn.textContent=name+' • '+fmtSize(blob.size);const a=document.createElement('a');a.className='btn-download-single';a.href=URL.createObjectURL(blob);a.download=name;a.textContent='Save';pm.append(pn,a);card.append(pw,pm);grid.appendChild(card);}
      }catch(err){console.warn('Image conversion failed',f.name,err);fails.push(f.name+': '+(err.message||err));}
      await new Promise(r=>setTimeout(r,0));}
    const sec=$('imgResultsSection');if(sec&&results.length){sec.style.display='block';sec.scrollIntoView({behavior:'smooth'});}
    if(fails.length)alert('Converted '+results.length+' of '+batch.length+'. Could not convert:\n\n'+fails.join('\n'));
    if(results.length)notify('Converted '+results.length+' image'+(results.length===1?'':'s')+' to '+fmt.toUpperCase()+' • '+fmtSize(inBytes)+' → '+fmtSize(outBytes));
  }finally{btn.disabled=false;btn.textContent=label;delete btn.dataset.busy;}
},true);
$('imgDownloadAll')?.addEventListener('click',async e=>{if(!results.length)return;e.stopImmediatePropagation();e.preventDefault();if(results.length===1){save(results[0].blob,results[0].name);return;}const z=new JSZip();const used=new Set();results.forEach(r=>{let n=r.name,k=2;while(used.has(n))n=base(r.name)+'_'+(k++)+'.'+ext(r.name);used.add(n);z.file(n,r.blob);});save(await z.generateAsync({type:'blob'}),'converted_images.zip');},true);

/* ================= 2. resize / DPI / photo presets ================= */
let rFile=null;$('imgResizeInput')?.addEventListener('change',()=>{rFile=$('imgResizeInput').files?.[0]||null;});$('imgResizeDropzone')?.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)rFile=f;});$('imgResizeReset')?.addEventListener('click',()=>{rFile=null;});
// optional size limit field (form uploads: e.g. photo ≤ 50 KB, signature ≤ 20 KB)
const dpiBtn=$('imgResizeDpiBtn');let maxKbInput=$('imgResizeMaxKb');
if(dpiBtn&&!maxKbInput){const holder=$('imgResizeOutput')?.closest('.form-group')||$('imgResizeOutput')?.parentElement;if(holder){const g=document.createElement('div');g.className=holder.className||'form-group';g.innerHTML='<label for="imgResizeMaxKb">Max file size (KB, optional)</label><input type="number" id="imgResizeMaxKb" class="form-input" min="5" step="1" placeholder="e.g. 50 for photo, 20 for signature">';holder.insertAdjacentElement('afterend',g);maxKbInput=$('imgResizeMaxKb');}}
async function renderResized(w,h,mode,title,dpi){
  if(!rFile)return;const src=await decode(rFile);w=Math.max(1,Math.min(12000,Math.round(w)));h=Math.max(1,Math.min(12000,Math.round(h)));const c=canvasOf(w,h),g=c.getContext('2d');g.imageSmoothingQuality='high';
  if(mode==='cover'){const k=Math.max(w/src.width,h/src.height);g.drawImage(src,(w-src.width*k)/2,(h-src.height*k)/2,src.width*k,src.height*k);}else if(mode==='contain'){const out=$('imgResizeOutput')?.value;if(out==='jpg'){g.fillStyle='#fff';g.fillRect(0,0,w,h);}const k=Math.min(w/src.width,h/src.height);g.drawImage(src,(w-src.width*k)/2,(h-src.height*k)/2,src.width*k,src.height*k);}else g.drawImage(src,0,0,w,h);
  const fmt=$('imgResizeOutput')?.value||'jpg';const maxKb=parseFloat(maxKbInput?.value||'');let blob,note='';
  if(maxKb>0&&fmt!=='png'){const r=await encodeUnder(c,fmt,maxKb*1024,{dpi});blob=r.blob;if(r.scaled){note=' • dimensions reduced to fit '+maxKb+' KB';w=r.canvas.width;h=r.canvas.height;}}
  else{blob=await encode(c,fmt,{quality:0.94,dpi});if(maxKb>0&&blob.size>maxKb*1024)note=' • PNG cannot be compressed to '+maxKb+' KB; choose JPG';}
  const name=base(rFile.name)+'_'+w+'x'+h+'px'+(dpi?'_'+dpi+'dpi':'')+'.'+fmt;const url=URL.createObjectURL(blob);const grid=$('imgResizeGrid');
  if(grid){grid.innerHTML='';const card=document.createElement('div');card.className='page-card';const pw=document.createElement('div');pw.className='page-preview-wrapper';const im=document.createElement('img');im.src=url;im.alt='Resized preview';pw.appendChild(im);const pm=document.createElement('div');pm.className='page-meta';const left=document.createElement('div');const pn=document.createElement('div');pn.className='page-num';pn.textContent=w+' × '+h+' px';const fm=document.createElement('div');fm.className='file-meta';fm.textContent=title;left.append(pn,fm);const a=document.createElement('a');a.className='btn-download-single';a.href=url;a.download=name;a.textContent='Save';pm.append(left,a);card.append(pw,pm);grid.appendChild(card);}
  const res=$('imgResizeResults');if(res){res.style.display='block';res.scrollIntoView({behavior:'smooth',block:'nearest'});}
  const t=$('imgResizeResultTitle');if(t)t.textContent=title;const m=$('imgResizeResultMeta');if(m)m.textContent=w+' × '+h+' px • '+fmtSize(blob.size)+(dpi?' • '+dpi+' DPI saved in the file':'')+note;
}
const mm2px=(mm,dpi)=>Math.max(1,Math.round(Number(mm)/25.4*Number(dpi)));
const presets={
  imgResizePixelsBtn:()=>[Number($('imgResizeWidth').value),Number($('imgResizeHeight').value),$('imgResizeLock').value,'Custom pixel dimensions',Number($('imgResizeDpi')?.value)||0],
  imgResizeDpiBtn:()=>{const dpi=Number($('imgResizeDpi').value)||300,w=mm2px($('imgResizeWidthMm').value,dpi),h=mm2px($('imgResizeHeightMm').value,dpi);$('imgResizeWidth').value=w;$('imgResizeHeight').value=h;return [w,h,$('imgResizeLock').value==='stretch'?'stretch':'cover',$('imgResizeWidthMm').value+' × '+$('imgResizeHeightMm').value+' mm @ '+dpi+' DPI → '+w+' × '+h+' px',dpi];},
  imgPassportBtn:()=>{$('imgResizeDpi').value='300';$('imgResizeWidthMm').value='35';$('imgResizeHeightMm').value='45';$('imgResizeWidth').value=413;$('imgResizeHeight').value=531;return [413,531,'cover','Indian passport/visa photo • 35 × 45 mm @ 300 DPI',300];},
  imgId2x2Btn:()=>{$('imgResizeDpi').value='300';$('imgResizeWidthMm').value='50.8';$('imgResizeHeightMm').value='50.8';$('imgResizeWidth').value=600;$('imgResizeHeight').value=600;return [600,600,'cover','2 × 2 inch ID photo @ 300 DPI',300];},
  imgSignatureBtn:()=>{$('imgResizeDpi').value='300';$('imgResizeWidthMm').value='35';$('imgResizeHeightMm').value='15';$('imgResizeWidth').value=413;$('imgResizeHeight').value=177;return [413,177,'contain','Signature • 35 × 15 mm @ 300 DPI',300];},
};
for(const [id,args] of Object.entries(presets))$(id)?.addEventListener('click',async e=>{if(!rFile)return;e.stopImmediatePropagation();e.preventDefault();const b=$(id);if(b.dataset.busy)return;b.dataset.busy='1';b.disabled=true;try{await renderResized(...args());}catch(err){alert('Resize: '+(err.message||err));}finally{b.disabled=false;delete b.dataset.busy;}},true);

/* ================= 2b. images to PDF: any format, EXIF rotation, real page sizes ================= */
const i2pIn=$('i2pInput');let i2pList=[];
if(i2pIn){i2pIn.setAttribute('accept','image/*,.heic,.heif,.tif,.tiff,.svg,.bmp,.avif');
  const acts=$('i2pBtn')?.parentElement;if(acts&&!$('i2pPageSize')){const w=document.createElement('div');w.className='form-row';w.style.cssText='display:flex;gap:12px;flex-wrap:wrap;width:100%;margin-bottom:10px';
    w.innerHTML='<div class="form-group" style="flex:1;min-width:160px"><label for="i2pPageSize">Page size</label><select id="i2pPageSize" class="form-select"><option value="a4">A4 (fit image on page)</option><option value="letter">US Letter (fit image on page)</option><option value="fit">Same as each image</option></select></div><div class="form-group" style="flex:1;min-width:160px"><label for="i2pMargin">Margin</label><select id="i2pMargin" class="form-select"><option value="0">None</option><option value="18" selected>Small (6 mm)</option><option value="36">Normal (12 mm)</option></select></div>';
    acts.parentElement.insertBefore(w,acts);}}
const pickI2p=list=>{i2pList=[...list].filter(f=>/^image\//.test(f.type)||BROWSER_IN(f));setTimeout(()=>{const s=$('i2pSummary');if(s&&i2pList.length){s.textContent=i2pList.length+' image'+(i2pList.length===1?'':'s')+' selected';$('i2pDropzone').style.display='none';$('i2pControls').style.display='flex';}},0);};
i2pIn?.addEventListener('change',()=>pickI2p(i2pIn.files||[]));$('i2pDropzone')?.addEventListener('drop',e=>{if(e.dataTransfer?.files?.length)pickI2p(e.dataTransfer.files);});$('i2pReset')?.addEventListener('click',()=>{i2pList=[];});
function jpegOrientation(u8){if(u8[0]!==0xFF||u8[1]!==0xD8)return 0;let i=2;while(i+4<u8.length){if(u8[i]!==0xFF)return 0;const m=u8[i+1],len=(u8[i+2]<<8)|u8[i+3];if(m===0xE1&&u8[i+4]===0x45&&u8[i+5]===0x78){const t=i+10,le=u8[t]===0x49;const r16=o=>le?u8[o]|(u8[o+1]<<8):(u8[o]<<8)|u8[o+1];const r32=o=>le?(u8[o]|(u8[o+1]<<8)|(u8[o+2]<<16)|(u8[o+3]<<24))>>>0:((u8[o]<<24)|(u8[o+1]<<16)|(u8[o+2]<<8)|u8[o+3])>>>0;const ifd=t+r32(t+4),n=r16(ifd);for(let k=0;k<n;k++){const e=ifd+2+k*12;if(r16(e)===0x0112)return r16(e+8);}return 1;}if(m===0xDA)return 0;i+=2+len;}return 0;}
function hasAlpha(c){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<d.length;i+=16)if(d[i]<250)return true;return false;}
$('i2pBtn')?.addEventListener('click',async e=>{
  if(!i2pList.length||!window.PDFLib)return;e.stopImmediatePropagation();e.preventDefault();const btn=$('i2pBtn');if(btn.dataset.busy)return;btn.dataset.busy='1';btn.disabled=true;const label=btn.textContent;
  const size=$('i2pPageSize')?.value||'a4',margin=+($('i2pMargin')?.value||18);const PAGE={a4:[595.28,841.89],letter:[612,792]};const fails=[];
  try{const doc=await PDFLib.PDFDocument.create();
    for(let i=0;i<i2pList.length;i++){const f=i2pList[i];btn.textContent='Adding '+(i+1)+'/'+i2pList.length+'…';
      try{const u8=new Uint8Array(await f.arrayBuffer());const isJ=u8[0]===0xFF&&u8[1]===0xD8,isP=u8[0]===0x89&&u8[1]===0x50;let emb;
        if(isJ&&jpegOrientation(u8)<=1)emb=await doc.embedJpg(u8);else if(isP)emb=await doc.embedPng(u8);
        else{const c=await decode(f);const alpha=hasAlpha(c);const b=alpha?await encode(c,'png'):await encode(c,'jpg',{quality:0.92});const bytes=new Uint8Array(await b.arrayBuffer());emb=alpha?await doc.embedPng(bytes):await doc.embedJpg(bytes);}
        const iw=emb.width,ih=emb.height;let pw,ph;
        if(size==='fit'){const k=Math.min(0.75,1190/Math.max(iw,ih));pw=iw*k+margin*2;ph=ih*k+margin*2;}else{[pw,ph]=PAGE[size];if(iw>ih)[pw,ph]=[ph,pw];}
        const aw=pw-margin*2,ah=ph-margin*2,sc=Math.min(aw/iw,ah/ih);const dw=iw*sc,dh=ih*sc;
        const pg=doc.addPage([pw,ph]);pg.drawImage(emb,{x:(pw-dw)/2,y:(ph-dh)/2,width:dw,height:dh});
      }catch(err){console.warn('Images to PDF',f.name,err);fails.push(f.name+': '+(err.message||err));}
      await new Promise(r=>setTimeout(r,0));}
    if(!doc.getPageCount())throw new Error(fails.join('\n')||'No images could be added.');
    doc.setTitle(i2pList.length===1?base(i2pList[0].name):'Combined images');doc.setCreator('Omni Suite');
    const out=new Blob([await doc.save()],{type:'application/pdf'});save(out,(i2pList.length===1?base(i2pList[0].name):'images_combined')+'.pdf');
    notify('PDF created • '+doc.getPageCount()+' page'+(doc.getPageCount()===1?'':'s')+' • '+fmtSize(out.size));
    if(fails.length)alert('Added '+doc.getPageCount()+' of '+i2pList.length+' images. Skipped:\n\n'+fails.join('\n'));
  }catch(err){alert('Images to PDF error: '+(err.message||err));}
  finally{btn.disabled=false;btn.textContent=label;delete btn.dataset.busy;}
},true);

/* ================= 3. native converter (browser where possible) ================= */
let nFile=null;$('imageNativeInput')?.addEventListener('change',()=>{nFile=$('imageNativeInput').files?.[0]||null;});$('imageNativeDropzone')?.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)nFile=f;});$('imageNativeReset')?.addEventListener('click',()=>{nFile=null;});
const BROWSER_IN=f=>isHeic(f)||isTiff(f)||isSvg(f)||/^(png|jpe?g|webp|gif|bmp|ico|avif|apng|jfif)$/.test(ext(f.name));
$('imageNativeRun')?.addEventListener('click',async e=>{
  const t=$('imageNativeTarget')?.value;if(!nFile||!ENCODERS.has(t)||!BROWSER_IN(nFile))return;// HEIC/JXL/JP2/DDS/EXR/HDR output or exotic inputs → Local Engine
  e.stopImmediatePropagation();e.preventDefault();const b=$('imageNativeRun');if(b.dataset.busy)return;b.dataset.busy='1';b.disabled=true;const label=b.textContent;b.textContent='Converting…';
  try{const c=await decode(nFile);const blob=await encode(c,t,{quality:0.9});save(blob,base(nFile.name)+'.'+(t==='jpeg'?'jpg':t));notify('Converted to '+t.toUpperCase()+' in your browser • '+fmtSize(blob.size)+(t==='svg'?' (image embedded in an SVG wrapper — not traced vectors)':t==='ico'?' (multi-size icon)':''));}
  catch(err){alert('Image Tools: '+(err.message||err));}finally{b.disabled=false;b.textContent=label;delete b.dataset.busy;}
},true);
})();
