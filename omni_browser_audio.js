/* Omni Suite — Audio Studio upgrades (runs entirely in the browser).
 * Waveform with drag-to-select, speed change that keeps the pitch (WSOLA time-stretch),
 * fades, normalise, mono/stereo, sample rate, and export to WAV, MP3, M4A (AAC), Opus (WebM),
 * AIFF or AU. The format bridge converts in the browser whenever it can.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const ext=n=>(String(n||'').split('.').pop()||'').toLowerCase();
const base=n=>String(n||'audio').replace(/\.[^.]+$/,'')||'audio';
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const notify=(m,e)=>{if(window.omniNotify)window.omniNotify(m,e);};
const fmtSize=b=>b>=1048576?(b/1048576).toFixed(2)+' MB':Math.max(1,Math.round(b/1024))+' KB';
const fmtTime=s=>{s=Math.max(0,s);const m=Math.floor(s/60),r=s-m*60;return m+':'+(r<10?'0':'')+r.toFixed(1);};
const tick=()=>new Promise(r=>setTimeout(r,0));
const CDN='https://cdn.jsdelivr.net/npm/';
const loaded={};
function loadScript(src){return loaded[src]||(loaded[src]=new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>{delete loaded[src];rej(new Error('Could not load '+src.split('/npm/')[1]+' — check your internet connection.'));};document.head.appendChild(s);}));}
const lame=async()=>{if(!window.lamejs)await loadScript(CDN+'lamejs@1.2.1/lame.min.js');return window.lamejs;};
const mp4mux=async()=>{if(!window.Mp4Muxer)await loadScript(CDN+'mp4-muxer@5.1.3/build/mp4-muxer.js');return window.Mp4Muxer;};
const webmmux=async()=>{if(!window.WebMMuxer)await loadScript(CDN+'webm-muxer@5.0.3/build/webm-muxer.js');return window.WebMMuxer;};

/* ---------------- decoding ---------------- */
async function decodeFile(file){const Ctx=window.AudioContext||window.webkitAudioContext;const ctx=new Ctx();try{return await ctx.decodeAudioData((await file.arrayBuffer()).slice(0));}finally{try{ctx.close();}catch(_){}}}
const channelsOf=b=>{const a=[];for(let c=0;c<b.numberOfChannels;c++)a.push(b.getChannelData(c));return a;};

/* ---------------- WSOLA time-stretch (tempo change, pitch kept) ---------------- */
function timeStretch(chs,speed){
  const len=chs[0].length;if(Math.abs(speed-1)<1e-3)return chs.map(c=>c.slice());
  const N=1024,W=2*N,tol=512,ds=8;const outLen=Math.max(1,Math.floor(len/speed));
  if(len<W*2){/* too short to stretch smoothly: plain resample */return chs.map(c=>{const o=new Float32Array(outLen);for(let i=0;i<outLen;i++){const x=i*speed,j=Math.floor(x),f=x-j;o[i]=(c[j]||0)*(1-f)+(c[j+1]||0)*f;}return o;});}
  const mono=new Float32Array(len);for(const c of chs)for(let i=0;i<len;i++)mono[i]+=c[i]/chs.length;
  const dl=Math.floor(len/ds),md=new Float32Array(dl);for(let i=0;i<dl;i++){let s=0;for(let k=0;k<ds;k++)s+=mono[i*ds+k];md[i]=s/ds;}
  const win=new Float32Array(W);for(let i=0;i<W;i++)win[i]=0.5-0.5*Math.cos(2*Math.PI*i/W);
  const out=chs.map(()=>new Float32Array(outLen+W)),norm=new Float32Array(outLen+W);
  let prev=0;const maxPos=len-W;
  for(let o=0,k=0;o<outLen;o+=N,k++){
    const nominal=Math.min(maxPos,Math.round(o*speed));let pos=nominal;
    if(k>0){const target=Math.min(maxPos,prev+N);const tl=N/ds,t0=Math.floor(target/ds);let best=-Infinity,bd=0;
      for(let d=-tol;d<=tol;d+=ds){const p=nominal+d;if(p<0||p>maxPos)continue;const p0=Math.floor(p/ds);let s=0,e=1e-9;for(let i=0;i<tl;i++){const a=md[p0+i]||0;s+=a*(md[t0+i]||0);e+=a*a;}const sc=s/Math.sqrt(e);if(sc>best){best=sc;bd=d;}}
      let fb=-Infinity,fd=bd;for(let d=bd-ds;d<=bd+ds;d++){const p=nominal+d;if(p<0||p>maxPos)continue;let s=0,e=1e-9;for(let i=0;i<N;i+=2){const a=mono[p+i];s+=a*mono[target+i];e+=a*a;}const sc=s/Math.sqrt(e);if(sc>fb){fb=sc;fd=d;}}
      pos=Math.max(0,Math.min(maxPos,nominal+fd));}
    for(let c=0;c<chs.length;c++){const src=chs[c],dst=out[c];for(let i=0;i<W;i++)dst[o+i]+=src[pos+i]*win[i];}
    for(let i=0;i<W;i++)norm[o+i]+=win[i];prev=pos;}
  return out.map(dst=>{const r=new Float32Array(outLen);for(let i=0;i<outLen;i++){const n=norm[i];r[i]=n>0.05?dst[i]/n:dst[i];}return r;});
}

