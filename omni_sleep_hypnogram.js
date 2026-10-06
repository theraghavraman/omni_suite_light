(function(){
'use strict';
if(window.__OMNI_SLEEP_HYPNOGRAM__) return;
window.__OMNI_SLEEP_HYPNOGRAM__=true;

const STAGES={0:'WAKE',1:'N1',2:'N2',3:'N3',4:'N4',5:'REM',6:'MOVEMENT',9:'UNSCORED'};
const STAGE_ORDER=['WAKE','N1','N2','N3','N4','REM','MOVEMENT','UNSCORED'];
const STAGE_POS={WAKE:0,N1:1,N2:2,N3:3,N4:4,REM:5,MOVEMENT:6,UNSCORED:7};
const STAGE_GLYPH={WAKE:'W',N1:'1',N2:'2',N3:'3',N4:'4',REM:'R',MOVEMENT:'M',UNSCORED:'?'};
const COLORS={WAKE:'#f7b84b',N1:'#8ecae6',N2:'#4ea8de',N3:'#386fa4',N4:'#274c77',REM:'#9b5de5',MOVEMENT:'#f07167',UNSCORED:'#94a3b8'};

const esc=v=>String(v==null?'':v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ext=n=>{const x=String(n||'').toLowerCase();if(x.endsWith('.edf.gz'))return'edf.gz';if(x.endsWith('.hyp.gz'))return'hyp.gz';return x.split('.').pop()||''};
const ascii=(u,start,len)=>new TextDecoder('latin1').decode(u.slice(start,start+len)).trim();
const num=(u,start,len)=>Number(ascii(u,start,len).replace(/[^0-9+-.]/g,''));

function isEDF(u){
  if(u.length<256)return false;
  const v=ascii(u,0,8);
  const h=num(u,184,8);
  const ns=num(u,252,4);
  return (v===''||/^0\s*$/.test(v)||/^\s*0/.test(v)) && h>=256 && ns>0 && ns<1024 && h<=u.length;
}
function parseTAL(s){
  const out=[];
  let i=0;
  while(i<s.length){
    const z=s.indexOf('\x00',i); const part=(z<0?s.slice(i):s.slice(i,z));
    const m=part.match(/([+-]?\d+(?:\.\d+)?)(?:\x15([+-]?\d+(?:\.\d+)?))?(?:\x14([\s\S]*))?/);
    if(m) out.push({onset:Number(m[1]),duration:m[2]==null?null:Number(m[2]),text:(m[3]||'').split('\x14').filter(Boolean)});
    i=z<0?s.length:z+1;
  }
  return out;
}
function parseEDF(buf){
  const u=new Uint8Array(buf);
  if(!isEDF(u)) throw new Error('Not an EDF-compatible recording. The .hyp extension alone is not enough to identify the format.');
  const ns=num(u,252,4), headerBytes=num(u,184,8), records=num(u,236,8), recordDuration=num(u,244,8);
  if(!Number.isFinite(ns)||!Number.isFinite(headerBytes)||headerBytes<256+256*ns)throw new Error('Invalid EDF header.');
  const labels=[],samples=[],signalMeta=[];
  let p=256;
  const fields=[['label',16],['transducer',80],['dim',8],['pmin',8],['pmax',8],['dmin',8],['dmax',8],['prefilter',80],['spr',8],['reserved',32]];
  const blocks={}; for(const [k,l] of fields)blocks[k]=new Array(ns);
  for(const [k,l] of fields){for(let i=0;i<ns;i++){blocks[k][i]=ascii(u,p+i*l,l)}p+=ns*l}
  for(let i=0;i<ns;i++){labels[i]=blocks.label[i];samples[i]=Number(blocks.spr[i]);signalMeta.push({label:labels[i],samplesPerRecord:samples[i],physicalDimension:blocks.dim[i],physicalMin:Number(blocks.pmin[i]),physicalMax:Number(blocks.pmax[i]),digitalMin:Number(blocks.dmin[i]),digitalMax:Number(blocks.dmax[i])})}
  const dataStart=headerBytes;
  const bytesPerRecord=samples.reduce((a,b)=>a+b,0)*2;
  const available=Math.max(0,Math.floor((u.length-dataStart)/Math.max(1,bytesPerRecord)));
  const recCount=Math.min(Number.isFinite(records)&&records>0?records:available,available);
  const signals=Array.from({length:ns},()=>[]);
  const ann=[];
  let off=dataStart;
  for(let r=0;r<recCount;r++){
    for(let s=0;s<ns;s++){
      const n=samples[s]||0,label=labels[s].toLowerCase();
      if(n<=0)continue;
      if(/annotation|event|tal/i.test(label)){
        let bytes=new Uint8Array(n*2); for(let j=0;j<n;j++){bytes[j*2]=u[off+j*2];bytes[j*2+1]=u[off+j*2+1]}
        const txt=new TextDecoder('latin1').decode(bytes).replace(/\x00/g,'');
        ann.push(...parseTAL(txt)); off+=n*2;
      }else{
        const arr=signals[s]; for(let j=0;j<n;j++){const q=off+j*2;arr.push(new DataView(buf).getInt16(q,true))} off+=n*2;
      }
    }
  }
  return {ns,headerBytes,records:recCount,recordDuration,labels,signalMeta,signals,annotations:ann};
}
function decodeHypnogram(parsed){
  const labels=parsed.labels.map(x=>x.toLowerCase());
  let epoch=Number(parsed.recordDuration)||30;
  const stageSignalCandidates=[];
  parsed.signals.forEach((a,i)=>{
    if(!a.length)return;
    const samplePerRecord=parsed.signalMeta[i].samplesPerRecord;
    const uniq=[...new Set(a.slice(0,Math.min(a.length,5000)))];
    const stageLike=uniq.filter(x=>[0,1,2,3,4,5,6,9].includes(x)).length/Math.max(1,uniq.length);
    if(stageLike>.75)stageSignalCandidates.push({i,score:stageLike,uniq});
  });
  if(parsed.annotations.length){
    const anns=parsed.annotations.filter(a=>a.text?.length);
    const sleepWords=/sleep|wake|rem|n1|n2|n3|n4|movement|artifact/i;
    const sleepAnns=anns.filter(a=>sleepWords.test(a.text.join(' ')));
    if(sleepAnns.length){
      const a=sleepAnns.map(x=>{
        const t=x.text.join(' ').trim().toUpperCase();
        let stage='UNSCORED';
        if(/^(W|WAKE|0)$/.test(t))stage='WAKE';
        else if(/^N1$/.test(t)||/SLEEP STAGE 1/.test(t))stage='N1';
        else if(/^N2$/.test(t)||/SLEEP STAGE 2/.test(t))stage='N2';
        else if(/^N3$/.test(t)||/SLEEP STAGE 3/.test(t))stage='N3';
        else if(/^N4$/.test(t)||/SLEEP STAGE 4/.test(t))stage='N4';
        else if(/^(R|REM|5)$/.test(t))stage='REM';
        else if(/^(M|MOVEMENT|6)$/.test(t))stage='MOVEMENT';
        return {start:Number(x.onset)||0,duration:Number(x.duration)||epoch,stage,source:'EDF annotation'};
      });
      return {domain:'sleep',type:'hypnogram',sourceFormat:'EDF/EDF+',epochSeconds:epoch,stages:a,detector:'EDF+ annotations'};
    }
  }
  if(!stageSignalCandidates.length)throw new Error('EDF detected, but no sleep-stage channel or sleep annotations were recognized. Try Open with Local Engine for vendor-specific HYP.');
  stageSignalCandidates.sort((a,b)=>b.score-a.score);
  const c=stageSignalCandidates[0], raw=parsed.signals[c.i], spr=parsed.signalMeta[c.i].samplesPerRecord;
  if(spr>1){epoch=(Number(parsed.recordDuration)||30)/spr}
  const vals=spr===1?raw:raw.filter((_,i)=>i%spr===0);
  const stages=vals.map((v,i)=>({start:i*epoch,duration:epoch,stage:STAGES[v]||'UNSCORED',rawValue:v,source:parsed.labels[c.i]||'sleep stage channel'}));
  return {domain:'sleep',type:'hypnogram',sourceFormat:'EDF-compatible HYP',epochSeconds:epoch,stages,detector:'Sleep-EDF stage-code channel',channel:parsed.labels[c.i],rawValues:vals};
}
function metrics(h){
  const a=h.stages.filter(x=>x.stage&&x.stage!=='UNSCORED'),epoch=h.epochSeconds||30;
  const dur=s=>a.filter(x=>x.stage===s).reduce((n,x)=>n+x.duration,0);
  const tst=['N1','N2','N3','N4','REM'].reduce((n,s)=>n+dur(s),0);
  const tib=a.length*epoch;
  const wake=a.filter(x=>x.stage==='WAKE').reduce((n,x)=>n+x.duration,0);
  const firstSleep=a.find(x=>['N1','N2','N3','N4','REM'].includes(x.stage));
  const rem=a.find(x=>x.stage==='REM');
  const awakenings=a.filter((x,i)=>x.stage==='WAKE'&&i>0&&['N1','N2','N3','N4','REM'].includes(a[i-1]?.stage)).length;
  const transitions={}; for(let i=1;i<a.length;i++){const k=a[i-1].stage+'→'+a[i].stage;transitions[k]=(transitions[k]||0)+1}
  return {tib,tst,wake,sleepEfficiency:tib?tst/tib*100:0,sleepOnsetLatency:firstSleep?.start??null,remLatency:rem&&firstSleep?rem.start-firstSleep.start:null,awakenings,stageDurations:Object.fromEntries(STAGE_ORDER.map(s=>[s,dur(s)])),transitions};
}
function fmtSec(s){if(s==null)return'—';s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?h+'h '+m+'m':m+'m '+sec+'s'}
function stageCsv(h){return['epoch,start_seconds,duration_seconds,stage,raw_value',...h.stages.map((x,i)=>[i,x.start,x.duration,x.stage,x.rawValue??''].join(','))].join('\n')}
function stageJson(h,m){return JSON.stringify({semanticModel:h,metrics:m},null,2)}
function stageSvg(h){
  const w=1200,rowH=28,top=28,left=100,height=top+STAGE_ORDER.length*rowH+40,total=Math.max(1,h.stages.reduce((n,x)=>Math.max(n,x.start+x.duration),0));
  let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+height+'"><rect width="100%" height="100%" fill="#fff"/><text x="18" y="20" font-family="system-ui" font-size="16" font-weight="700">Omni Sleep Hypnogram</text>';
  STAGE_ORDER.forEach((st,i)=>{const y=top+i*rowH;s+='<text x="12" y="'+(y+19)+'" font-family="system-ui" font-size="12">'+st+'</text><line x1="'+left+'" x2="'+(w-10)+'" y1="'+y+'" y2="'+y+'" stroke="#e5e7eb"/>'});
  for(const x of h.stages){const i=STAGE_POS[x.stage]??7,y=top+i*rowH+3,ww=Math.max(1,(x.duration/total)*(w-left-10));s+='<rect x="'+(left+(x.start/total)*(w-left-10))+'" y="'+y+'" width="'+ww+'" height="'+(rowH-6)+'" rx="5" fill="'+(COLORS[x.stage]||COLORS.UNSCORED)+'"/>'}
  s+='</svg>';return s;
}
function makeCard(){
  if(document.getElementById('omniSleepWorkspace'))return;
  const host=document.getElementById('tabUniversalData'); if(!host)return;
  const style=document.createElement('style');style.textContent=`
  #omniSleepWorkspace{border:1px solid #b9e8ee;background:linear-gradient(145deg,#f8feff,#f7f8ff);border-radius:22px;padding:20px;margin:18px 0;box-shadow:0 18px 40px rgba(11,167,187,.10)}
  #omniSleepWorkspace .sleep-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
  #omniSleepWorkspace h2{margin:0;color:#0f5f6b} #omniSleepWorkspace .sleep-sub{color:#66748a;font-size:.86rem;line-height:1.5;margin-top:5px}
  .sleep-pills{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.sleep-pill{padding:6px 9px;border-radius:999px;background:#e8faff;color:#126b78;font-size:.73rem;font-weight:700}
  .sleep-actions{display:flex;gap:8px;flex-wrap:wrap}.sleep-actions button{border:0;border-radius:11px;padding:9px 12px;font-weight:700;cursor:pointer;background:#0ba7bb;color:white}.sleep-actions button.secondary{background:#e7eef5;color:#315064}
  .sleep-status{margin-top:12px;padding:10px 12px;border-radius:11px;background:#eef6f8;color:#536878;font-size:.78rem}
  .sleep-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.sleep-metric{background:#fff;border:1px solid #e2eaf0;border-radius:13px;padding:11px}.sleep-metric b{display:block;font-size:1.05rem;color:#193747}.sleep-metric span{font-size:.7rem;color:#748493}
  .sleep-chart{margin-top:14px;background:#fff;border:1px solid #e2eaf0;border-radius:16px;padding:10px;overflow:auto}.sleep-chart canvas{display:block;width:100%;min-width:720px;height:360px}
  .sleep-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:12px;margin-top:12px}.sleep-panel{background:#fff;border:1px solid #e2eaf0;border-radius:15px;padding:12px}.sleep-panel h3{margin:0 0 9px;font-size:.9rem;color:#294555}.sleep-stage-row{display:grid;grid-template-columns:85px 1fr 55px;gap:8px;align-items:center;font-size:.74rem;margin:7px 0}.sleep-bar{height:10px;border-radius:999px;background:#edf1f4;overflow:hidden}.sleep-bar i{display:block;height:100%}.sleep-trans{width:100%;border-collapse:collapse;font-size:.7rem}.sleep-trans td,.sleep-trans th{padding:5px;border-bottom:1px solid #edf1f4;text-align:left}
  @media(max-width:700px){#omniSleepWorkspace{padding:14px}.sleep-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.sleep-grid{grid-template-columns:1fr}.sleep-chart canvas{min-width:640px}}
  `;document.head.appendChild(style);
  const el=document.createElement('section');el.id='omniSleepWorkspace';el.innerHTML=`
    <div class="sleep-head"><div><div class="uds-kicker">SLEEP SEMANTIC WORKSPACE</div><h2>😴 Sleep Hypnogram Lab</h2><div class="sleep-sub">Content-aware EDF/HYP detection → normalized sleep model → interactive hypnogram → sleep statistics → transitions → browser exports. Metrics are descriptive, not medical conclusions.</div></div><div class="sleep-actions"><button id="sleepLoad">Choose .HYP / .EDF</button><button class="secondary" id="sleepLocal">Open with Local Engine</button></div></div>
    <div class="sleep-pills"><span class="sleep-pill">① Detect</span><span class="sleep-pill">② Normalize</span><span class="sleep-pill">③ Visualize</span><span class="sleep-pill">④ Analyze</span><span class="sleep-pill">⑤ Export</span><span class="sleep-pill">Browser-first</span></div>
    <input id="sleepFile" type="file" accept=".hyp,.edf,.edf+,.rec,.bdf" multiple hidden>
    <div id="sleepStatus" class="sleep-status">Waiting for a Sleep-EDF/HYP file. A .hyp file is treated as a semantic hypnogram when its content identifies an EDF-compatible sleep-stage record.</div>
    <div id="sleepMetrics" class="sleep-metrics"></div>
    <div class="sleep-chart"><canvas id="sleepCanvas" width="1400" height="390"></canvas></div>
    <div class="sleep-grid"><div class="sleep-panel"><h3>Stage distribution</h3><div id="sleepStages"></div></div><div class="sleep-panel"><h3>Stage transitions</h3><div id="sleepTransitions"></div></div></div>
    <div class="sleep-actions" style="margin-top:12px"><button id="sleepCsv">Export epochs CSV</button><button id="sleepJson">Export semantic JSON</button><button id="sleepSvg">Export SVG</button><button id="sleepHtml">Export HTML report</button></div>`;
  const anchor=[...host.querySelectorAll('.card')].find(x=>/Inspect & Visualize/i.test(x.textContent||'')); 
  if(anchor) host.insertBefore(el,anchor); else host.appendChild(el);
  document.getElementById('sleepLoad').onclick=()=>document.getElementById('sleepFile').click();
  document.getElementById('sleepFile').onchange=e=>{const fs=[...(e.target.files||[])];const hyp=fs.find(f=>/\\.hyp$/i.test(f.name));const rec=fs.find(f=>/\\.(edf|edf\\+|rec|bdf)$/i.test(f.name));window.__OMNI_SLEEP_PAIR={hyp:hyp||null,recording:rec||null,files:fs};if(hyp&&rec)setStatus('Paired workflow: '+hyp.name+' + '+rec.name+' selected. Rendering the hypnogram now; the recording is retained as the paired source.');const f=hyp||rec;if(f)load(f)};
  document.getElementById('sleepLocal').onclick=()=>{const f=document.getElementById('sleepFile').files?.[0]||window.__OMNI_UDS_CURRENT_FILE;if(f){setStatus('Local Engine fallback selected for '+f.name+'. Use the Local Engine Studio for vendor-specific HYP parsing.')}else{setStatus('Choose a sleep file first; Local Engine fallback is available for vendor-specific HYP.')}};
  document.getElementById('sleepCsv').onclick=()=>{if(window.__OMNI_SLEEP_MODEL)downloadText(stageCsv(window.__OMNI_SLEEP_MODEL),'sleep-hypnogram.csv','text/csv')};
  document.getElementById('sleepJson').onclick=()=>{if(window.__OMNI_SLEEP_MODEL)downloadText(stageJson(window.__OMNI_SLEEP_MODEL,window.__OMNI_SLEEP_METRICS),'sleep-semantic-model.json','application/json')};
  document.getElementById('sleepSvg').onclick=()=>{if(window.__OMNI_SLEEP_MODEL)downloadText(stageSvg(window.__OMNI_SLEEP_MODEL),'sleep-hypnogram.svg','image/svg+xml')};
  document.getElementById('sleepHtml').onclick=()=>{if(window.__OMNI_SLEEP_MODEL){const h=window.__OMNI_SLEEP_MODEL,m=window.__OMNI_SLEEP_METRICS;downloadText('<!doctype html><html><body style="font-family:system-ui;padding:24px"><h1>Omni Sleep Report</h1><p>TST '+fmtSec(m.tst)+' • Efficiency '+m.sleepEfficiency.toFixed(1)+'% • WASO '+fmtSec(m.wake)+'</p>'+stageSvg(h)+'<pre>'+esc(JSON.stringify(m,null,2))+'</pre></body></html>','sleep-report.html','text/html')}};
}
function setStatus(s){const e=document.getElementById('sleepStatus');if(e)e.textContent=s}
function downloadText(t,n,type){const b=new Blob([t],{type}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=n;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200)}
function render(h){
  const m=metrics(h);window.__OMNI_SLEEP_MODEL=h;window.__OMNI_SLEEP_METRICS=m;
  const cards=[['TST',fmtSec(m.tst)],['Sleep efficiency',m.sleepEfficiency.toFixed(1)+'%'],['Sleep onset latency',fmtSec(m.sleepOnsetLatency)],['REM latency',fmtSec(m.remLatency)],['WASO',fmtSec(m.wake)],['Awakenings',m.awakenings],['Epoch',fmtSec(h.epochSeconds)],['Source',h.sourceFormat]];
  document.getElementById('sleepMetrics').innerHTML=cards.map(x=>'<div class="sleep-metric"><b>'+esc(x[1])+'</b><span>'+esc(x[0])+'</span></div>').join('');
  const rows=STAGE_ORDER.filter(s=>m.stageDurations[s]>0),max=Math.max(...rows.map(s=>m.stageDurations[s]),1);
  document.getElementById('sleepStages').innerHTML=rows.map(s=>'<div class="sleep-stage-row"><span>'+s+'</span><div class="sleep-bar"><i style="width:'+m.stageDurations[s]/max*100+'%;background:'+COLORS[s]+'"></i></div><b>'+fmtSec(m.stageDurations[s])+'</b></div>').join('');
  const tr=Object.entries(m.transitions).sort((a,b)=>b[1]-a[1]).slice(0,20);
  document.getElementById('sleepTransitions').innerHTML=tr.length?'<table class="sleep-trans"><tr><th>Transition</th><th>Count</th></tr>'+tr.map(x=>'<tr><td>'+esc(x[0])+'</td><td>'+x[1]+'</td></tr>').join('')+'</table>':'No transitions detected.';
  const c=document.getElementById('sleepCanvas'),ctx=c.getContext('2d'),w=c.width,hgt=c.height;ctx.clearRect(0,0,w,hgt);ctx.fillStyle='#fbfdff';ctx.fillRect(0,0,w,hgt);
  const left=92,right=20,top=24,bottom=34,innerW=w-left-right,innerH=hgt-top-bottom,total=Math.max(1,h.stages.reduce((n,x)=>Math.max(n,x.start+x.duration),0));
  ctx.font='13px system-ui';ctx.fillStyle='#334155';STAGE_ORDER.forEach(s=>{const y=top+(STAGE_POS[s]+.5)*innerH/STAGE_ORDER.length;ctx.fillText(STAGE_GLYPH[s]+' '+s,12,y+4);ctx.strokeStyle='#e5edf2';ctx.beginPath();ctx.moveTo(left,y-15);ctx.lineTo(w-right,y-15);ctx.stroke()});
  for(const x of h.stages){const yy=top+STAGE_POS[x.stage]*innerH/STAGE_ORDER.length+3,xx=left+(x.start/total)*innerW,ww=Math.max(1,x.duration/total*innerW);ctx.fillStyle=COLORS[x.stage]||COLORS.UNSCORED;ctx.fillRect(xx,yy,ww,innerH/STAGE_ORDER.length-6)}
  ctx.fillStyle='#64748b';ctx.fillText('0',left,hgt-10);ctx.fillText(fmtSec(total),w-right-70,hgt-10);
}
async function load(file){
  makeCard();
  setStatus('Reading '+file.name+' ('+file.size.toLocaleString()+' bytes)…');
  try{
    const buf=await file.arrayBuffer(),parsed=parseEDF(buf),h=decodeHypnogram(parsed);
    if(!h.stages.length)throw new Error('No sleep epochs found.');
    render(h);setStatus('✓ Detected '+h.sourceFormat+' • '+h.stages.length+' epochs • '+h.epochSeconds+' s/epoch • '+(h.channel||h.detector)+'. Browser parser is active.');
    const main=document.getElementById('udsStatus');if(main)main.textContent='✓ Sleep semantic model loaded: '+file.name;
  }catch(e){setStatus('⚠ '+e.message+' Browser parsing is intentionally conservative; use Local Engine for vendor-specific variants.')}
}
function wire(){
  makeCard();
  const input=document.getElementById('udsInput');
  if(input&&!input.dataset.sleepWire){
    input.dataset.sleepWire='1';
    input.addEventListener('change',()=>{const f=input.files?.[0];window.__OMNI_UDS_CURRENT_FILE=f;if(f&&/\.(hyp|edf|edf\+|rec|bdf)$/i.test(f.name))load(f)});
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
window.OMNI_SLEEP_HYPNOGRAM={load,parseEDF,decodeHypnogram,metrics};
})();