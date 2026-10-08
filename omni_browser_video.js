/* Omni Suite — Video Studio upgrades (runs entirely in the browser).
 * Uses Mediabunny (WebCodecs) to cut without re-encoding, convert MP4/WebM/MOV/MKV, resize, compress,
 * rotate, change speed (audio keeps its pitch), extract audio (M4A/MP3/WAV), grab exact frames, export
 * frame sequences and make GIFs — much faster than real-time recording. The format bridge converts
 * in the browser when it can and hands the rest to the Local Engine.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'video').replace(/\.[^.]+$/,'')||'video';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const notify=(m,e)=>{if(window.omniNotify)window.omniNotify(m,e);};
const fmtSize=b=>b>=1048576?(b/1048576).toFixed(2)+' MB':Math.max(1,Math.round(b/1024))+' KB';
const fmtTime=s=>{s=Math.max(0,s||0);const m=Math.floor(s/60),r=s-m*60;return m+':'+(r<10?'0':'')+r.toFixed(1);};
const CDN='https://cdn.jsdelivr.net/npm/';
let mbP=null;const mb=()=>mbP||(mbP=import(CDN+'mediabunny@1.58.1/dist/bundles/mediabunny.min.mjs').catch(e=>{mbP=null;throw new Error('Could not load the video engine (Mediabunny) — check your internet connection.');}));
let gifP=null;const gifenc=()=>gifP||(gifP=import(CDN+'gifenc@1.0.3/dist/gifenc.esm.js'));
let zipP=null;const jszip=async()=>{if(window.JSZip)return window.JSZip;if(!zipP)zipP=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';s.onload=()=>res(window.JSZip);s.onerror=rej;document.head.appendChild(s);});return zipP;};
const hasWebCodecs=()=>!!(window.VideoDecoder&&window.VideoEncoder&&window.AudioDecoder);

/* ---------------- engine helpers ---------------- */
async function openInput(file){const M=await mb();const input=new M.Input({source:new M.BlobSource(file),formats:M.ALL_FORMATS});return {M,input};}
function outputFormat(M,kind){switch(kind){case'webm':return new M.WebMOutputFormat();case'mkv':return new M.MkvOutputFormat();case'mov':return new M.MovOutputFormat({fastStart:'in-memory'});case'ts':return new M.MpegTsOutputFormat();case'm4a':return new M.Mp4OutputFormat({fastStart:'in-memory'});default:return new M.Mp4OutputFormat({fastStart:'in-memory'});}}
const MIME={mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',ts:'video/mp2t',m4a:'audio/mp4'};
const QUALITY=(M,q)=>({high:M.QUALITY_HIGH,medium:M.QUALITY_MEDIUM,low:M.QUALITY_LOW,verylow:M.QUALITY_VERY_LOW})[q];
async function readAudioRange(M,track,start,end){
  const sink=new M.AudioBufferSink(track);const parts=[];let sr=0,ch=0,len=0;
  for await(const w of sink.buffers(start,end)){const b=w.buffer;sr=b.sampleRate;ch=Math.max(ch,b.numberOfChannels);
    const s0=Math.max(0,Math.round((start-w.timestamp)*sr)),s1=Math.min(b.length,Math.round((end-w.timestamp)*sr));if(s1<=s0)continue;parts.push({b,s0,s1});len+=s1-s0;}
  if(!len)return null;const out=new AudioBuffer({numberOfChannels:ch,length:len,sampleRate:sr});let off=0;
  for(const {b,s0,s1} of parts){for(let c=0;c<ch;c++){const src=b.getChannelData(Math.min(c,b.numberOfChannels-1)).subarray(s0,s1);out.copyToChannel(src,c,off);}off+=s1-s0;}return out;}

/* full conversion: trim / container / resize / quality / rotate / speed / mute */
async function convertVideo(file,o,onProg){
  const {M,input}=await openInput(file);const kind=o.format||'mp4';
  const vtrack=await input.getPrimaryVideoTrack();const atrack=await input.getPrimaryAudioTrack();
  if(!vtrack&&!atrack)throw new Error('No video or audio track found in this file.');
  const duration=await input.computeDuration();const start=Math.max(0,o.start||0),end=Math.min(duration,o.end>0?o.end:duration);
  if(!(end>start))throw new Error('End time must be greater than start time.');
  const speed=o.speed||1,changeSpeed=Math.abs(speed-1)>1e-3;
  const output=new M.Output({format:outputFormat(M,kind),target:new M.BufferTarget()});
  const video={};if(o.height&&vtrack&&o.height<vtrack.displayHeight)video.height=o.height;if(o.rotate)video.rotate=o.rotate;
  const willTranscode=(o.quality&&o.quality!=='keep')||o.precise||changeSpeed||video.height;
  if(willTranscode&&vtrack){// aim below the source bitrate so "smaller" really is smaller
    let srcKbps=0;try{const st=await vtrack.computePacketStats(300);srcKbps=st.averageBitrate/1000;}catch(_){}if(!srcKbps)srcKbps=file.size*8/1000/Math.max(1,duration)*0.9;
    const scale=video.height?Math.pow(video.height/vtrack.displayHeight,2):1;const f={high:0.85,medium:0.5,low:0.3,verylow:0.18}[o.quality]||1;
    video.bitrate=Math.max(150000,Math.round(srcKbps*1000*f*scale));}
  if(o.precise||changeSpeed)video.forceTranscode=true;
  if(changeSpeed){let lastSlot=-1;const cap=30;video.process=s=>{const t=s.timestamp/speed;if(speed>1){const slot=Math.round(t*cap);if(slot===lastSlot){s.close();return null;}lastSlot=slot;s.setTimestamp(slot/cap);s.setDuration(1/cap);return s;}s.setTimestamp(t);s.setDuration(s.duration/speed);return s;};}
  const opts={input,output,trim:{start,end},video,showWarnings:false};
  if(o.precise||changeSpeed)opts.copy=false;
  let audioBuf=null;
  if(o.mute||!atrack)opts.audio={discard:true};
  else if(changeSpeed){opts.audio={discard:true};opts.composable=true;
    const raw=await readAudioRange(M,atrack,start,end);if(raw&&window.OMNI_AUDIO)audioBuf=await window.OMNI_AUDIO.processAudio(raw,{speed,keepPitch:o.keepPitch!==false});}
  else if(o.quality&&o.quality!=='keep')opts.audio={quality:QUALITY(M,o.quality==='high'?'high':'medium')};
  const conv=await M.Conversion.init(opts);
  if(!conv.isValid&&!opts.composable){const why=conv.discardedTracks.map(d=>d.track.type+': '+d.reason).join(', ');throw new Error('This browser cannot convert this file to '+kind.toUpperCase()+(why?' ('+why+')':'')+'.');}
  conv.onProgress=p=>onProg&&onProg(p);
  if(opts.composable){let asrc=null;
    if(audioBuf){const codecs=output.format.getSupportedAudioCodecs();const ac=await M.getFirstEncodableAudioCodec(codecs.filter(c=>['aac','opus'].includes(c)).sort((a,b)=>(kind==='webm'?(a==='opus'?-1:1):(a==='aac'?-1:1))),{numberOfChannels:audioBuf.numberOfChannels,sampleRate:audioBuf.sampleRate});
      if(ac){asrc=new M.AudioBufferSource({codec:ac,quality:M.QUALITY_HIGH});output.addAudioTrack(asrc);}}
    await output.start();await Promise.all([conv.execute(),(async()=>{if(asrc){await asrc.add(audioBuf);asrc.close();}})()]);await output.finalize();}
  else await conv.execute();
  const buf=output.target.buffer;if(!buf||!buf.byteLength)throw new Error('The conversion produced an empty file.');
  return {blob:new Blob([buf],{type:MIME[kind]||'video/mp4'}),duration:(end-start)/speed,copied:!video.forceTranscode&&!video.bitrate&&!video.height&&!o.rotate&&!o.precise};
}
async function extractAudio(file,o,onProg){
  const {M,input}=await openInput(file);const atrack=await input.getPrimaryAudioTrack();if(!atrack)throw new Error('This video has no audio track.');
  const duration=await input.computeDuration();const start=Math.max(0,o.start||0),end=Math.min(duration,o.end>0?o.end:duration);
  if(o.format==='m4a'){const output=new M.Output({format:outputFormat(M,'m4a'),target:new M.BufferTarget()});const src=await atrack.getCodec();
    const audio=src==='aac'?{}:{codec:'aac',quality:M.QUALITY_HIGH};const conv=await M.Conversion.init({input,output,trim:{start,end},video:{discard:true},audio,showWarnings:false});
    if(!conv.isValid)throw new Error('AAC encoding is not available in this browser — choose MP3 or WAV.');conv.onProgress=p=>onProg&&onProg(p);await conv.execute();return new Blob([output.target.buffer],{type:'audio/mp4'});}
  const raw=await readAudioRange(M,atrack,start,end);if(!raw)throw new Error('No audio in the selected range.');
  if(!window.OMNI_AUDIO)throw new Error('Audio encoder not loaded.');return window.OMNI_AUDIO.encodeAudio(raw,o.format==='mp3'?'mp3':'wav',{kbps:192,onProgress:onProg});
}
function toCanvas(src){const c=document.createElement('canvas');c.width=src.width;c.height=src.height;c.getContext('2d').drawImage(src,0,0);return c;}
const canvasBlob=(c,type,q)=>new Promise(r=>c.toBlob(r,type,q));
async function frameAt(file,t,width){const {M,input}=await openInput(file);const v=await input.getPrimaryVideoTrack();if(!v)throw new Error('No video track.');const sink=new M.CanvasSink(v,width?{width,fit:'contain'}:{});const w=await sink.getCanvas(Math.max(0,t))||await sink.getCanvas(await v.getFirstTimestamp());if(!w)throw new Error('Could not decode a frame at '+fmtTime(t)+'.');return toCanvas(w.canvas);}
async function framesZip(file,o,onProg){const {M,input}=await openInput(file);const v=await input.getPrimaryVideoTrack();if(!v)throw new Error('No video track.');const dur=await input.computeDuration();
  const start=Math.max(0,o.start||0),end=Math.min(dur,o.end>0?o.end:dur),step=Math.max(0.04,o.interval||1);const ts=[];for(let t=start;t<end-1e-6&&ts.length<600;t+=step)ts.push(+t.toFixed(3));
  const sink=new M.CanvasSink(v,o.width?{width:o.width,fit:'contain'}:{});const Z=await jszip();const z=new Z();let i=0;const type=o.format==='png'?'image/png':'image/jpeg';
  for await(const w of sink.canvasesAtTimestamps(ts)){if(w){const b=await canvasBlob(toCanvas(w.canvas),type,0.92);z.file(base(file.name)+'_'+String(i+1).padStart(4,'0')+'_'+ts[i].toFixed(2).replace('.','s')+'.'+(o.format==='png'?'png':'jpg'),b);}i++;onProg&&onProg(i/ts.length);}
  return {blob:await z.generateAsync({type:'blob'}),count:i};}
async function makeGif(file,o,onProg){const {M,input}=await openInput(file);const v=await input.getPrimaryVideoTrack();if(!v)throw new Error('No video track.');const dur=await input.computeDuration();
  const start=Math.max(0,o.start||0);let end=Math.min(dur,o.end>0?o.end:dur);if(end-start>30)end=start+30;const fps=o.fps||10,ts=[];for(let t=start;t<end-1e-6;t+=1/fps)ts.push(t);
  const {GIFEncoder,quantize,applyPalette}=await gifenc();const sink=new M.CanvasSink(v,{width:o.width||480,fit:'contain'});const g=GIFEncoder();let i=0,pal=null;
  for await(const w of sink.canvasesAtTimestamps(ts)){if(w){const c=toCanvas(w.canvas);const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;if(!pal||i%10===0)pal=quantize(d,256);g.writeFrame(applyPalette(d,pal),c.width,c.height,{palette:pal,delay:Math.round(1000/fps)});}i++;onProg&&onProg(i/ts.length);if(i%5===0)await new Promise(r=>setTimeout(r,0));}
  g.finish();return {blob:new Blob([g.bytes()],{type:'image/gif'}),frames:i,clipped:(o.end>0?Math.min(dur,o.end):dur)-start>30};}
window.OMNI_VIDEO={convertVideo,extractAudio,frameAt,framesZip,makeGif};

/* ================= main studio card ================= */
const input=$('videoInput');if(!input)return;
input.setAttribute('accept','video/*,.mp4,.m4v,.mov,.webm,.mkv,.ts,.m2ts,.mts,.3gp');
let file=null,duration=0;
const player=$('videoPlayer'),startEl=$('videoStartSec'),endEl=$('videoEndSec'),speedEl=$('videoSpeedSelect'),actionEl=$('videoActionSelect'),runBtn=$('videoProcessBtn');
const wrap=$('videoProgressWrapper'),bar=$('videoProgressBar'),ptxt=$('videoProgressText'),ppct=$('videoProgressPercent');
const prog=(p,t)=>{if(wrap)wrap.style.display='block';const v=Math.round(Math.max(0,Math.min(1,p))*100);if(bar)bar.style.width=v+'%';if(ppct)ppct.textContent=v+'%';if(t&&ptxt)ptxt.textContent=t;};
const hideProg=()=>{if(wrap)wrap.style.display='none';};
const sub=document.querySelector('#tabVideo .card .sub');if(sub)sub.textContent='Cut without re-encoding, convert to MP4/WebM/MOV/MKV, shrink, rotate, change speed, pull out the audio, save exact frames or make a GIF — all in your browser, faster than real time.';
const dzP=$('videoDropzone')?.querySelector('p');if(dzP)dzP.textContent='MP4, MOV, M4V, WebM, MKV and MPEG-TS work in your browser • AVI, FLV, WMV and others use the Local Engine bridge below';
if(actionEl){const o=[...actionEl.options];const set=(v,t)=>{const x=o.find(z=>z.value===v);if(x)x.textContent=t;};set('trim_video','✂️ Cut / convert / compress video');set('extract_audio','🎵 Extract audio');set('snapshot','📸 Save the frame at the playhead');
  if(!o.some(z=>z.value==='frames'))actionEl.add(new Option('🖼️ Export frames as images (ZIP)','frames'));if(!o.some(z=>z.value==='gif'))actionEl.add(new Option('🎞️ Make a GIF from the selection','gif'));}
if(speedEl&&![...speedEl.options].some(o=>o.value==='4.0')){[['0.25','0.25x'],['3.0','3x'],['4.0','4x (time-lapse)']].forEach(([v,t])=>speedEl.add(new Option(t,v)));[...speedEl.options].sort((a,b)=>+a.value-+b.value).forEach(x=>speedEl.appendChild(x));speedEl.value='1.0';}
const grid=actionEl?.closest('.options-grid');
if(grid&&!$('videoOutFormat')){
  const tools=document.createElement('div');tools.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-top:8px';tools.innerHTML='<button type="button" class="btn-reset" id="videoSetStart">Start = playhead</button><button type="button" class="btn-reset" id="videoSetEnd">End = playhead</button><button type="button" class="btn-reset" id="videoSelAll">Whole video</button><span id="videoSelInfo" style="font-size:12px;color:var(--text-muted);align-self:center"></span>';
  startEl.closest('.form-group').appendChild(tools);
  const more=document.createElement('div');more.className='options-grid';more.style.marginTop='10px';more.id='videoMoreOptions';
  more.innerHTML=`<div class="form-group" data-for="trim_video"><label for="videoOutFormat">Save as</label><select id="videoOutFormat" class="form-select"><option value="mp4">MP4 (plays everywhere)</option><option value="webm">WebM</option><option value="mov">MOV</option><option value="mkv">MKV</option></select></div>
  <div class="form-group" data-for="trim_video"><label for="videoQuality">Quality / size</label><select id="videoQuality" class="form-select"><option value="keep">Keep original (fastest, no quality loss)</option><option value="high">High</option><option value="medium">Medium — smaller file</option><option value="low">Low — smallest file</option></select></div>
  <div class="form-group" data-for="trim_video gif frames"><label for="videoResolution">Resolution</label><select id="videoResolution" class="form-select"><option value="0">Original</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option><option value="360">360p</option></select></div>
  <div class="form-group" data-for="trim_video"><label for="videoRotate">Rotate</label><select id="videoRotate" class="form-select"><option value="0">No rotation</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° anticlockwise</option></select></div>
  <div class="form-group" data-for="trim_video"><label>Options</label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="videoMute"> Remove audio</label><label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:4px"><input type="checkbox" id="videoPrecise"> Frame-accurate cut (re-encodes)</label><label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:4px"><input type="checkbox" id="videoKeepPitch" checked> Keep voice pitch when changing speed</label></div>
  <div class="form-group" data-for="extract_audio"><label for="videoAudioFormat">Audio format</label><select id="videoAudioFormat" class="form-select"><option value="m4a">M4A (AAC — no quality loss when the video has AAC audio)</option><option value="mp3">MP3</option><option value="wav">WAV (lossless)</option></select></div>
  <div class="form-group" data-for="snapshot frames"><label for="videoImageFormat">Image format</label><select id="videoImageFormat" class="form-select"><option value="png">PNG (lossless)</option><option value="jpg">JPG (smaller)</option></select></div>
  <div class="form-group" data-for="frames"><label for="videoFrameInterval">One frame every</label><select id="videoFrameInterval" class="form-select"><option value="0.5">0.5 s</option><option value="1" selected>1 s</option><option value="2">2 s</option><option value="5">5 s</option><option value="10">10 s</option></select></div>
  <div class="form-group" data-for="gif"><label for="videoGifWidth">GIF width</label><select id="videoGifWidth" class="form-select"><option value="320">320 px</option><option value="480" selected>480 px</option><option value="640">640 px</option></select></div>
  <div class="form-group" data-for="gif"><label for="videoGifFps">GIF frame rate</label><select id="videoGifFps" class="form-select"><option value="8">8 fps (smaller)</option><option value="12" selected>12 fps</option><option value="15">15 fps (smoother)</option></select></div>`;
  grid.insertAdjacentElement('afterend',more);
  const sync=()=>{const a=actionEl.value;more.querySelectorAll('[data-for]').forEach(el=>{el.style.display=el.dataset.for.split(' ').includes(a)?'':'none';});const sp=speedEl?.closest('.form-group');if(sp)sp.style.display=a==='trim_video'?'':'none';
    if(runBtn)runBtn.textContent={trim_video:'Process Video',extract_audio:'Extract Audio',snapshot:'Save Frame',frames:'Export Frames',gif:'Make GIF'}[a]||'Process Video';};
  actionEl.addEventListener('change',sync);sync();
}
const selInfo=()=>{const i=$('videoSelInfo');if(i&&duration)i.textContent='Selected '+fmtTime(+startEl.value)+' → '+fmtTime(+endEl.value)+' ('+fmtTime(Math.max(0,+endEl.value-+startEl.value))+')';};
[startEl,endEl].forEach(el=>el?.addEventListener('input',selInfo));
$('videoSetStart')?.addEventListener('click',()=>{startEl.value=player.currentTime.toFixed(2);selInfo();});
$('videoSetEnd')?.addEventListener('click',()=>{endEl.value=player.currentTime.toFixed(2);selInfo();});
$('videoSelAll')?.addEventListener('click',()=>{startEl.value=0;endEl.value=duration.toFixed(2);selInfo();});
const kp=$('videoKeepPitch');const syncPitch=()=>{if(player){const k=kp?kp.checked:true;player.preservesPitch=k;player.mozPreservesPitch=k;player.webkitPreservesPitch=k;}};kp?.addEventListener('change',syncPitch);syncPitch();
async function load(f){file=f;duration=0;const fmt=$('videoOutFormat');if(fmt){const e=ext(f.name);fmt.value=['webm','mov','mkv'].includes(e)?e:'mp4';}
  if(!hasWebCodecs())return;
  try{const {input}=await openInput(f);duration=await input.computeDuration();const v=await input.getPrimaryVideoTrack(),a=await input.getPrimaryAudioTrack();
    const vc=v?await v.getCodec():null,ac=a?await a.getCodec():null;
    setTimeout(()=>{startEl.value=0;endEl.value=duration.toFixed(2);endEl.max=duration.toFixed(2);const m=$('videoFileMeta');if(m)m.textContent='Duration '+fmtTime(duration)+(v?' • '+v.displayWidth+'×'+v.displayHeight:'')+' • '+[vc,ac].filter(Boolean).map(x=>x.toUpperCase()).join(' + ')+' • '+fmtSize(f.size);selInfo();},60);}
  catch(err){console.warn('Video engine could not read',f.name,err);}}
input.addEventListener('change',()=>{const f=input.files?.[0];if(f)load(f);});
player?.addEventListener('loadedmetadata',()=>setTimeout(()=>{if(duration){endEl.value=duration.toFixed(2);endEl.max=duration.toFixed(2);selInfo();}},0));
$('videoDropzone')?.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)load(f);});
$('videoResetBtn')?.addEventListener('click',()=>{file=null;duration=0;});