/* ---------------- processing pipeline ---------------- */
async function processAudio(buf,o){
  const sr=buf.sampleRate;const s0=Math.max(0,Math.floor((o.start||0)*sr)),s1=Math.min(buf.length,Math.ceil((o.end>0?o.end:buf.duration)*sr));
  if(!(s1>s0))throw new Error('End time must be greater than start time.');
  let chs=channelsOf(buf).map(c=>c.subarray(s0,s1));
  const speed=o.speed||1;let rate=1;
  if(Math.abs(speed-1)>1e-3){if(o.keepPitch!==false){chs=timeStretch(chs,speed);await tick();}else rate=speed;}
  const outCh=o.channels==='mono'?1:o.channels==='stereo'?2:Math.min(2,chs.length)||1;
  const outSr=o.sampleRate||sr;const srcLen=chs[0].length;const outLen=Math.max(1,Math.round(srcLen/rate*outSr/sr));
  const off=new OfflineAudioContext(outCh,outLen,outSr);const ab=off.createBuffer(chs.length,srcLen,sr);chs.forEach((c,i)=>ab.copyToChannel(c instanceof Float32Array?c:new Float32Array(c),i));
  const src=off.createBufferSource();src.buffer=ab;src.playbackRate.value=rate;const g=off.createGain();src.connect(g);g.connect(off.destination);
  const dur=outLen/outSr,fi=Math.min(o.fadeIn||0,dur/2),fo=Math.min(o.fadeOut||0,dur/2);const gain=Math.pow(10,(o.gainDb||0)/20);
  g.gain.setValueAtTime(fi>0?0:gain,0);if(fi>0)g.gain.linearRampToValueAtTime(gain,fi);if(fo>0){g.gain.setValueAtTime(gain,Math.max(fi,dur-fo));g.gain.linearRampToValueAtTime(0,dur);}
  src.start(0);const out=await off.startRendering();
  if(o.normalize){let peak=0;for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=0;i<d.length;i++){const v=Math.abs(d[i]);if(v>peak)peak=v;}}
    if(peak>1e-5){const k=0.891/peak;for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=k;}}}
  return out;
}

