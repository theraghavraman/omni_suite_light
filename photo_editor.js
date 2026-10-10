/* Redmark Forge — Image Tools: Photo Editor (browser-only)
 * A simple single-photo editor: crop / rotate / flip / straighten, light & colour adjustments,
 * filter presets, blur / pixelate / black-out brushes and boxes (faces, number plates), drawing,
 * text, resize and export to JPEG / PNG / WebP / AVIF. Pure Canvas 2D — no libraries, no uploads.
 *
 * Model: `base` is the full-resolution working image. Geometry, retouch, drawing and text edits are
 * written into a new `base` (kept in undo history). Adjustments and filters stay as parameters and are
 * previewed on a downscaled proxy; they are baked into `base` when another tool is chosen, and applied
 * at full resolution on export. Exported files contain no EXIF/GPS metadata.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const notify=(m,e=false)=>{try{if(typeof window.omniNotify==='function')return window.omniNotify(m,e);}catch(_){}(e?console.warn:console.log)('[Photo Editor] '+m);};
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(2)+' MB';
const MAX_PIXELS=16e6;          // keeps canvases within mobile Safari's limit
const PROXY_EDGE=1600;

const ADJ=[
  ['exposure','Exposure',-100,100],['brightness','Brightness',-100,100],['contrast','Contrast',-100,100],
  ['highlights','Highlights',-100,100],['shadows','Shadows',-100,100],['saturation','Saturation',-100,100],
  ['vibrance','Vibrance',-100,100],['warmth','Warmth',-100,100],['tint','Tint',-100,100],
  ['fade','Fade',0,100],['sharpen','Sharpen',0,100],['blur','Blur',0,100],['vignette','Vignette',0,100],['grain','Grain',0,100]
];
const DEFAULT_ADJ=Object.fromEntries(ADJ.map(a=>[a[0],0]));
const FILTERS=[
  ['none','Original',{},''],['vivid','Vivid',{contrast:15,saturation:30,vibrance:25},''],['bright','Bright',{exposure:15,shadows:25,highlights:-10},''],
  ['warm','Warm',{warmth:35,saturation:8},''],['cool','Cool',{warmth:-35,tint:-6},''],['fadeF','Faded',{fade:45,contrast:-15,saturation:-15},''],
  ['vintage','Vintage',{fade:35,warmth:22,saturation:-25,vignette:30,grain:15},''],['dramatic','Dramatic',{contrast:35,shadows:-20,highlights:-15,saturation:-10,vignette:35},''],
  ['bw','B & W',{contrast:10},'bw'],['noir','Noir',{contrast:45,exposure:-5,vignette:45,grain:10},'bw'],['sepia','Sepia',{contrast:5,fade:10},'sepia']
];
const ASPECTS=[['free','Free'],['orig','Original'],['1:1','1:1'],['4:3','4:3'],['3:2','3:2'],['16:9','16:9'],['4:5','4:5'],['9:16','9:16']];

const E={name:'photo',original:null,base:null,proxy:null,origProxy:null,adj:{...DEFAULT_ADJ},mode:'',filter:'none',
  hist:[],fut:[],adjDirty:false,tool:'crop',view:null,preview:null,previewKey:'',layout:null,
  crop:null,aspect:'free',straighten:0,drag:null,comparing:false,effectCache:null,
  retouch:{mode:'blur-brush',size:40,strength:50},draw:{mode:'pen',color:'#ff3b30',size:12},text:{value:'',font:'sans',size:60,color:'#ffffff',bg:false,bgColor:'#000000',bold:true,shadow:true},
  hover:null,points:null,busy:false,background:{sample:null,color:'#ffffff',tolerance:32}};

/* ------------------------------------------------------------------ canvas helpers */
function mk(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
function copyCanvas(src){const c=mk(src.width,src.height);c.getContext('2d').drawImage(src,0,0);return c;}
function scaled(src,maxEdge){const k=Math.min(1,maxEdge/Math.max(src.width,src.height));if(k===1)return copyCanvas(src);return stepDown(src,Math.round(src.width*k),Math.round(src.height*k));}
/* High-quality downscale by repeated halving. */
function stepDown(src,w,h){let cur=src;while(cur.width/2>=w&&cur.height/2>=h){const n=mk(cur.width/2,cur.height/2);const x=n.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(cur,0,0,n.width,n.height);cur=n;}const out=mk(w,h);const x=out.getContext('2d');x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(cur,0,0,w,h);return out;}
const isDefault=()=>!E.mode&&ADJ.every(a=>!E.adj[a[0]]);

/* Separable box blur (3 passes ≈ Gaussian). Works on RGBA bytes. */
function boxBlur(src,w,h,r,passes=3){
  if(r<1)return src;let a=new Uint8ClampedArray(src),b=new Uint8ClampedArray(src.length);
  for(let p=0;p<passes;p++){blurH(a,b,w,h,r);blurV(b,a,w,h,r);}return a;
}
function blurH(s,d,w,h,r){const iarr=1/(r+r+1);for(let y=0;y<h;y++){const row=y*w*4;for(let c=0;c<4;c++){let ti=row+c,li=ti,ri=ti+r*4;const fv=s[ti],lv=s[row+(w-1)*4+c];let val=(r+1)*fv;for(let j=0;j<r;j++)val+=s[row+Math.min(j,w-1)*4+c];for(let x=0;x<w;x++){const add=x+r<w?s[ri]:lv;const sub=x-r-1>=0?s[li]:fv;val+=add-sub;d[ti]=val*iarr;ti+=4;if(x+r<w)ri+=4;if(x-r-1>=0)li+=4;}}}}
function blurV(s,d,w,h,r){const iarr=1/(r+r+1),stride=w*4;for(let x=0;x<w;x++){for(let c=0;c<4;c++){const col=x*4+c;let ti=col,li=col,ri=col+r*stride;const fv=s[col],lv=s[col+(h-1)*stride];let val=(r+1)*fv;for(let j=0;j<r;j++)val+=s[col+Math.min(j,h-1)*stride];for(let y=0;y<h;y++){const add=y+r<h?s[ri]:lv;const sub=y-r-1>=0?s[li]:fv;val+=add-sub;d[ti]=val*iarr;ti+=stride;if(y+r<h)ri+=stride;if(y-r-1>=0)li+=stride;}}}}

/* Apply adjustments + filter mode to a canvas; spatial effects scale with the image so the
 * downscaled preview matches the full-resolution export. */
function processCanvas(src,A,mode){
  const w=src.width,h=src.height,long=Math.max(w,h);
  const img=src.getContext('2d').getImageData(0,0,w,h);let d=img.data;
  if(A.blur>0){const r=Math.max(1,Math.round(A.blur/100*0.012*long));d=boxBlur(d,w,h,r);}
  if(A.sharpen>0){const bl=boxBlur(d,w,h,Math.max(1,Math.round(0.0012*long)),1);const k=A.sharpen/100*1.6;for(let i=0;i<d.length;i+=4){d[i]=d[i]+k*(d[i]-bl[i]);d[i+1]=d[i+1]+k*(d[i+1]-bl[i+1]);d[i+2]=d[i+2]+k*(d[i+2]-bl[i+2]);}}
  const em=Math.pow(2,A.exposure/50),br=A.brightness*1.1,cc=A.contrast*2.55,cf=(259*(cc+255))/(255*(259-cc));
  const sh=A.shadows*0.55,hi=A.highlights*0.55,wa=A.warmth*0.45,ti=A.tint*0.45,sat=A.saturation/100,vib=A.vibrance/100,fd=A.fade/100,vg=A.vignette/100,gr=A.grain/100;
  const cx=w/2,cy=h/2;let seed=1234567;const rnd=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return ((seed>>>0)%10000)/10000;};
  for(let y=0,i=0;y<h;y++){
    const dy=(y-cy)/cy;
    for(let x=0;x<w;x++,i+=4){
      let r=d[i]*em+br,g=d[i+1]*em+br,b=d[i+2]*em+br;
      if(cc){r=cf*(r-128)+128;g=cf*(g-128)+128;b=cf*(b-128)+128;}
      if(sh||hi){const L=clamp((0.299*r+0.587*g+0.114*b)/255,0,1);const dl=sh*(1-L)*(1-L)+hi*L*L;r+=dl;g+=dl;b+=dl;}
      if(wa){r+=wa;b-=wa;}if(ti){g-=ti;r+=ti*0.5;b+=ti*0.5;}
      if(sat||vib){const gy=0.299*r+0.587*g+0.114*b;let sf=1+sat;if(vib){const mx=Math.max(r,g,b),mn=Math.min(r,g,b);sf*=1+vib*(1-clamp((mx-mn)/255,0,1));}r=gy+(r-gy)*sf;g=gy+(g-gy)*sf;b=gy+(b-gy)*sf;}
      if(mode==='bw'){const gy=0.299*r+0.587*g+0.114*b;r=g=b=gy;}
      else if(mode==='sepia'){const R=0.393*r+0.769*g+0.189*b,G=0.349*r+0.686*g+0.168*b,B=0.272*r+0.534*g+0.131*b;r=R;g=G;b=B;}
      if(fd){r=r*(1-0.22*fd)+34*fd;g=g*(1-0.22*fd)+30*fd;b=b*(1-0.22*fd)+28*fd;}
      if(vg){const dx=(x-cx)/cx;const dd=(dx*dx+dy*dy)/2;const t=clamp((dd-0.12)/0.88,0,1);const f=1-vg*0.85*t*t*(3-2*t);r*=f;g*=f;b*=f;}
      if(gr){const n=(rnd()-0.5)*gr*70;r+=n;g+=n;b+=n;}
      d[i]=r;d[i+1]=g;d[i+2]=b;
    }
  }
  const out=mk(w,h);const od=new ImageData(d instanceof Uint8ClampedArray?d:new Uint8ClampedArray(d),w,h);out.getContext('2d').putImageData(od,0,0);return out;
}