runBtn?.addEventListener('click',async e=>{
  if(!file)return;
  if(!hasWebCodecs()||!duration)return; // the engine could not read it: keep the original behaviour
  e.stopImmediatePropagation();e.preventDefault();if(runBtn.dataset.busy)return;runBtn.dataset.busy='1';runBtn.disabled=true;const label=runBtn.textContent;
  const a=actionEl?.value||'trim_video',start=+startEl.value||0,end=+endEl.value||duration,res=+($('videoResolution')?.value||0)||0;const t0=performance.now();
  try{
    if(a==='snapshot'){const t=player&&!isNaN(player.currentTime)?player.currentTime:start;const c=await frameAt(file,t);const f=$('videoImageFormat')?.value||'png';const b=await canvasBlob(c,f==='png'?'image/png':'image/jpeg',0.95);save(b,base(file.name)+'_frame_'+t.toFixed(2).replace('.','s')+'.'+f);notify('Saved frame at '+fmtTime(t)+' • '+c.width+'×'+c.height);}
    else if(a==='frames'){prog(0,'Exporting frames…');const r=await framesZip(file,{start,end,interval:+($('videoFrameInterval')?.value||1),format:$('videoImageFormat')?.value||'png',width:res?Math.round(res*16/9):0},p=>prog(p,'Exporting frames…'));save(r.blob,base(file.name)+'_frames.zip');notify('Exported '+r.count+' frames • '+fmtSize(r.blob.size));}
    else if(a==='gif'){prog(0,'Making GIF…');const r=await makeGif(file,{start,end,width:+($('videoGifWidth')?.value||480),fps:+($('videoGifFps')?.value||12)},p=>prog(p,'Making GIF…'));save(r.blob,base(file.name)+'.gif');notify('GIF ready • '+r.frames+' frames • '+fmtSize(r.blob.size)+(r.clipped?' • limited to the first 30 s of the selection':''));}
    else if(a==='extract_audio'){prog(0,'Extracting audio…');const f=$('videoAudioFormat')?.value||'m4a';const b=await extractAudio(file,{start,end,format:f},p=>prog(p,'Extracting audio…'));save(b,base(file.name)+'_audio.'+f);notify('Audio saved • '+f.toUpperCase()+' • '+fmtSize(b.size));}
    else{const speed=parseFloat(speedEl?.value)||1;const fmt=$('videoOutFormat')?.value||'mp4';prog(0,'Converting…');
      const r=await convertVideo(file,{start,end,format:fmt,speed,keepPitch:kp?kp.checked:true,height:res,rotate:+($('videoRotate')?.value||0),quality:$('videoQuality')?.value||'keep',mute:!!$('videoMute')?.checked,precise:!!$('videoPrecise')?.checked},p=>prog(p,'Converting… '));
      const tag=[];if(start>0.01||end<duration-0.05)tag.push('cut');if(Math.abs(speed-1)>1e-3)tag.push(speed+'x');if(res)tag.push(res+'p');save(r.blob,base(file.name)+'_'+(tag.join('_')||'converted')+'.'+fmt);
      notify((r.copied?'Cut without re-encoding':'Converted')+' • '+fmtTime(r.duration)+' • '+fmtSize(r.blob.size)+' • '+((performance.now()-t0)/1000).toFixed(1)+' s');}
  }catch(err){console.error(err);alert('Video error: '+(err.message||err));}
  finally{hideProg();runBtn.disabled=false;runBtn.textContent=label;delete runBtn.dataset.busy;}
},true);