/* ---------------- encoders ---------------- */
function pcm16(d){const o=new Int16Array(d.length);for(let i=0;i<d.length;i++){const s=Math.max(-1,Math.min(1,d[i]));o[i]=s<0?s*0x8000:s*0x7FFF;}return o;}
function interleave16(buf,bigEndian){const ch=buf.numberOfChannels,n=buf.length,dv=new DataView(new ArrayBuffer(n*ch*2)),cs=channelsOf(buf);for(let i=0,p=0;i<n;i++)for(let c=0;c<ch;c++,p+=2){const s=Math.max(-1,Math.min(1,cs[c][i]));dv.setInt16(p,s<0?s*0x8000:s*0x7FFF,!bigEndian);}return new Uint8Array(dv.buffer);}
function encodeWav(buf){const data=interleave16(buf,false),ch=buf.numberOfChannels,sr=buf.sampleRate;const h=new DataView(new ArrayBuffer(44));const w=(o,s)=>{for(let i=0;i<s.length;i++)h.setUint8(o+i,s.charCodeAt(i));};
  w(0,'RIFF');h.setUint32(4,36+data.length,true);w(8,'WAVE');w(12,'fmt ');h.setUint32(16,16,true);h.setUint16(20,1,true);h.setUint16(22,ch,true);h.setUint32(24,sr,true);h.setUint32(28,sr*ch*2,true);h.setUint16(32,ch*2,true);h.setUint16(34,16,true);w(36,'data');h.setUint32(40,data.length,true);
  return new Blob([h.buffer,data],{type:'audio/wav'});}
function ieee80(v){const b=new Uint8Array(10);let e=Math.floor(Math.log2(v)),m=v/Math.pow(2,e);e+=16383;b[0]=(e>>8)&0x7f;b[1]=e&0xff;let hi=Math.floor(m*2147483648),lo=Math.floor((m*2147483648-hi)*4294967296);[24,16,8,0].forEach((s,i)=>{b[2+i]=(hi>>>s)&255;b[6+i]=(lo>>>s)&255;});return b;}
function encodeAiff(buf){const data=interleave16(buf,true),ch=buf.numberOfChannels;const h=new DataView(new ArrayBuffer(54));const w=(o,s)=>{for(let i=0;i<4;i++)h.setUint8(o+i,s.charCodeAt(i));};
  w(0,'FORM');h.setUint32(4,46+data.length);w(8,'AIFF');w(12,'COMM');h.setUint32(16,18);h.setUint16(20,ch);h.setUint32(22,buf.length);h.setUint16(26,16);ieee80(buf.sampleRate).forEach((x,i)=>h.setUint8(28+i,x));w(38,'SSND');h.setUint32(42,8+data.length);h.setUint32(46,0);h.setUint32(50,0);
  return new Blob([h.buffer,data],{type:'audio/aiff'});}
function encodeAu(buf){const data=interleave16(buf,true);const h=new DataView(new ArrayBuffer(24));h.setUint32(0,0x2e736e64);h.setUint32(4,24);h.setUint32(8,data.length);h.setUint32(12,3);h.setUint32(16,buf.sampleRate);h.setUint32(20,buf.numberOfChannels);return new Blob([h.buffer,data],{type:'audio/basic'});}
const MP3_RATES=[8000,11025,12000,16000,22050,24000,32000,44100,48000];
async function resampleTo(buf,sr,ch){ch=ch||buf.numberOfChannels;if(buf.sampleRate===sr&&buf.numberOfChannels===ch)return buf;const off=new OfflineAudioContext(ch,Math.max(1,Math.round(buf.duration*sr)),sr);const s=off.createBufferSource();s.buffer=buf;s.connect(off.destination);s.start(0);return off.startRendering();}
async function encodeMp3(buf,kbps,onProg){const L=await lame();if(!MP3_RATES.includes(buf.sampleRate))buf=await resampleTo(buf,44100);
  const ch=Math.min(2,buf.numberOfChannels);const enc=new L.Mp3Encoder(ch,buf.sampleRate,kbps||192);const l=pcm16(buf.getChannelData(0)),r=ch>1?pcm16(buf.getChannelData(1)):null;const parts=[];const B=1152*20;
  for(let i=0;i<l.length;i+=B){const m=ch>1?enc.encodeBuffer(l.subarray(i,i+B),r.subarray(i,i+B)):enc.encodeBuffer(l.subarray(i,i+B));if(m.length)parts.push(new Uint8Array(m));if(onProg&&(i/B)%40===0){onProg(i/l.length);await tick();}}
  const f=enc.flush();if(f.length)parts.push(new Uint8Array(f));return new Blob(parts,{type:'audio/mpeg'});}
