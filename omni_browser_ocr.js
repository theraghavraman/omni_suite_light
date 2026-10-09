/* Omni Suite — Image to Text upgrades.
 * Multiple images and scanned PDFs, automatic image clean-up for better accuracy, one reused
 * Tesseract worker, a searchable-PDF download (invisible text layer), and a transliteration
 * fallback that works without the language model.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'ocr').replace(/\.[^.]+$/,'')||'ocr';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const notify=(m,e)=>{if(window.omniNotify)window.omniNotify(m,e);};
const input=$('ocrInput');if(!input)return;

// accept several images or scanned PDFs
input.setAttribute('accept','image/*,application/pdf,.pdf');input.multiple=true;
const dz=$('ocrDropzone');const h=dz?.querySelector('h3,h4,strong,.dropzone-title');if(h&&/image|photo/i.test(h.textContent))h.textContent='Upload images or a scanned PDF to extract text';

let files=[];let searchablePdf=null;
const fmtSize=b=>b>1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB';
function setFiles(list){files=[...list].filter(f=>/^image\//.test(f.type)||ext(f.name)==='pdf'||/\.(png|jpe?g|webp|bmp|gif|tiff?|avif|heic)$/i.test(f.name));if(!files.length)return;
  setTimeout(()=>{const n=$('ocrFileName'),m=$('ocrFileMeta');if(n)n.textContent=files.length===1?files[0].name:files.length+' files: '+files.map(f=>f.name).join(', ').slice(0,90);if(m)m.textContent=fmtSize(files.reduce((a,f)=>a+f.size,0))+(files.some(f=>ext(f.name)==='pdf')?' • PDF pages are OCR\'d one by one':'');},0);
  searchablePdf=null;const sb=$('ocrSearchablePdfBtn');if(sb)sb.disabled=true;}
input.addEventListener('change',()=>setFiles(input.files||[]));
dz?.addEventListener('drop',e=>{if(e.dataTransfer?.files?.length)setFiles(e.dataTransfer.files);});
$('ocrResetBtn')?.addEventListener('click',()=>{files=[];searchablePdf=null;});

// searchable PDF button next to "Download .txt"
const txtBtn=$('ocrDownloadTxtBtn');
if(txtBtn&&!$('ocrSearchablePdfBtn')){const b=document.createElement('button');b.type='button';b.id='ocrSearchablePdfBtn';b.className=txtBtn.className;b.textContent='📄 Searchable PDF';b.title='PDF of your pages with an invisible, selectable text layer';b.disabled=true;txtBtn.insertAdjacentElement('afterend',b);
  b.addEventListener('click',()=>{if(searchablePdf)save(searchablePdf,(files.length===1?base(files[0].name):'ocr')+'_searchable.pdf');});}

// image clean-up: honour EXIF orientation, upscale small scans, grey + contrast stretch
async function prepare(source){
  const bmp=source instanceof HTMLCanvasElement?source:await createImageBitmap(source,{imageOrientation:'from-image'});
  const w=bmp.width,h=bmp.height,longest=Math.max(w,h);const scale=longest<1600?Math.min(3,1600/longest):longest>5000?5000/longest:1;
  const c=document.createElement('canvas');c.width=Math.round(w*scale);c.height=Math.round(h*scale);const g=c.getContext('2d',{willReadFrequently:true});g.imageSmoothingQuality='high';g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(bmp,0,0,c.width,c.height);
  const d=g.getImageData(0,0,c.width,c.height),p=d.data;let lo=255,hi=0;const hist=new Uint32Array(256);
  for(let i=0;i<p.length;i+=4){const y=(p[i]*299+p[i+1]*587+p[i+2]*114)/1000|0;p[i]=y;hist[y]++;}
  const total=c.width*c.height;let acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>total*0.01){lo=v;break;}}acc=0;for(let v=255;v>=0;v--){acc+=hist[v];if(acc>total*0.01){hi=v;break;}}
  const span=Math.max(1,hi-lo);for(let i=0;i<p.length;i+=4){const v=Math.max(0,Math.min(255,(p[i]-lo)*255/span));p[i]=p[i+1]=p[i+2]=v;}
  g.putImageData(d,0,0);return c;
}
async function pdfPages(file){const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;const out=[];for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const vp=pg.getViewport({scale:2.5});const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:g,viewport:vp}).promise;out.push({canvas:c,label:file.name+' — page '+i});if(pg.cleanup)pg.cleanup();}return out;}

const run=$('ocrRunBtn');
run?.addEventListener('click',async e=>{
  if(!files.length)return; // nothing chosen through this module: let the original handler decide
  e.stopImmediatePropagation();e.preventDefault();if(run.dataset.busy)return;run.dataset.busy='1';run.disabled=true;
  const wrap=$('ocrProgressWrapper'),bar=$('ocrProgressBar'),txt=$('ocrProgressText'),pct=$('ocrProgressPercent'),outBox=$('ocrOutputContainer'),out=$('ocrOutputText');
  const prog=(p,t)=>{if(wrap)wrap.style.display='block';if(bar)bar.style.width=Math.round(p)+'%';if(pct)pct.textContent=Math.round(p)+'%';if(t&&txt)txt.textContent=t;};
  const lang=$('ocrLanguage')?.value||'eng';let worker=null;
  try{
    prog(2,'Preparing pages…');const pages=[];
    for(const f of files){if(ext(f.name)==='pdf'){(await pdfPages(f)).forEach(p=>pages.push(p));}else pages.push({file:f,label:f.name});}
    if(!pages.length)throw new Error('No images or PDF pages to read.');
    let current=0;
    worker=await Tesseract.createWorker(lang,1,Object.assign({},window.OMNI_TESSERACT_OPTIONS||{},{logger:m=>{if(m.status==='recognizing text'&&typeof m.progress==='number')prog(8+92*(current+m.progress)/pages.length,'Page '+(current+1)+' of '+pages.length+' • recognizing text');else if(m.status&&current===0&&typeof m.progress==='number')prog(2+6*m.progress,m.status);}}));
    const texts=[],pdfParts=[];let conf=0;
    for(current=0;current<pages.length;current++){
      const pg=pages[current],source=pg.canvas||pg.file;
      // First pass: let Tesseract read the original image without preprocessing.
      let r=await worker.recognize(source,{},{text:true,pdf:true});
      const rawText=(r.data.text||'').trim(),rawConfidence=Number(r.data.confidence)||0;
      // Only retry with image clean-up when the raw pass is weak or returns no text.
      if(rawConfidence<75||!rawText){
        prog(8+92*current/pages.length,'Low-confidence result — retrying page '+(current+1)+' with image clean-up');
        const cleaned=await prepare(source);
        const retry=await worker.recognize(cleaned,{},{text:true,pdf:true});
        const retryText=(retry.data.text||'').trim(),retryConfidence=Number(retry.data.confidence)||0;
        if(retryConfidence>rawConfidence||(!rawText&&retryText))r=retry;
      }
      const finalText=(r.data.text||'').trim();
      texts.push(pages.length>1?'— '+pg.label+' —\n'+finalText:finalText);
      conf+=Number(r.data.confidence)||0;
      if(r.data.pdf)pdfParts.push(new Uint8Array(r.data.pdf));
    }
    await worker.terminate();worker=null;
    // merge per-page searchable PDFs
    searchablePdf=null;if(pdfParts.length&&window.PDFLib){const doc=await PDFLib.PDFDocument.create();for(const part of pdfParts){const src=await PDFLib.PDFDocument.load(part);(await doc.copyPages(src,src.getPageIndices())).forEach(p=>doc.addPage(p));}searchablePdf=new Blob([await doc.save()],{type:'application/pdf'});}
    const sb=$('ocrSearchablePdfBtn');if(sb)sb.disabled=!searchablePdf;
    if(wrap)wrap.style.display='none';if(outBox)outBox.style.display='block';
    const text=texts.join('\n\n').trim();if(out)out.value=text||'No text recognized.';
    const tp=$('ocrTranslatePanel');if(tp&&text){tp.style.display='block';const map={eng:'en',hin:'hi',ben:'bn',mar:'mr',tam:'ta',tel:'te',mal:'ml',kan:'kn',guj:'gu',pan:'pa',ori:'or',sin:'si',nep:'ne',urd:'ur'};const src=$('ocrTranslateSource');const code=lang.split('+').find(l=>l!=='eng')||lang;if(map[code]&&src)src.value=map[code];}
    notify('Text read from '+pages.length+' page'+(pages.length===1?'':'s')+' • average confidence '+Math.round(conf/pages.length)+'%');
  }catch(err){console.error(err);if(wrap)wrap.style.display='none';alert('OCR error: '+(err.message||err));}
  finally{if(worker)try{await worker.terminate();}catch(_){}run.disabled=false;delete run.dataset.busy;}
},true);

// transliteration that works without the language model
const tl=$('ocrTranslitBtn');
tl?.addEventListener('click',async e=>{
  const text=$('ocrOutputText')?.value?.trim();if(!text)return;
  e.stopImmediatePropagation();e.preventDefault();
  const target=$('ocrTranslitTarget')?.value||'Latn',st=$('ocrTranslitStatus'),out=$('ocrTranslitOutput'),acts=$('ocrTranslitActions');
  tl.disabled=true;if(st)st.textContent='Transliterating…';
  try{let r=null;try{if(window.OmniLanguageEngine?.transliterate)r=await window.OmniLanguageEngine.transliterate(text,$('ocrTranslateSource')?.value||'hi',target,{topk:4});}catch(_){r=null;}
    let model=r?.model||'Omni Language Engine';let result=r?.text;
    if(!result){if(!window.OMNI_BROWSER_PLUS?.transliterate)throw new Error('No transliterator available.');result=window.OMNI_BROWSER_PLUS.transliterate(text,target);model='Built-in rule-based transliterator (browser)';}
    if(out){out.value=result;out.style.display='block';}if(acts)acts.style.display='flex';if(st)st.textContent='Transliterated by '+model+'.';
  }catch(err){if(st)st.textContent='Transliteration unavailable: '+(err.message||err);}
  finally{tl.disabled=false;}
},true);
})();