/* ------------------------------------------------------------------ history */
const snap=()=>({base:E.base,adj:{...E.adj},mode:E.mode,filter:E.filter});
function histLimit(){return E.base&&E.base.width*E.base.height>8e6?8:25;}
function pushHist(){E.hist.push(snap());while(E.hist.length>histLimit())E.hist.shift();E.fut=[];updateButtons();}
function setBase(c){E.base=c;E.proxy=scaled(c,PROXY_EDGE);E.previewKey='';E.effectCache=null;}
function commitBase(c){pushHist();setBase(c);E.crop=null;render();updateInfo();}
function restore(s){if(s.base!==E.base)setBase(s.base);E.adj={...s.adj};E.mode=s.mode;E.filter=s.filter;E.previewKey='';E.crop=null;syncAdjUI();render();updateInfo();updateButtons();}
function undo(){if(!E.hist.length)return;E.fut.push(snap());restore(E.hist.pop());}
function redo(){if(!E.fut.length)return;E.hist.push(snap());restore(E.fut.pop());}
function bake(){if(isDefault())return;const out=processCanvas(E.base,E.adj,E.mode);pushHist();setBase(out);E.adj={...DEFAULT_ADJ};E.mode='';E.filter='none';syncAdjUI();}

/* ------------------------------------------------------------------ rendering */
function getPreview(){
  const key=JSON.stringify([E.adj,E.mode,E.proxy&&E.proxy.width,E.proxy&&E.proxy.height,E.base&&E.base.width]);
  if(E.preview&&key===E.previewKey)return E.preview;
  E.preview=isDefault()?E.proxy:processCanvas(E.proxy,E.adj,E.mode);E.previewKey=key;return E.preview;
}
function layoutFor(iw,ih){
  const cv=E.view,r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  const W=Math.max(10,Math.round(r.width*dpr)),H=Math.max(10,Math.round(r.height*dpr));if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H;}
  const pad=E.tool==='crop'?28*dpr:12*dpr;const s=Math.min((W-pad*2)/iw,(H-pad*2)/ih);
  return {s,ox:(W-iw*s)/2,oy:(H-ih*s)/2,dpr,W,H};
}
let raf=0;function render(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;draw();});}
function draw(){
  if(!E.base||!E.view)return;
  const ctx=E.view.getContext('2d');const bw=E.base.width,bh=E.base.height;
  const L=E.layout=layoutFor(bw,bh);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,L.W,L.H);
  ctx.imageSmoothingQuality='high';
  if(E.comparing){const o=E.origProxy;const k=Math.min(L.W/o.width,L.H/o.height)*0.96;ctx.drawImage(o,(L.W-o.width*k)/2,(L.H-o.height*k)/2,o.width*k,o.height*k);label(ctx,'Original',L);return;}
  const pv=getPreview();
  ctx.save();ctx.translate(L.ox,L.oy);ctx.scale(L.s,L.s);
  if(E.tool==='crop'&&E.straighten){ctx.save();ctx.beginPath();ctx.rect(0,0,bw,bh);ctx.clip();const a=E.straighten*Math.PI/180,k=coverScale(bw,bh,a);ctx.translate(bw/2,bh/2);ctx.rotate(a);ctx.scale(k,k);ctx.drawImage(pv,-bw/2,-bh/2,bw,bh);ctx.restore();}
  else ctx.drawImage(pv,0,0,bw,bh);
  overlay(ctx,bw,bh,L);
  ctx.restore();
}
function label(ctx,t,L){ctx.save();ctx.font=(13*L.dpr)+'px system-ui,sans-serif';const w=ctx.measureText(t).width+16*L.dpr;ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(10*L.dpr,10*L.dpr,w,24*L.dpr);ctx.fillStyle='#fff';ctx.fillText(t,18*L.dpr,27*L.dpr);ctx.restore();}
const coverScale=(w,h,a)=>{const c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return Math.max((w*c+h*s)/w,(w*s+h*c)/h);};
function overlay(ctx,bw,bh,L){
  const px=1/L.s*L.dpr; /* one CSS pixel in image units */
  if(E.tool==='crop'){
    const c=E.crop||{x:0,y:0,w:bw,h:bh};
    ctx.fillStyle='rgba(15,23,42,.55)';ctx.beginPath();ctx.rect(-bw,-bh,bw*3,bh*3);ctx.rect(c.x,c.y,c.w,c.h);ctx.fill('evenodd');
    ctx.strokeStyle='#fff';ctx.lineWidth=2*px;ctx.strokeRect(c.x,c.y,c.w,c.h);
    ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=px;ctx.beginPath();for(let i=1;i<3;i++){ctx.moveTo(c.x+c.w*i/3,c.y);ctx.lineTo(c.x+c.w*i/3,c.y+c.h);ctx.moveTo(c.x,c.y+c.h*i/3);ctx.lineTo(c.x+c.w,c.y+c.h*i/3);}ctx.stroke();
    ctx.fillStyle='#fff';const hs=10*px;cropHandles(c).forEach(([,x,y])=>{ctx.fillRect(x-hs/2,y-hs/2,hs,hs);});
    ctx.font=(12*px)+'px system-ui,sans-serif';const t=Math.round(c.w)+' × '+Math.round(c.h);ctx.fillStyle='rgba(0,0,0,.65)';const tw=ctx.measureText(t).width;ctx.fillRect(c.x+6*px,c.y+6*px,tw+12*px,20*px);ctx.fillStyle='#fff';ctx.fillText(t,c.x+12*px,c.y+20*px);
  }
  if(E.tool==='retouch'){
    if(E.drag&&E.drag.box){const b=normRect(E.drag.box);ctx.strokeStyle='#fff';ctx.setLineDash([6*px,4*px]);ctx.lineWidth=1.5*px;ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.setLineDash([]);}
    if(E.hover&&/brush/.test(E.retouch.mode)){ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=1.5*px;ctx.beginPath();ctx.arc(E.hover.x,E.hover.y,brushRadius(),0,Math.PI*2);ctx.stroke();ctx.strokeStyle='rgba(0,0,0,.6)';ctx.beginPath();ctx.arc(E.hover.x,E.hover.y,brushRadius()+1.5*px,0,Math.PI*2);ctx.stroke();}
  }
  if(E.tool==='draw'){if(E.points)drawShape(ctx,E.draw.mode,E.points,E.draw);else if(E.hover){ctx.fillStyle=E.draw.color;ctx.globalAlpha=.5;ctx.beginPath();ctx.arc(E.hover.x,E.hover.y,drawWidth()/2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}}
  if(E.tool==='text'&&E.hover&&E.text.value.trim())drawText(ctx,E.hover.x,E.hover.y,0.75);
}

/* ------------------------------------------------------------------ crop */
function aspectRatio(){const a=E.aspect;if(a==='free')return null;if(a==='orig')return E.base.width/E.base.height;const [x,y]=a.split(':').map(Number);return x/y;}
function cropHandles(c){return [['nw',c.x,c.y],['n',c.x+c.w/2,c.y],['ne',c.x+c.w,c.y],['e',c.x+c.w,c.y+c.h/2],['se',c.x+c.w,c.y+c.h],['s',c.x+c.w/2,c.y+c.h],['sw',c.x,c.y+c.h],['w',c.x,c.y+c.h/2]];}
function setAspect(a){E.aspect=a;const bw=E.base.width,bh=E.base.height;const r=aspectRatio();let c={x:0,y:0,w:bw,h:bh};if(r){if(bw/bh>r){c.w=bh*r;c.x=(bw-c.w)/2;}else{c.h=bw/r;c.y=(bh-c.h)/2;}}E.crop=c;document.querySelectorAll('#pePanelCrop [data-aspect]').forEach(b=>b.classList.toggle('on',b.dataset.aspect===a));render();}
function cropDrag(p,start){
  const bw=E.base.width,bh=E.base.height,o=start.c,h=start.h;const dx=p.x-start.p.x,dy=p.y-start.p.y;const r=aspectRatio();const min=Math.max(16,Math.min(bw,bh)*0.02);
  let {x,y,w,h:hh}=o;
  if(h==='move'){x=clamp(o.x+dx,0,bw-o.w);y=clamp(o.y+dy,0,bh-o.h);E.crop={x,y,w:o.w,h:o.h};return;}
  let x1=o.x,y1=o.y,x2=o.x+o.w,y2=o.y+o.h;
  if(h.includes('w'))x1=clamp(o.x+dx,0,x2-min);if(h.includes('e'))x2=clamp(x2+dx,x1+min,bw);
  if(h.includes('n'))y1=clamp(o.y+dy,0,y2-min);if(h.includes('s'))y2=clamp(y2+dy,y1+min,bh);
  w=x2-x1;hh=y2-y1;
  if(r){
    if(h==='n'||h==='s'){w=hh*r;}else if(h==='e'||h==='w'){hh=w/r;}else{if(w/hh>r)w=hh*r;else hh=w/r;}
    if(h.includes('w'))x1=x2-w;if(h.includes('n'))y1=y2-hh;
    if(h==='n'||h==='s')x1=o.x+(o.w-w)/2;if(h==='e'||h==='w')y1=o.y+(o.h-hh)/2;
    if(x1<0){x1=0;}if(y1<0){y1=0;}if(x1+w>bw){w=bw-x1;hh=w/r;}if(y1+hh>bh){hh=bh-y1;w=hh*r;}
  }
  E.crop={x:x1,y:y1,w,h:hh};
}
function applyCrop(){
  const bw=E.base.width,bh=E.base.height;const c=E.crop?{x:Math.round(E.crop.x),y:Math.round(E.crop.y),w:Math.round(E.crop.w),h:Math.round(E.crop.h)}:{x:0,y:0,w:bw,h:bh};
  if(!E.straighten&&c.x===0&&c.y===0&&c.w===bw&&c.h===bh)return notify('Drag the crop handles or pick a shape first.');
  let src=E.base;
  if(E.straighten){const a=E.straighten*Math.PI/180,k=coverScale(bw,bh,a);const r=mk(bw,bh);const x=r.getContext('2d');x.imageSmoothingQuality='high';x.translate(bw/2,bh/2);x.rotate(a);x.scale(k,k);x.drawImage(src,-bw/2,-bh/2);src=r;}
  const out=mk(c.w,c.h);out.getContext('2d').drawImage(src,c.x,c.y,c.w,c.h,0,0,c.w,c.h);
  E.straighten=0;$('peStraighten').value=0;$('peStraightenVal').textContent='0°';commitBase(out);E.aspect='free';setAspect('free');
}
function rotate90(dir){const b=E.base;const out=mk(b.height,b.width);const x=out.getContext('2d');x.translate(out.width/2,out.height/2);x.rotate(dir*Math.PI/2);x.drawImage(b,-b.width/2,-b.height/2);commitBase(out);if(E.tool==='crop')setAspect(E.aspect);}
function flip(h){const b=E.base;const out=mk(b.width,b.height);const x=out.getContext('2d');if(h){x.translate(b.width,0);x.scale(-1,1);}else{x.translate(0,b.height);x.scale(1,-1);}x.drawImage(b,0,0);commitBase(out);}

/* ------------------------------------------------------------------ blur / pixelate / redact */
const brushRadius=()=>E.retouch.size/1000*Math.max(E.base.width,E.base.height)*0.6+2;
function effectCanvas(){
  const m=E.retouch.mode;const key=m.split('-')[0]+':'+E.retouch.strength+':'+E.base.width;
  if(E.effectCache&&E.effectCache.key===key&&E.effectCache.src===E.base)return E.effectCache.c;
  const b=E.base,long=Math.max(b.width,b.height);let c;
  if(m.startsWith('pixel')){const block=Math.max(4,Math.round(long*(0.006+E.retouch.strength/100*0.03)));const small=mk(b.width/block,b.height/block);const sx=small.getContext('2d');sx.imageSmoothingQuality='medium';sx.drawImage(b,0,0,small.width,small.height);c=mk(b.width,b.height);const x=c.getContext('2d');x.imageSmoothingEnabled=false;x.drawImage(small,0,0,c.width,c.height);}
  else if(m.startsWith('blur')){const r=Math.max(2,Math.round(long*(0.004+E.retouch.strength/100*0.03)));const d=b.getContext('2d').getImageData(0,0,b.width,b.height);const bl=boxBlur(d.data,b.width,b.height,r);c=mk(b.width,b.height);c.getContext('2d').putImageData(new ImageData(bl,b.width,b.height),0,0);}
  E.effectCache={key,src:E.base,c};return c;
}
function stampEffect(target,clipFn){const x=target.getContext('2d');x.save();x.beginPath();clipFn(x);x.clip();if(E.retouch.mode==='redact-box'){x.fillStyle='#000';x.fillRect(0,0,target.width,target.height);}else x.drawImage(effectCanvas(),0,0);x.restore();}
const normRect=b=>({x:Math.min(b.x1,b.x2),y:Math.min(b.y1,b.y2),w:Math.abs(b.x2-b.x1),h:Math.abs(b.y2-b.y1)});

/* ------------------------------------------------------------------ drawing & text */
const drawWidth=()=>Math.max(1,E.draw.size/1000*Math.max(E.base.width,E.base.height)*(E.draw.mode==='marker'?2.5:1));
function drawShape(ctx,mode,pts,o){
  if(!pts.length)return;ctx.save();ctx.strokeStyle=o.color;ctx.fillStyle=o.color;ctx.lineWidth=drawWidth();ctx.lineCap='round';ctx.lineJoin='round';
  if(mode==='marker')ctx.globalAlpha=.38;
  const a=pts[0],b=pts[pts.length-1];
  if(mode==='pen'||mode==='marker'){ctx.beginPath();ctx.moveTo(a.x,a.y);for(let i=1;i<pts.length-1;i++){const m={x:(pts[i].x+pts[i+1].x)/2,y:(pts[i].y+pts[i+1].y)/2};ctx.quadraticCurveTo(pts[i].x,pts[i].y,m.x,m.y);}ctx.lineTo(b.x,b.y);if(pts.length===1)ctx.lineTo(a.x+0.01,a.y);ctx.stroke();}
  else if(mode==='line'||mode==='arrow'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();if(mode==='arrow'){const ang=Math.atan2(b.y-a.y,b.x-a.x),hl=Math.max(ctx.lineWidth*3.2,12);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-hl*Math.cos(ang-0.45),b.y-hl*Math.sin(ang-0.45));ctx.lineTo(b.x-hl*Math.cos(ang+0.45),b.y-hl*Math.sin(ang+0.45));ctx.closePath();ctx.fill();}}
  else if(mode==='rect'){ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));}
  else if(mode==='ellipse'){ctx.beginPath();ctx.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(b.x-a.x)/2||0.1,Math.abs(b.y-a.y)/2||0.1,0,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
const FONTS={sans:'Inter, "Segoe UI", Roboto, Arial, sans-serif',serif:'Georgia, "Times New Roman", serif',mono:'"Cascadia Code", Consolas, "Courier New", monospace',hand:'"Segoe Print", "Comic Sans MS", "Bradley Hand", cursive',impact:'Impact, "Arial Black", "Helvetica Neue", sans-serif'};
function textPx(){return E.text.size/1000*Math.max(E.base.width,E.base.height);}
function drawText(ctx,cx,cy,alpha=1){
  const t=E.text;const lines=t.value.replace(/\r/g,'').split('\n');const fs=textPx();
  ctx.save();ctx.globalAlpha=alpha;ctx.font=(t.bold?'700 ':'400 ')+fs+'px '+(FONTS[t.font]||FONTS.sans);ctx.textAlign='center';ctx.textBaseline='middle';
  const lh=fs*1.18;const widths=lines.map(l=>ctx.measureText(l).width);const bw=Math.max(...widths),bh=lh*lines.length;
  if(t.bg){const pad=fs*0.35;ctx.fillStyle=t.bgColor;ctx.globalAlpha=alpha*0.82;roundRect(ctx,cx-bw/2-pad,cy-bh/2-pad*0.7,bw+pad*2,bh+pad*1.4,pad*0.6);ctx.fill();ctx.globalAlpha=alpha;}
  if(t.shadow&&!t.bg){ctx.shadowColor='rgba(0,0,0,.55)';ctx.shadowBlur=fs*0.12;ctx.shadowOffsetY=fs*0.04;}
  ctx.fillStyle=t.color;lines.forEach((l,i)=>ctx.fillText(l,cx,cy-bh/2+lh*(i+0.5)));
  ctx.restore();
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

/* ------------------------------------------------------------------ pointer handling */
function toImg(e){const L=E.layout;const r=E.view.getBoundingClientRect();return {x:((e.clientX-r.left)*L.dpr-L.ox)/L.s,y:((e.clientY-r.top)*L.dpr-L.oy)/L.s};}
function hitHandle(p){const c=E.crop||{x:0,y:0,w:E.base.width,h:E.base.height};const tol=14*E.layout.dpr/E.layout.s;for(const [k,x,y] of cropHandles(c))if(Math.abs(p.x-x)<tol&&Math.abs(p.y-y)<tol)return k;if(p.x>c.x&&p.x<c.x+c.w&&p.y>c.y&&p.y<c.y+c.h)return 'move';return null;}
const CURSORS={nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',move:'move'};
function onDown(e){
  if(!E.base||e.button!==0||E.busy)return;const p=toImg(e);E.view.setPointerCapture(e.pointerId);
  if(E.tool==='background'){sampleBackground(p);return;}
  if(E.tool==='crop'){const h=hitHandle(p);if(h){if(!E.crop)E.crop={x:0,y:0,w:E.base.width,h:E.base.height};E.drag={h,p,c:{...E.crop}};}return;}
  if(E.tool==='retouch'){
    if(/brush/.test(E.retouch.mode)){const work=copyCanvas(E.base);E.drag={work,last:p};setBusyCursor(true);paintBrush(p,p);}
    else E.drag={box:{x1:p.x,y1:p.y,x2:p.x,y2:p.y}};render();return;}
  if(E.tool==='draw'){E.points=[p];render();return;}
  if(E.tool==='text'){if(!E.text.value.trim()){notify('Type your text in the panel first.',true);$('peTextValue').focus();return;}const out=copyCanvas(E.base);drawText(out.getContext('2d'),p.x,p.y);commitBase(out);return;}
}
function onMove(e){
  if(!E.base)return;const p=toImg(e);
  if(E.tool==='crop'){if(E.drag){cropDrag(p,E.drag);render();}else E.view.style.cursor=CURSORS[hitHandle(p)]||'default';return;}
  E.hover=p;
  if(E.tool==='retouch'&&E.drag){if(E.drag.work){paintBrush(E.drag.last,p);E.drag.last=p;}else{E.drag.box.x2=p.x;E.drag.box.y2=p.y;}}
  if(E.tool==='draw'&&E.points){if(E.draw.mode==='pen'||E.draw.mode==='marker'){const l=E.points[E.points.length-1];if(Math.hypot(p.x-l.x,p.y-l.y)>1/E.layout.s)E.points.push(p);}else E.points=[E.points[0],p];}
  render();
}
function onUp(){
  if(!E.base)return;const d=E.drag;E.drag=null;
  if(E.tool==='crop'){render();return;}
  if(E.tool==='retouch'&&d){
    if(d.work){setBusyCursor(false);const prev=E.base;E.base=prev;pushHist();setBase(d.work);render();}
    else{const b=normRect(d.box);if(b.w>3&&b.h>3){const out=copyCanvas(E.base);stampEffect(out,x=>x.rect(b.x,b.y,b.w,b.h));commitBase(out);}else render();}
    return;}
  if(E.tool==='draw'&&E.points){const pts=E.points;E.points=null;const out=copyCanvas(E.base);drawShape(out.getContext('2d'),E.draw.mode,pts,E.draw);commitBase(out);}
}
function paintBrush(a,b){
  const r=brushRadius();const work=E.drag.work;const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(r/3)));
  stampEffect(work,x=>{for(let i=0;i<=steps;i++){const t=i/steps;const cx=a.x+(b.x-a.x)*t,cy=a.y+(b.y-a.y)*t;x.moveTo(cx+r,cy);x.arc(cx,cy,r,0,Math.PI*2);}});
  /* refresh the preview cheaply: only the brushed area of the proxy */
  const k=E.proxy.width/work.width;const x0=Math.max(0,Math.min(a.x,b.x)-r-2),y0=Math.max(0,Math.min(a.y,b.y)-r-2),x1=Math.min(work.width,Math.max(a.x,b.x)+r+2),y1=Math.min(work.height,Math.max(a.y,b.y)+r+2);
  E.proxy.getContext('2d').drawImage(work,x0,y0,x1-x0,y1-y0,x0*k,y0*k,(x1-x0)*k,(y1-y0)*k);E.previewKey='';
}
function setBusyCursor(on){E.view.style.cursor=on?'crosshair':'';}

/* Color-based background replacement. This intentionally stays local and opt-in:
 * sample a background colour, tune tolerance, preview the selected sample, then apply.
 * Similar colours anywhere in the image can also be replaced; this is not AI segmentation. */
function sampleBackground(p){
  const x=clamp(Math.floor(p.x),0,E.base.width-1),y=clamp(Math.floor(p.y),0,E.base.height-1);
  const d=E.base.getContext('2d').getImageData(x,y,1,1).data;
  E.background.sample=[d[0],d[1],d[2]];
  const hex='#'+E.background.sample.map(v=>v.toString(16).padStart(2,'0')).join('');
  const swatch=$('peBgSample');if(swatch){swatch.style.background=hex;swatch.textContent='Sampled '+hex;swatch.style.color=(d[0]*.299+d[1]*.587+d[2]*.114)>150?'#111827':'#ffffff';}
  const status=$('peBgSampleStatus');if(status)status.textContent='Sampled RGB '+E.background.sample.join(', ')+'. Choose a replacement colour, then apply.';
  render();
}
function applyBackgroundReplacement(){
  if(!E.base||!E.background.sample){notify('Click a background area in the photo to sample its colour first.',true);return;}
  const b=E.base,w=b.width,h=b.height,n=w*h,tol=E.background.tolerance,src=E.background.sample;
  if(n>MAX_PIXELS){notify('This image exceeds the editor pixel limit.',true);return;}
  setBusy(true,'Replacing sampled background colour…');
  setTimeout(()=>{
    try{
      const out=copyCanvas(b),ctx=out.getContext('2d'),im=ctx.getImageData(0,0,w,h),d=im.data;
      const rgb=$('peBgReplaceColor').value||'#ffffff';
      const rr=parseInt(rgb.slice(1,3),16),gg=parseInt(rgb.slice(3,5),16),bb=parseInt(rgb.slice(5,7),16);
      const limit=tol*tol*3;
      for(let i=0;i<d.length;i+=4){
        const dr=d[i]-src[0],dg=d[i+1]-src[1],db=d[i+2]-src[2],dist=dr*dr+dg*dg+db*db;
        if(dist<=limit){
          // Blend near the tolerance boundary to soften colour fringes.
          const blend=tol===0?1:clamp((tol+1-Math.sqrt(dist/3))/Math.max(1,tol*0.25),0,1);
          d[i]=Math.round(d[i]*(1-blend)+rr*blend);d[i+1]=Math.round(d[i+1]*(1-blend)+gg*blend);d[i+2]=Math.round(d[i+2]*(1-blend)+bb*blend);
        }
      }
      ctx.putImageData(im,0,0);commitBase(out);
      notify('Background colour replaced. Use Undo if the result affects the subject.');
    }catch(e){notify('Background replacement failed: '+e.message,true);}
    finally{setBusy(false);}
  },20);
}

/* ------------------------------------------------------------------ resize & export */
function applyResize(){
  const w=Math.round(+$('peW').value),h=Math.round(+$('peH').value);
  if(!(w>0&&h>0))return notify('Enter a width and height.',true);
  if(w*h>MAX_PIXELS)return notify('That size is too large for the browser (max about 16 megapixels).',true);
  if(w===E.base.width&&h===E.base.height)return;
  bake();const out=w<E.base.width?stepDown(E.base,w,h):(()=>{const c=mk(w,h);const x=c.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(E.base,0,0,w,h);return c;})();
  commitBase(out);
}
let avifOK=null;function supportsAvif(){if(avifOK==null){try{avifOK=mk(2,2).toDataURL('image/avif').startsWith('data:image/avif');}catch(_){avifOK=false;}}return avifOK;}
function finalCanvas(){return isDefault()?E.base:processCanvas(E.base,E.adj,E.mode);}
function exportBlob(){
  const fmt=$('peFormat').value;const q=+$('peQuality').value/100;const mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif'}[fmt];
  let c=finalCanvas();
  if(fmt==='jpeg'){const f=mk(c.width,c.height);const x=f.getContext('2d');x.fillStyle=$('peBg').value||'#ffffff';x.fillRect(0,0,f.width,f.height);x.drawImage(c,0,0);c=f;}
  return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('This browser cannot encode '+fmt.toUpperCase()+'.')),mime,fmt==='png'?undefined:q));
}
async function download(){
  try{setBusy(true,'Preparing download…');await tick();const b=await exportBlob();const ext={jpeg:'jpg',png:'png',webp:'webp',avif:'avif'}[$('peFormat').value];
    const name=($('peFileName').value.trim()||E.name+'-edited').replace(/[\\/:*?"<>|]+/g,'_').replace(/\.(jpe?g|png|webp|avif)$/i,'')+'.'+ext;
    const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);
    notify('Saved '+name+' ('+fmtSize(b.size)+'). Camera and location metadata were not included.');
  }catch(e){notify('Export failed: '+e.message,true);}finally{setBusy(false);}
}
async function copyToClipboard(){
  try{if(!navigator.clipboard||typeof ClipboardItem!=='function')throw new Error('Clipboard images are not supported in this browser.');setBusy(true,'Copying…');await tick();const c=finalCanvas();const b=await new Promise(r=>c.toBlob(r,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':b})]);notify('Image copied to the clipboard.');}
  catch(e){notify('Copy failed: '+e.message,true);}finally{setBusy(false);}
}
const estimate=(()=>{let t;return()=>{clearTimeout(t);t=setTimeout(async()=>{if(!E.base)return;const el=$('peEstimate');el.textContent='Estimating…';try{const b=await exportBlob();el.textContent='≈ '+fmtSize(b.size)+' • '+E.base.width+' × '+E.base.height+' px';}catch(e){el.textContent=e.message;}},450);};})();
const tick=()=>new Promise(r=>setTimeout(r,30));
function setBusy(on,msg){E.busy=on;const b=$('peBusy');if(b){b.hidden=!on;b.textContent=msg||'Working…';}}

/* ------------------------------------------------------------------ loading */
async function decode(file){
  if(typeof createImageBitmap==='function'){try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch(_){}}
  const url=URL.createObjectURL(file);try{return await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode'));i.src=url;});}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
async function openFile(file){
  if(!file)return;
  if(!/^image\//.test(file.type)&&!/\.(jpe?g|png|webp|avif|gif|bmp|svg|heic|heif|tiff?)$/i.test(file.name))return notify('Choose an image file.',true);
  if(E.base&&E.hist.length&&!confirm('Open '+file.name+'? Unsaved edits to the current photo will be lost.'))return;
  setBusy(true,'Opening…');
  try{
    let img;try{img=await decode(file);}catch(_){throw new Error(/hei[cf]|tiff?/i.test(file.name)?'This browser cannot decode '+file.name.split('.').pop().toUpperCase()+'. Convert it to JPG/PNG with the Native Image Format Bridge above, then open it here.':'This image could not be decoded.');}
    let w=img.width||img.naturalWidth,h=img.height||img.naturalHeight;if(!w||!h)throw new Error('This image has no size (an SVG without width/height?).');
    let k=1;if(w*h>MAX_PIXELS){k=Math.sqrt(MAX_PIXELS/(w*h));notify('Large photo ('+w+'×'+h+') — working at '+Math.round(w*k)+'×'+Math.round(h*k)+' to stay within browser limits.');}
    const c=mk(w*k,h*k);const x=c.getContext('2d');x.imageSmoothingQuality='high';x.drawImage(img,0,0,c.width,c.height);img.close?.();
    E.name=file.name.replace(/\.[^.]+$/,'')||'photo';E.original=c;E.origProxy=scaled(c,PROXY_EDGE);E.hist=[];E.fut=[];E.adj={...DEFAULT_ADJ};E.mode='';E.filter='none';E.straighten=0;E.aspect='free';
    setBase(copyCanvas(c));
    $('peDrop').hidden=true;$('peApp').hidden=false;$('peFileName').value=E.name+'-edited';
    const fmt=/png$/i.test(file.type)?'png':/webp/i.test(file.type)?'webp':'jpeg';$('peFormat').value=fmt;syncFormatUI();
    syncAdjUI();buildFilterThumbs();setTool('crop');updateInfo();updateButtons();
    requestAnimationFrame(()=>{render();});
  }catch(e){notify(e.message,true);}
  finally{setBusy(false);}
}

/* ------------------------------------------------------------------ UI */
function setTool(t){
  if(!E.base)return;
  if((E.tool==='adjust'||E.tool==='filters')&&t!=='adjust'&&t!=='filters'&&!isDefault()){setBusy(true,'Applying adjustments…');bake();setBusy(false);}
  if(E.tool==='crop'&&t!=='crop'&&(E.straighten||E.crop&&(E.crop.w<E.base.width-1||E.crop.h<E.base.height-1))){E.straighten=0;$('peStraighten').value=0;$('peStraightenVal').textContent='0°';}
  E.tool=t;E.crop=null;E.drag=null;E.points=null;E.hover=null;
  document.querySelectorAll('#peApp [data-pe-tool]').forEach(b=>{const on=b.dataset.peTool===t;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
  document.querySelectorAll('#peApp [data-pe-panel]').forEach(p=>p.hidden=p.dataset.pePanel!==t);
  E.view.style.cursor=t==='crop'?'default':t==='text'?'copy':'crosshair';
  if(t==='crop')setAspect(E.aspect||'free');
  if(t==='filters')buildFilterThumbs();
  if(t==='export'){$('peW').value=E.base.width;$('peH').value=E.base.height;estimate();}
  render();
}
function updateInfo(){const i=$('peInfo');if(i&&E.base)i.textContent=E.base.width+' × '+E.base.height+' px';}
function updateButtons(){$('peUndo').disabled=!E.hist.length;$('peRedo').disabled=!E.fut.length;}
function syncAdjUI(){ADJ.forEach(([k])=>{const s=$('peAdj-'+k);if(s){s.value=E.adj[k];$('peAdjV-'+k).textContent=E.adj[k];}});document.querySelectorAll('#peFilters [data-filter]').forEach(b=>b.classList.toggle('on',b.dataset.filter===E.filter));}
function buildAdjust(){
  const box=$('peAdjList');box.innerHTML=ADJ.map(([k,l,mn,mx])=>'<label class="pe-slider"><span>'+l+'<b id="peAdjV-'+k+'">0</b></span><input type="range" id="peAdj-'+k+'" min="'+mn+'" max="'+mx+'" value="0" aria-label="'+l+'"></label>').join('');
  ADJ.forEach(([k])=>{const s=$('peAdj-'+k);
    s.addEventListener('input',()=>{if(!E.adjDirty){pushHist();E.adjDirty=true;}E.adj[k]=+s.value;$('peAdjV-'+k).textContent=s.value;render();});
    s.addEventListener('change',()=>{E.adjDirty=false;});
    s.addEventListener('dblclick',()=>{if(E.adj[k]){pushHist();E.adj[k]=0;syncAdjUI();render();}});});
}
let thumbSrc=null;
function buildFilterThumbs(){
  const box=$('peFilters');if(!E.base){box.innerHTML='';return;}
  thumbSrc=scaled(E.base,140);
  box.innerHTML=FILTERS.map(([id,label])=>'<button type="button" class="pe-filter'+(E.filter===id?' on':'')+'" data-filter="'+id+'" data-action="filter-'+id+'"><canvas width="'+thumbSrc.width+'" height="'+thumbSrc.height+'"></canvas><span>'+label+'</span></button>').join('');
  box.querySelectorAll('[data-filter]').forEach(b=>{const f=FILTERS.find(x=>x[0]===b.dataset.filter);const t=f[0]==='none'?thumbSrc:processCanvas(thumbSrc,{...DEFAULT_ADJ,...f[2]},f[3]);b.querySelector('canvas').getContext('2d').drawImage(t,0,0);
    b.onclick=()=>{pushHist();E.filter=f[0];E.adj={...DEFAULT_ADJ,...f[2]};E.mode=f[3];syncAdjUI();render();};});
}
function syncFormatUI(){const f=$('peFormat').value;$('peQualityRow').hidden=f==='png';$('peBgRow').hidden=f!=='jpeg';estimate();}
function wire(){
  const input=$('peInput');if(!input||input.dataset.peWired)return;input.dataset.peWired='1';
  E.view=$('peCanvas');buildAdjust();
  if(!supportsAvif())$('peFormat').querySelector('option[value="avif"]')?.remove();
  input.addEventListener('change',()=>{openFile(input.files?.[0]);input.value='';});
  const drop=$('peDrop');drop.addEventListener('dragover',e=>e.preventDefault());drop.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();openFile(e.dataTransfer?.files?.[0]);});
  const stage=$('peStage');stage.addEventListener('dragover',e=>e.preventDefault());stage.addEventListener('drop',e=>{e.preventDefault();openFile(e.dataTransfer?.files?.[0]);});
  E.view.addEventListener('pointerdown',onDown);E.view.addEventListener('pointermove',onMove);E.view.addEventListener('pointerup',onUp);E.view.addEventListener('pointercancel',onUp);
  E.view.addEventListener('pointerleave',()=>{if(!E.drag&&!E.points){E.hover=null;render();}});
  document.querySelectorAll('#peApp [data-pe-tool]').forEach(b=>{b.onclick=()=>setTool(b.dataset.peTool);});
  $('peUndo').onclick=undo;$('peRedo').onclick=redo;
  $('peReset').onclick=()=>{if(!E.original)return;if(!confirm('Discard all edits and go back to the original photo?'))return;pushHist();setBase(copyCanvas(E.original));E.adj={...DEFAULT_ADJ};E.mode='';E.filter='none';syncAdjUI();setTool('crop');updateInfo();};
  $('peNew').onclick=()=>{if(E.hist.length&&!confirm('Close this photo? Unsaved edits will be lost.'))return;E.base=null;E.hist=[];E.fut=[];$('peApp').hidden=true;$('peDrop').hidden=false;};
  $('peDownload').onclick=download;$('peDownload2').onclick=download;$('peCopy').onclick=copyToClipboard;
  const cmp=$('peCompare');const on=e=>{e.preventDefault();E.comparing=true;render();},off=()=>{if(E.comparing){E.comparing=false;render();}};
  cmp.addEventListener('pointerdown',on);cmp.addEventListener('pointerup',off);cmp.addEventListener('pointerleave',off);cmp.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter')on(e);});cmp.addEventListener('keyup',off);
  /* crop */
  $('pePanelCrop').querySelectorAll('[data-aspect]').forEach(b=>b.onclick=()=>setAspect(b.dataset.aspect));
  $('peRotL').onclick=()=>rotate90(-1);$('peRotR').onclick=()=>rotate90(1);$('peFlipH').onclick=()=>flip(true);$('peFlipV').onclick=()=>flip(false);
  $('peStraighten').addEventListener('input',e=>{E.straighten=+e.target.value;$('peStraightenVal').textContent=e.target.value+'°';render();});
  $('peStraighten').addEventListener('dblclick',e=>{e.target.value=0;E.straighten=0;$('peStraightenVal').textContent='0°';render();});
  $('peApplyCrop').onclick=applyCrop;$('peCancelCrop').onclick=()=>{E.straighten=0;$('peStraighten').value=0;$('peStraightenVal').textContent='0°';setAspect('free');};
  /* adjust */
  $('peAdjReset').onclick=()=>{if(isDefault())return;pushHist();E.adj={...DEFAULT_ADJ};E.mode='';E.filter='none';syncAdjUI();render();};
  $('peAuto').onclick=autoEnhance;
  /* background colour replacement */
  $('peBgTolerance').addEventListener('input',e=>{E.background.tolerance=+e.target.value;$('peBgToleranceVal').textContent=e.target.value;});
  $('peApplyBackground').onclick=applyBackgroundReplacement;
  $('peResetBackgroundSample').onclick=()=>{E.background.sample=null;$('peBgSample').textContent='No colour sampled — click the photo';$('peBgSample').style.background='#f1f5f9';$('peBgSample').style.color='#334155';$('peBgSampleStatus').textContent='Choose a background area in the image to begin.';};
  /* retouch */
  $('pePanelRetouch').querySelectorAll('[data-retouch]').forEach(b=>b.onclick=()=>{E.retouch.mode=b.dataset.retouch;$('pePanelRetouch').querySelectorAll('[data-retouch]').forEach(x=>x.classList.toggle('on',x===b));$('peRetouchSizeRow').hidden=!/brush/.test(E.retouch.mode);$('peRetouchStrengthRow').hidden=E.retouch.mode==='redact-box';render();});
  $('peRetouchSize').addEventListener('input',e=>{E.retouch.size=+e.target.value;render();});
  $('peRetouchStrength').addEventListener('input',e=>{E.retouch.strength=+e.target.value;E.effectCache=null;});
  /* draw */
  $('pePanelDraw').querySelectorAll('[data-draw]').forEach(b=>b.onclick=()=>{E.draw.mode=b.dataset.draw;$('pePanelDraw').querySelectorAll('[data-draw]').forEach(x=>x.classList.toggle('on',x===b));});
  $('peDrawColor').addEventListener('input',e=>{E.draw.color=e.target.value;});$('peDrawSize').addEventListener('input',e=>{E.draw.size=+e.target.value;render();});
  /* text */
  const tx=E.text;$('peTextValue').addEventListener('input',e=>{tx.value=e.target.value;});$('peTextFont').onchange=e=>{tx.font=e.target.value;};$('peTextSize').addEventListener('input',e=>{tx.size=+e.target.value;render();});
  $('peTextColor').addEventListener('input',e=>{tx.color=e.target.value;});$('peTextBold').onchange=e=>{tx.bold=e.target.checked;};$('peTextShadow').onchange=e=>{tx.shadow=e.target.checked;};$('peTextBg').onchange=e=>{tx.bg=e.target.checked;};$('peTextBgColor').addEventListener('input',e=>{tx.bgColor=e.target.value;});
  /* export */
  const lock=$('peLock');
  $('peW').addEventListener('input',()=>{if(lock.checked&&E.base)$('peH').value=Math.max(1,Math.round(+$('peW').value*E.base.height/E.base.width));});
  $('peH').addEventListener('input',()=>{if(lock.checked&&E.base)$('peW').value=Math.max(1,Math.round(+$('peH').value*E.base.width/E.base.height));});
  $('pePanelExport').querySelectorAll('[data-scale]').forEach(b=>b.onclick=()=>{const v=b.dataset.scale;let w;if(v.endsWith('%'))w=Math.round(E.base.width*parseFloat(v)/100);else{const long=+v;const k=long/Math.max(E.base.width,E.base.height);w=Math.round(E.base.width*k);}$('peW').value=w;$('peH').value=Math.max(1,Math.round(w*E.base.height/E.base.width));});
  $('peApplyResize').onclick=()=>{setBusy(true,'Resizing…');setTimeout(()=>{try{applyResize();}finally{setBusy(false);$('peW').value=E.base.width;$('peH').value=E.base.height;estimate();}},20);};
  $('peFormat').onchange=syncFormatUI;$('peQuality').addEventListener('input',e=>{$('peQualityVal').textContent=e.target.value+'%';estimate();});$('peBg').addEventListener('input',estimate);
  /* keyboard + paste */
  document.addEventListener('keydown',e=>{
    const panel=$('tabImages');if(!E.base||!panel?.classList.contains('active')||$('peApp').hidden)return;
    const el=document.activeElement;if(el&&(el.tagName==='TEXTAREA'||(el.tagName==='INPUT'&&!/range|checkbox|color|radio/.test(el.type))||el.isContentEditable))return;
    if(!$('peApp').contains(el)&&el!==document.body)return;
    const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
    if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if(mod&&k==='y'){e.preventDefault();redo();}
    else if(e.key==='Enter'&&E.tool==='crop'){e.preventDefault();applyCrop();}
    else if(e.key==='Escape'&&E.tool==='crop'){setAspect('free');}
  });
  document.addEventListener('paste',e=>{const panel=$('tabImages');if(!panel?.classList.contains('active'))return;const el=document.activeElement;if(el&&(el.tagName==='TEXTAREA'||el.tagName==='INPUT'))return;const f=[...(e.clipboardData?.files||[])].find(x=>/^image\//.test(x.type));if(f&&($('peApp').contains(el)||!$('peApp').hidden||$('peDrop').matches(':hover'))){e.preventDefault();openFile(f);}});
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>render()).observe(stage);
}
/* One-click auto enhance: stretch levels toward a healthy histogram and add a little colour. */
function autoEnhance(){
  const p=scaled(E.base,400);const d=p.getContext('2d').getImageData(0,0,p.width,p.height).data;const hist=new Uint32Array(256);let n=0,sat=0;
  for(let i=0;i<d.length;i+=4){const L=Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]);hist[L]++;n++;const mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);sat+=(mx-mn)/255;}
  const pct=q=>{let acc=0;for(let v=0;v<256;v++){acc+=hist[v];if(acc>=n*q)return v;}return 255;};
  const lo=pct(0.01),hi=pct(0.99),mid=pct(0.5);sat/=n;
  pushHist();
  E.adj={...E.adj,exposure:clamp(Math.round((128-mid)/3),-35,35),contrast:clamp(Math.round((255-(hi-lo))/4),0,35),shadows:clamp(Math.round((60-lo)/2),0,30),highlights:clamp(Math.round((hi-235)/-2),-25,0),vibrance:sat<0.25?20:8};
  E.filter='none';syncAdjUI();render();notify('Auto enhance applied — fine-tune with the sliders.');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);else wire();
window.OMNI_PHOTO_EDITOR={openFile,setTool,undo,redo,exportBlob,applyCrop,rotate90,flip,autoEnhance,
  _test:{state:()=>E,setCrop:c=>{E.crop=c;},setAdj:a=>{pushHist();Object.assign(E.adj,a);syncAdjUI();render();},processCanvas,applyResize,bake,stroke:(mode,pts)=>{E.retouch.mode=mode;const work=copyCanvas(E.base);E.drag={work,last:pts[0]};for(let i=1;i<pts.length;i++){paintBrush(pts[i-1],pts[i]);}pushHist();setBase(work);E.drag=null;render();},box:(mode,b)=>{E.retouch.mode=mode;const out=copyCanvas(E.base);stampEffect(out,x=>x.rect(b.x,b.y,b.w,b.h));commitBase(out);},text:(v,x,y)=>{E.text.value=v;const out=copyCanvas(E.base);drawText(out.getContext('2d'),x,y);commitBase(out);}}};
})();