async function webCodecsSupported(codec,sr,ch){if(!window.AudioEncoder||!window.AudioData)return false;try{const r=await AudioEncoder.isConfigSupported({codec,sampleRate:sr,numberOfChannels:ch,bitrate:128000});return !!r.supported;}catch(_){return false;}}
async function encodeWithWebCodecs(buf,kind,kbps){
  const isAac=kind==='m4a';const sr=isAac?(buf.sampleRate===48000?48000:44100):48000;const ch=Math.min(2,buf.numberOfChannels);buf=await resampleTo(buf,sr,ch);
  const codec=isAac?'mp4a.40.2':'opus';if(!(await webCodecsSupported(codec,sr,ch)))throw new Error((isAac?'AAC':'Opus')+' encoding is not available in this browser — choose MP3 or WAV, or use the Local Engine.');
  let muxer;if(isAac){const M=await mp4mux();muxer=new M.Muxer({target:new M.ArrayBufferTarget(),audio:{codec:'aac',sampleRate:sr,numberOfChannels:ch},fastStart:'in-memory'});}
  else{const M=await webmmux();muxer=new M.Muxer({target:new M.ArrayBufferTarget(),audio:{codec:'A_OPUS',sampleRate:sr,numberOfChannels:ch}});}
  let err=null;const enc=new AudioEncoder({output:(chunk,meta)=>muxer.addAudioChunk(chunk,meta),error:e=>{err=e;}});
  enc.configure({codec,sampleRate:sr,numberOfChannels:ch,bitrate:(kbps||160)*1000});
  const F=sr/50*10;const cs=channelsOf(buf);for(let i=0;i<buf.length;i+=F){const n=Math.min(F,buf.length-i);const planar=new Float32Array(n*ch);for(let c=0;c<ch;c++)planar.set(cs[c].subarray(i,i+n),c*n);
    const ad=new AudioData({format:'f32-planar',sampleRate:sr,numberOfFrames:n,numberOfChannels:ch,timestamp:Math.round(i/sr*1e6),data:planar});enc.encode(ad);ad.close();if(enc.encodeQueueSize>20)await new Promise(r=>setTimeout(r,5));if(err)throw err;}
  await enc.flush();enc.close();if(err)throw err;muxer.finalize();return new Blob([muxer.target.buffer],{type:isAac?'audio/mp4':'audio/webm'});}
async function encodeAudio(buf,fmt,opts={}){
  switch(fmt){case'wav':return encodeWav(buf);case'aiff':case'aif':return encodeAiff(buf);case'au':return encodeAu(buf);case'mp3':return encodeMp3(buf,opts.kbps,opts.onProgress);
    case'm4a':return encodeWithWebCodecs(buf,'m4a',opts.kbps);case'webm':case'opus-webm':return encodeWithWebCodecs(buf,'webm',opts.kbps);default:throw new Error('Unsupported output: '+fmt);}}
const OUT_EXT={wav:'wav',mp3:'mp3',m4a:'m4a',webm:'webm',aiff:'aiff',au:'au'};
window.OMNI_AUDIO={decodeFile,processAudio,timeStretch,encodeAudio,encodeWav,encodeMp3};