/* ================= format bridge: browser first ================= */
const nIn=$('videoNativeInput'),nRun=$('videoNativeRun'),nTarget=$('videoNativeTarget');let nFile=null;
const BROWSER_TARGET=new Set(['mp4','m4v','webm','mov','mkv','ts','gif']);const READABLE=/^(mp4|m4v|mov|webm|mkv|ts|m2ts|mts|3gp|3g2)$/;
const nSub=document.querySelector('#videoNativeBridge .sub');if(nSub)nSub.textContent='MP4, M4V, MOV, WebM, MKV, MPEG-TS and GIF are converted right in your browser. AVI, FLV, WMV, MPEG, VOB, OGV, MXF and the rest use the FFmpeg-backed Local Engine.';
const nDzP=$('videoNativeDropzone')?.querySelector('p');if(nDzP)nDzP.textContent='Common formats convert in your browser • others use the Local Engine • no cloud upload';
nIn?.addEventListener('change',()=>{nFile=nIn.files?.[0]||null;});$('videoNativeDropzone')?.addEventListener('drop',e=>{nFile=e.dataTransfer?.files?.[0]||nFile;});$('videoNativeReset')?.addEventListener('click',()=>{nFile=null;});
let nPass=false;const toEngine=msg=>{nPass=true;try{if(msg)notify(msg);nRun.click();}finally{nPass=false;}};
nRun?.addEventListener('click',async e=>{
  if(nPass||!nFile||!hasWebCodecs())return;const t=nTarget?.value;if(!BROWSER_TARGET.has(t)||!READABLE.test(ext(nFile.name)))return;
  e.stopImmediatePropagation();e.preventDefault();if(nRun.dataset.busy)return;nRun.dataset.busy='1';nRun.disabled=true;const label=nRun.textContent;let fallback=null;
  try{nRun.textContent='Converting…';let blob;
    if(t==='gif'){blob=(await makeGif(nFile,{width:480,fps:12},p=>{nRun.textContent='Converting '+Math.round(p*100)+'%';})).blob;}
    else blob=(await convertVideo(nFile,{format:t==='m4v'?'mp4':t},p=>{nRun.textContent='Converting '+Math.round(p*100)+'%';})).blob;
    save(blob,base(nFile.name)+'.'+t);notify('Converted to '+t.toUpperCase()+' in your browser • '+fmtSize(blob.size));}
  catch(err){console.warn(err);fallback='Browser conversion failed ('+(err.message||err)+') — trying the Local Engine.';}
  finally{nRun.disabled=false;nRun.textContent=label;delete nRun.dataset.busy;}
  if(fallback)toEngine(fallback);
},true);
})();