/* ================= main studio card ================= */
const input=$('audioInput');if(!input)return;
input.setAttribute('accept','audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,.weba,.aiff,.aif,.mp4,.mkv,.mov');
let file=null,abuf=null;
const player=$('audioPlayer'),startEl=$('audioStartSec'),endEl=$('audioEndSec'),speedEl=$('audioSpeedSelect'),runBtn=$('audioProcessBtn');
const dzP=$('audioDropzone')?.querySelector('p');if(dzP)dzP.textContent='MP3, WAV, M4A/AAC, OGG, Opus, FLAC, WebM and the audio track of MP4/MOV videos • everything stays on your device';
const sub=document.querySelector('#tabAudio .card .sub');if(sub)sub.textContent='Trim with a waveform, change speed without the chipmunk effect, fade, normalise and export as WAV, MP3, M4A, Opus, AIFF or AU — all in your browser.';
// extra controls
const grid=startEl?.closest('.options-grid');
if(grid&&!$('audioOutFormat')){
  const wave=document.createElement('div');wave.id='audioWaveWrap';wave.style.cssText='position:relative;width:100%;margin-top:10px;user-select:none;touch-action:none';
  wave.innerHTML='<canvas id="audioWave" style="width:100%;height:96px;display:block;border-radius:10px;background:var(--rv-inset,#f3f2f8);cursor:crosshair"></canvas><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:var(--text-muted,#777)"><span id="audioSelInfo">Drag across the waveform to choose the part to keep</span><span style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn-reset" id="audioSetStart">Start = playhead</button><button type="button" class="btn-reset" id="audioSetEnd">End = playhead</button><button type="button" class="btn-reset" id="audioPlaySel">▶ Play selection</button><button type="button" class="btn-reset" id="audioSelAll">Select all</button></span></div>';
  grid.parentElement.insertBefore(wave,grid);
  const sp=speedEl;if(sp&&![...sp.options].some(o=>o.value==='0.9')){[['0.9','0.9x'],['1.1','1.1x'],['1.75','1.75x'],['3.0','3.0x']].forEach(([v,t])=>{const o=new Option(t,v);sp.add(o);});[...sp.options].sort((a,b)=>+a.value-+b.value).forEach(o=>sp.appendChild(o));sp.value='1.0';}
  const more=document.createElement('div');more.className='options-grid';more.style.marginTop='10px';
  more.innerHTML=`<div class="form-group"><label for="audioOutFormat">Save as</label><select id="audioOutFormat" class="form-select"><option value="wav">WAV (lossless, 16-bit)</option><option value="mp3" selected>MP3</option><option value="m4a">M4A (AAC)</option><option value="webm">Opus (.webm)</option><option value="aiff">AIFF</option><option value="au">AU</option></select></div>
  <div class="form-group"><label for="audioBitrate">Quality (MP3 / M4A / Opus)</label><select id="audioBitrate" class="form-select"><option value="96">96 kbps (voice)</option><option value="128">128 kbps</option><option value="192" selected>192 kbps (music)</option><option value="256">256 kbps</option><option value="320">320 kbps (best)</option></select></div>
  <div class="form-group"><label for="audioChannels">Channels</label><select id="audioChannels" class="form-select"><option value="keep">Keep original</option><option value="mono">Mono</option><option value="stereo">Stereo</option></select></div>
  <div class="form-group"><label for="audioSampleRate">Sample rate</label><select id="audioSampleRate" class="form-select"><option value="0">Keep original</option><option value="48000">48 kHz</option><option value="44100">44.1 kHz</option><option value="22050">22.05 kHz</option><option value="16000">16 kHz (speech / transcription)</option></select></div>
  <div class="form-group"><label>Fade in / out (seconds)</label><div style="display:flex;gap:6px;align-items:center"><input type="number" id="audioFadeIn" class="form-input" style="width:90px" value="0" min="0" step="0.5"><span style="color:var(--text-muted)">/</span><input type="number" id="audioFadeOut" class="form-input" style="width:90px" value="0" min="0" step="0.5"></div></div>
  <div class="form-group"><label>Volume</label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="audioNormalize"> Normalise loudness peaks</label><label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:4px"><input type="checkbox" id="audioKeepPitch" checked> Keep pitch when changing speed</label></div>`;
  grid.insertAdjacentElement('afterend',more);
  if(runBtn)runBtn.textContent='Process & Download';
}
const canvas=$('audioWave');let peaks=null;
function computePeaks(){if(!abuf||!canvas)return;const w=Math.max(200,Math.round(canvas.clientWidth||800));const cs=channelsOf(abuf),n=abuf.length,step=n/w;peaks=new Float32Array(w*2);for(let x=0;x<w;x++){let mn=1,mx=-1;const a=Math.floor(x*step),b=Math.min(n,Math.floor((x+1)*step));for(let i=a;i<b;i+=Math.max(1,Math.floor((b-a)/400)))for(const c of cs){const v=c[i];if(v<mn)mn=v;if(v>mx)mx=v;}peaks[x*2]=mn;peaks[x*2+1]=mx;}let top=0;for(let i=0;i<peaks.length;i++)top=Math.max(top,Math.abs(peaks[i]));if(top>1e-4){const k=0.95/top;for(let i=0;i<peaks.length;i++)peaks[i]*=k;}}
function draw(){if(!canvas)return;const dpr=window.devicePixelRatio||1,w=canvas.clientWidth||800,h=canvas.clientHeight||96;canvas.width=w*dpr;canvas.height=h*dpr;const g=canvas.getContext('2d');g.scale(dpr,dpr);g.clearRect(0,0,w,h);
  if(!abuf||!peaks){g.fillStyle='#999';g.font='12px sans-serif';g.fillText(file?'Waveform unavailable for this file':'No audio loaded',10,h/2);return;}
  const dur=abuf.duration,s=+startEl.value||0,e=+endEl.value||dur,x0=s/dur*w,x1=Math.min(w,e/dur*w);const accent=getComputedStyle(document.documentElement).getPropertyValue('--rv-accent').trim()||'#e5484d';
  g.fillStyle='rgba(229,72,77,.12)';g.fillRect(x0,0,x1-x0,h);const pw=peaks.length/2;
  for(let x=0;x<w;x++){const i=Math.floor(x/w*pw);const mn=peaks[i*2],mx=peaks[i*2+1];const inSel=x>=x0&&x<=x1;g.fillStyle=inSel?accent:'#b9b6c8';const y1=(1-mx)/2*h,y2=(1-mn)/2*h;g.fillRect(x,y1,1,Math.max(1,y2-y1));}
  g.fillStyle=accent;g.fillRect(x0,0,2,h);g.fillRect(x1-2,0,2,h);
  if(player&&!isNaN(player.currentTime)){const px=player.currentTime/dur*w;g.fillStyle='#222';g.fillRect(px,0,1.5,h);}
  const info=$('audioSelInfo');if(info)info.textContent='Selected '+fmtTime(s)+' → '+fmtTime(e)+' ('+fmtTime(Math.max(0,e-s))+' of '+fmtTime(dur)+')';}
if(canvas){let drag=null;const toT=ev=>{const r=canvas.getBoundingClientRect();return Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width))*(abuf?abuf.duration:0);};
  canvas.addEventListener('pointerdown',ev=>{if(!abuf)return;drag=toT(ev);canvas.setPointerCapture(ev.pointerId);});
  canvas.addEventListener('pointermove',ev=>{if(drag==null)return;const t=toT(ev);startEl.value=Math.min(drag,t).toFixed(2);endEl.value=Math.max(drag,t).toFixed(2);draw();});
  canvas.addEventListener('pointerup',ev=>{if(drag==null)return;const t=toT(ev);if(Math.abs(t-drag)<0.05*(abuf.duration/20)){if(player)player.currentTime=t;}else{startEl.value=Math.min(drag,t).toFixed(2);endEl.value=Math.max(drag,t).toFixed(2);}drag=null;draw();});
  window.addEventListener('resize',()=>{computePeaks();draw();});}
[startEl,endEl].forEach(el=>el?.addEventListener('input',draw));
player?.addEventListener('timeupdate',()=>{draw();if(player.dataset.selEnd&&player.currentTime>=+player.dataset.selEnd){player.pause();delete player.dataset.selEnd;}});
$('audioSetStart')?.addEventListener('click',()=>{if(player){startEl.value=player.currentTime.toFixed(2);draw();}});
$('audioSetEnd')?.addEventListener('click',()=>{if(player){endEl.value=player.currentTime.toFixed(2);draw();}});
$('audioSelAll')?.addEventListener('click',()=>{if(abuf){startEl.value=0;endEl.value=abuf.duration.toFixed(2);draw();}});
$('audioPlaySel')?.addEventListener('click',()=>{if(!player)return;player.currentTime=+startEl.value||0;player.dataset.selEnd=+endEl.value||'';player.play().catch(()=>{});});
// keep-pitch preview while listening
const keepPitchEl=$('audioKeepPitch');const syncPitch=()=>{if(player){const k=keepPitchEl?keepPitchEl.checked:true;player.preservesPitch=k;player.mozPreservesPitch=k;player.webkitPreservesPitch=k;}};keepPitchEl?.addEventListener('change',syncPitch);syncPitch();
const fmtEl=$('audioOutFormat');
(async()=>{if(!fmtEl)return;const aac=await webCodecsSupported('mp4a.40.2',44100,2),opus=await webCodecsSupported('opus',48000,2);[...fmtEl.options].forEach(o=>{if((o.value==='m4a'&&!aac)||(o.value==='webm'&&!opus)){o.disabled=true;o.textContent+=' — not supported by this browser';}});})();

async function load(f){file=f;abuf=null;peaks=null;draw();
  try{abuf=await decodeFile(f);computePeaks();setTimeout(()=>{startEl.value=0;endEl.value=abuf.duration.toFixed(2);endEl.max=abuf.duration.toFixed(2);const m=$('audioFileMeta');if(m)m.textContent='Duration '+fmtTime(abuf.duration)+' • '+abuf.sampleRate+' Hz • '+(abuf.numberOfChannels===1?'mono':abuf.numberOfChannels===2?'stereo':abuf.numberOfChannels+' channels')+' • '+fmtSize(f.size);draw();},30);}
  catch(err){abuf=null;console.warn('Browser could not decode',f.name,err);draw();}}
input.addEventListener('change',()=>{const f=input.files?.[0];if(f)load(f);});
$('audioDropzone')?.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f)load(f);});
$('audioResetBtn')?.addEventListener('click',()=>{file=null;abuf=null;peaks=null;draw();});

runBtn?.addEventListener('click',async e=>{
  if(!file)return;
  if(!abuf){e.stopImmediatePropagation();e.preventDefault();alert('This browser cannot decode “'+file.name+'”. Use the Local Audio Format Bridge below (needs the Omni Local Engine), or convert it to MP3/WAV first.');return;}
  e.stopImmediatePropagation();e.preventDefault();if(runBtn.dataset.busy)return;runBtn.dataset.busy='1';runBtn.disabled=true;const label=runBtn.textContent;
  try{const fmt=fmtEl?.value||'wav';const speed=parseFloat(speedEl?.value)||1;
    runBtn.textContent=Math.abs(speed-1)>1e-3&&keepPitchEl?.checked!==false?'Stretching tempo…':'Processing…';await tick();
    const out=await processAudio(abuf,{start:+startEl.value||0,end:+endEl.value||abuf.duration,speed,keepPitch:keepPitchEl?keepPitchEl.checked:true,channels:$('audioChannels')?.value,sampleRate:+($('audioSampleRate')?.value||0)||0,fadeIn:+($('audioFadeIn')?.value||0),fadeOut:+($('audioFadeOut')?.value||0),normalize:!!$('audioNormalize')?.checked});
    runBtn.textContent='Encoding '+fmt.toUpperCase()+'…';await tick();
    const blob=await encodeAudio(out,fmt,{kbps:+($('audioBitrate')?.value||192),onProgress:p=>{runBtn.textContent='Encoding '+fmt.toUpperCase()+' '+Math.round(p*100)+'%';}});
    const tag=[];if(Math.abs(speed-1)>1e-3)tag.push(speed+'x');if((+startEl.value||0)>0.01||(+endEl.value||0)<abuf.duration-0.05)tag.push('cut');
    save(blob,base(file.name)+(tag.length?'_'+tag.join('_'):'_edited')+'.'+OUT_EXT[fmt]);
    notify('Saved '+OUT_EXT[fmt].toUpperCase()+' • '+fmtTime(out.duration)+' • '+fmtSize(blob.size));
  }catch(err){console.error(err);alert('Audio error: '+(err.message||err));}
  finally{runBtn.disabled=false;runBtn.textContent=label;delete runBtn.dataset.busy;}
},true);

/* ================= format bridge: browser first ================= */
const nIn=$('audioNativeInput'),nRun=$('audioNativeRun'),nTarget=$('audioNativeTarget');let nFile=null;
const BROWSER_TARGET={wav:'wav',mp3:'mp3',aiff:'aiff',au:'au',m4a:'m4a'};
if(nTarget&&![...nTarget.options].some(o=>o.value==='webm')){nTarget.add(new Option('Opus in WebM (browser)','webm'));}
const nSub=document.querySelector('#audioNativeBridge .sub');if(nSub)nSub.textContent='MP3, WAV, M4A, Opus (WebM), AIFF and AU are converted right in your browser. FLAC, OGG, WMA, AMR, AC-3, CAF, WavPack and the rest use the FFmpeg-backed Local Engine.';
const nDzP=$('audioNativeDropzone')?.querySelector('p');if(nDzP)nDzP.textContent='Common formats convert in your browser • others use the Local Engine • no cloud upload';
nIn?.addEventListener('change',()=>{nFile=nIn.files?.[0]||null;});$('audioNativeDropzone')?.addEventListener('drop',e=>{nFile=e.dataTransfer?.files?.[0]||nFile;});$('audioNativeReset')?.addEventListener('click',()=>{nFile=null;});
let passToEngine=false;const LIKELY=/^(mp3|wav|wave|ogg|oga|opus|flac|webm|weba|m4a|aac|mp4|m4b|mov|aif|aiff)$/;
function toEngine(msg){passToEngine=true;try{if(msg)notify(msg);nRun.click();}finally{passToEngine=false;}}
nRun?.addEventListener('click',async e=>{
  if(passToEngine)return;const t=nTarget?.value;if(!nFile||!(t in BROWSER_TARGET||t==='webm')||!LIKELY.test(ext(nFile.name)))return;
  e.stopImmediatePropagation();e.preventDefault();if(nRun.dataset.busy)return;nRun.dataset.busy='1';nRun.disabled=true;const label=nRun.textContent;nRun.textContent='Converting…';let fallback=null;
  try{let buf;try{buf=await decodeFile(nFile);}catch(_){fallback='This browser cannot decode '+ext(nFile.name).toUpperCase()+' — trying the Local Engine.';}
    if(buf&&t==='m4a'&&!(await webCodecsSupported('mp4a.40.2',44100,2)))fallback='AAC encoding is not available in this browser — trying the Local Engine.';
    if(!fallback){const blob=await encodeAudio(buf,t,{kbps:t==='mp3'?192:160,onProgress:p=>{nRun.textContent='Converting '+Math.round(p*100)+'%';}});save(blob,base(nFile.name)+'.'+OUT_EXT[t]);notify('Converted to '+OUT_EXT[t].toUpperCase()+' in your browser • '+fmtSize(blob.size));}
  }catch(err){alert('Audio conversion error: '+(err.message||err));}
  finally{nRun.disabled=false;nRun.textContent=label;delete nRun.dataset.busy;}
  if(fallback){if(t==='webm')alert(fallback.replace(' — trying the Local Engine.','.'));else toEngine(fallback);}
},true);
})();
