/* Redmark Forge — Diagram Forge (v2)
 * Browser-only diagram studio: an SVG canvas editor plus Mermaid text diagrams.
 * Engines (loaded on demand through omni_vendor_loader.js, local vendor/ first):
 *   Mermaid (MIT)      text → diagram rendering
 *   dagre (MIT)        automatic graph layout for canvas diagrams and Mermaid → Canvas
 * Interoperability: native JSON project, draw.io/diagrams.net .drawio import/export (open mxGraph
 * XML format), Mermaid .mmd, SVG and PNG export. The canvas editor is Redmark Forge's own code.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const root=()=>$('tabDiagramForge');
const isActive=()=>!!root()?.classList.contains('active');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const clone=x=>JSON.parse(JSON.stringify(x));
const notify=(m,e=false)=>{try{if(typeof window.omniNotify==='function')return window.omniNotify(m,e);}catch(_){}(e?console.warn:console.log)('[Diagram Forge] '+m);};
const lib=n=>window.OMNI_VENDOR?window.OMNI_VENDOR.load(n):Promise.reject(new Error('Library loader (omni_vendor_loader.js) is missing.'));
const store={get(k){try{return localStorage.getItem(k);}catch(_){return null;}},set(k,v){try{localStorage.setItem(k,v);return true;}catch(_){return false;}}};
const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);};};
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);}
const typing=el=>!!el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable);

/* ---------------------------------------------------------------- templates */
const TEMPLATES={
 flowchart:'flowchart LR\n  A[Start] --> B{Valid input?}\n  B -->|Yes| C[Process order]\n  B -->|No| D[Show error]\n  C --> E[(Database)]\n  C --> F([Done])\n  D --> A',
 flowchartTD:'flowchart TD\n  Client[Browser client] --> API[API gateway]\n  API --> Auth{{Auth service}}\n  API --> Data[Data service]\n  Data --> DB[(PostgreSQL)]\n  Data --> Cache[(Redis cache)]',
 sequence:'sequenceDiagram\n  autonumber\n  participant U as User\n  participant A as Application\n  participant DB as Database\n  U->>A: Request\n  A->>DB: Query\n  DB-->>A: Result\n  alt found\n    A-->>U: 200 OK\n  else missing\n    A-->>U: 404 Not found\n  end',
 class:'classDiagram\n  class Customer {\n    +int id\n    +string name\n    +placeOrder() Order\n  }\n  class Order {\n    +int id\n    +decimal amount\n    +submit()\n  }\n  Customer "1" --> "*" Order : places',
 state:'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start\n  Processing --> Complete : success\n  Processing --> Failed : error\n  Failed --> Idle : retry\n  Complete --> [*]',
 er:'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  PRODUCT ||--o{ LINE_ITEM : "ordered in"\n  CUSTOMER {\n    int id PK\n    string name\n  }\n  ORDER {\n    int id PK\n    int customer_id FK\n    decimal amount\n  }',
 mindmap:'mindmap\n  root((Redmark Forge))\n    Data\n      CSV\n      SQL\n      JSON\n    Engineering\n      ETL\n      APIs\n    Documentation\n      Architecture\n      Processes',
 architecture:'architecture-beta\n  group app(cloud)[Application]\n  service web(server)[Web] in app\n  service api(server)[API] in app\n  service db(database)[Database] in app\n  web:R -- L:api\n  api:R -- L:db',
 c4:'C4Context\n  title System context\n  Person(user, "User")\n  System(app, "Redmark Forge")\n  SystemDb(db, "Browser storage")\n  Rel(user, app, "uses")\n  Rel(app, db, "stores locally")',
 gantt:'gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design      :done,   d1, 2026-10-01, 3d\n  Development :active, d2, after d1, 7d\n  Testing     :        d3, after d2, 4d',
 timeline:'timeline\n  title Product timeline\n  2026 : Research\n       : Prototype\n  2027 : Launch\n       : Scale',
 git:'gitGraph\n  commit id: "Initial"\n  branch develop\n  checkout develop\n  commit id: "Feature"\n  checkout main\n  merge develop tag: "v1.0"',
 pie:'pie title Where files are processed\n  "Browser" : 60\n  "Local Engine" : 25\n  "Other" : 15',
 journey:'journey\n  title User journey\n  section Discover\n    Search: 5: User\n    Compare: 4: User\n  section Use\n    Create: 5: User\n    Export: 5: User',
 requirement:'requirementDiagram\n  requirement checkout_req {\n    id: 1\n    text: Orders must be payable online.\n    risk: high\n    verifymethod: test\n  }\n  element checkout_service {\n    type: service\n  }\n  checkout_service - satisfies -> checkout_req',
 sankey:'sankey-beta\nBrowser,Editor,60\nEditor,Export,35\nEditor,Storage,25',
 quadrant:'quadrantChart\n  title Priority matrix\n  x-axis Low effort --> High effort\n  y-axis Low value --> High value\n  quadrant-1 Strategic\n  quadrant-2 Quick wins\n  quadrant-3 Defer\n  quadrant-4 Reconsider\n  Feature A: [0.8, 0.7]\n  Feature B: [0.3, 0.6]',
 xychart:'xychart-beta\n  title "Weekly activity"\n  x-axis [Mon, Tue, Wed, Thu, Fri]\n  y-axis "Tasks" 0 --> 10\n  bar [3, 5, 4, 8, 7]\n  line [2, 4, 6, 7, 9]',
 packet:'packet-beta\n  0-15: "Source port"\n  16-31: "Destination port"\n  32-63: "Sequence number"',
 block:'block-beta\n  columns 3\n  A["Client"] B["API"] C["Database"]\n  A --> B\n  B --> C',
 kanban:'kanban\n  todo[To do]\n    t1[Write spec]\n  doing[In progress]\n    t2[Build editor]\n  done[Done]\n    t3[Ship v1]',
 eventmodeling:'flowchart LR\n  C[/Command/] --> E[Event] --> R[(Read model)]\n  E --> P{{Policy}} --> C'
};

/* ---------------------------------------------------------------- state */
const STORE_KEY='redmark-forge-diagram-v4',LEGACY_KEY='redmark-forge-diagram';
const DEFAULT_NODE={fill:'#ffffff',stroke:'#475569',color:'#0f172a',fontSize:15,sw:1.5,dash:'',bold:false};
const SHAPE_DEFAULTS={sticky:{fill:'#fef3a2',stroke:'#d4a72c',w:180,h:120},text:{fill:'none',stroke:'none',w:180,h:40,fontSize:18},diamond:{w:150,h:90,fill:'#fff7ed',stroke:'#f97316'},ellipse:{w:140,h:80},cylinder:{w:120,h:90,fill:'#ecfeff',stroke:'#0891b2'},hexagon:{w:160,h:80},parallelogram:{w:170,h:70},document:{w:160,h:80},round:{w:160,h:70}};
let doc=blankDoc();
let selN=[],selE=null,tool='select',drag=null,hoverNode=null,history=[],future=[],clip=null,spaceDown=false,editor=null,guides=[];
let svg=null,wrap=null,mode='canvas',dirty=false,docName='Untitled diagram',fileHandleName=null;
function blankDoc(){return {version:4,nodes:[],edges:[],view:{zoom:1,pan:{x:40,y:40}},grid:true,snap:true,mermaid:{type:'flowchart',code:TEMPLATES.flowchart,theme:'default'}};}
function starterDoc(){const d=blankDoc();const a=mkNode('round',80,80,'Start'),b=mkNode('diamond',320,70,'Decision?'),c=mkNode('rect',560,80,'Process');d.nodes=[a,b,c];d.edges=[mkEdge(a.id,b.id),mkEdge(b.id,c.id,'yes')];return d;}
function mkNode(shape,x,y,label){const sd=SHAPE_DEFAULTS[shape]||{};return {id:uid('n'),shape,x,y,w:sd.w||160,h:sd.h||70,label:label??'',...DEFAULT_NODE,fill:sd.fill||DEFAULT_NODE.fill,stroke:sd.stroke||DEFAULT_NODE.stroke,fontSize:sd.fontSize||DEFAULT_NODE.fontSize,groupId:null};}
function mkEdge(from,to,label=''){return {id:uid('e'),from,to,label,route:'curved',style:'solid',arrowStart:false,arrowEnd:true,color:'#64748b',width:2};}
const nodeById=id=>doc.nodes.find(n=>n.id===id);
const edgeById=id=>doc.edges.find(e=>e.id===id);
function migrate(x){
  if(!x||typeof x!=='object')return blankDoc();
  const d=blankDoc();
  const nodes=Array.isArray(x.nodes)?x.nodes:[];
  d.nodes=nodes.filter(n=>n&&typeof n==='object').map(n=>{
    const shape={circle:'ellipse'}[n.shape]||n.shape||'rect';
    const m={...mkNode(shape,+n.x||0,+n.y||0,String(n.label??'')),...n,shape,id:String(n.id||uid('n'))};
    m.w=Math.max(10,+m.w||160);m.h=Math.max(10,+m.h||70);
    if(shape==='pen'&&Array.isArray(n.points)){if(x.version===4)m.points=n.points;else{m.points=n.points.map(p=>[(+p.x||0)-m.x,(+p.y||0)-m.y]);}}
    if(m.fill==='transparent')m.fill='none';if(m.stroke==='transparent')m.stroke='none';
    m.sw=+m.sw||(+m.strokeWidth||1.5);delete m.strokeWidth;
    return m;});
  const ids=new Set(d.nodes.map(n=>n.id));
  d.edges=(Array.isArray(x.edges)?x.edges:[]).filter(e=>e&&ids.has(e.from)&&ids.has(e.to)&&e.from!==e.to).map(e=>({...mkEdge(e.from,e.to,e.label||''),...e,id:String(e.id||uid('e')),arrowEnd:e.arrowEnd!=null?!!e.arrowEnd:e.arrow!=='none',route:e.route||'curved',style:e.style||'solid'}));
  if(x.view)d.view={zoom:clamp(+x.view.zoom||1,.1,5),pan:{x:+x.view.pan?.x||0,y:+x.view.pan?.y||0}};
  else if(x.zoom||x.pan)d.view={zoom:clamp(+x.zoom||1,.1,5),pan:{x:+x.pan?.x||0,y:+x.pan?.y||0}};
  if(x.mermaid&&typeof x.mermaid.code==='string')d.mermaid={type:x.mermaid.type||'flowchart',code:x.mermaid.code,theme:x.mermaid.theme||'default'};
  else if(typeof x.code==='string'&&x.code.trim())d.mermaid={type:x.currentType||x.type||'flowchart',code:x.code,theme:'default'};
  if(x.grid===false)d.grid=false;if(x.snap===false)d.snap=false;
  return d;
}
function snapshot(){return JSON.stringify({nodes:doc.nodes,edges:doc.edges});}
function checkpoint(){history.push(snapshot());if(history.length>120)history.shift();future=[];}
function commit(){setDirty();render();saveLocalSoon();}
function restoreSnap(s){const x=JSON.parse(s);doc.nodes=x.nodes;doc.edges=x.edges;selN=selN.filter(id=>nodeById(id));if(selE&&!edgeById(selE))selE=null;commit();updateInspector();}
function undo(){if(!history.length)return;future.push(snapshot());restoreSnap(history.pop());}
function redo(){if(!future.length)return;history.push(snapshot());restoreSnap(future.pop());}
function setDirty(v=true){dirty=v;const s=$('df-state');if(s){s.textContent=v?'● Unsaved changes (autosaved in browser)':'✓ Saved';s.classList.toggle('dirty',v);}}
const saveLocalSoon=debounce(()=>{doc.mermaid.code=$('df-code')?.value??doc.mermaid.code;if(!store.set(STORE_KEY,JSON.stringify({doc,name:docName})))console.warn('Diagram autosave skipped (storage full).');},600);

/* ---------------------------------------------------------------- geometry & text */
const measureCtx=document.createElement('canvas').getContext('2d');
function wrapText(text,maxW,fontSize,bold){
  measureCtx.font=(bold?'600 ':'')+fontSize+'px Inter, "Segoe UI", Arial, sans-serif';
  const out=[];
  String(text??'').split('\n').forEach(par=>{
    if(!par){out.push('');return;}
    const words=par.split(/(\s+)/);let line='';
    for(const w of words){const t=line+w;if(measureCtx.measureText(t).width<=maxW||!line.trim()){line=t;}else{out.push(line.trimEnd());line=w.trimStart();}
      while(measureCtx.measureText(line).width>maxW&&line.length>1){let cut=line.length-1;while(cut>1&&measureCtx.measureText(line.slice(0,cut)).width>maxW)cut--;out.push(line.slice(0,cut));line=line.slice(cut);}}
    out.push(line.trimEnd());
  });
  return out;
}
function textBox(n){const pad={diamond:.25,hexagon:.16,parallelogram:.16,ellipse:.15,cylinder:.06}[n.shape]||0;const w=Math.max(20,n.w*(1-pad*2)-12);return {w,top:n.shape==='cylinder'?Math.min(18,n.h*.2):0,bottom:n.shape==='document'?n.h*.12:0};}
function shapePath(n){
  const {w,h}=n;
  switch(n.shape){
    case 'ellipse':return {tag:'ellipse',a:{cx:w/2,cy:h/2,rx:w/2,ry:h/2}};
    case 'diamond':return {tag:'polygon',a:{points:`${w/2},0 ${w},${h/2} ${w/2},${h} 0,${h/2}`}};
    case 'parallelogram':{const k=Math.min(w*.18,h*.6);return {tag:'polygon',a:{points:`${k},0 ${w},0 ${w-k},${h} 0,${h}`}};}
    case 'hexagon':{const k=Math.min(w*.2,h*.6);return {tag:'polygon',a:{points:`${k},0 ${w-k},0 ${w},${h/2} ${w-k},${h} ${k},${h} 0,${h/2}`}};}
    case 'cylinder':{const ry=Math.min(14,h*.16);return {tag:'path',a:{d:`M0,${ry} A${w/2},${ry} 0 0 1 ${w},${ry} L${w},${h-ry} A${w/2},${ry} 0 0 1 0,${h-ry} Z M0,${ry} A${w/2},${ry} 0 0 0 ${w},${ry}`}};}
    case 'document':{const a=h*.12;return {tag:'path',a:{d:`M0,0 H${w} V${h-a} C${w*.75},${h-a*2.6} ${w*.25},${h+a*.6} 0,${h-a*.6} Z`}};}
    case 'sticky':{const f=Math.min(18,w*.15);return {tag:'path',a:{d:`M0,0 H${w} V${h-f} L${w-f},${h} H0 Z M${w-f},${h} V${h-f} H${w}`}};}
    case 'round':return {tag:'rect',a:{x:0,y:0,width:w,height:h,rx:Math.min(18,h/2,w/2)}};
    case 'text':return {tag:'rect',a:{x:0,y:0,width:w,height:h}};
    default:return {tag:'rect',a:{x:0,y:0,width:w,height:h,rx:4}};
  }
}
const center=n=>({x:n.x+n.w/2,y:n.y+n.h/2});
/* Point where the ray from the centre towards (tx,ty) leaves the shape. */
function boundaryPoint(n,tx,ty){
  const c=center(n);let dx=tx-c.x,dy=ty-c.y;if(!dx&&!dy)return c;
  const hw=n.w/2,hh=n.h/2;let t;
  if(n.shape==='ellipse')t=1/Math.sqrt((dx*dx)/(hw*hw)+(dy*dy)/(hh*hh));
  else if(n.shape==='diamond')t=1/(Math.abs(dx)/hw+Math.abs(dy)/hh);
  else t=Math.min(hw/Math.abs(dx||1e-9),hh/Math.abs(dy||1e-9));
  return {x:c.x+dx*t,y:c.y+dy*t};
}
function sideOf(a,b){const ca=center(a),cb=center(b);const dx=cb.x-ca.x,dy=cb.y-ca.y;return Math.abs(dx)*(a.h+b.h)>=Math.abs(dy)*(a.w+b.w)?(dx>=0?'r':'l'):(dy>=0?'b':'t');}
const opp={l:'r',r:'l',t:'b',b:'t'};
function sidePoint(n,s){return s==='l'?{x:n.x,y:n.y+n.h/2}:s==='r'?{x:n.x+n.w,y:n.y+n.h/2}:s==='t'?{x:n.x+n.w/2,y:n.y}:{x:n.x+n.w/2,y:n.y+n.h};}
function edgeGeometry(e){
  const a=nodeById(e.from),b=nodeById(e.to);if(!a||!b)return null;
  if(e.route==='straight'){const p1=boundaryPoint(a,center(b).x,center(b).y),p2=boundaryPoint(b,center(a).x,center(a).y);return {d:`M${p1.x},${p1.y} L${p2.x},${p2.y}`,mid:{x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2}};}
  const s1=sideOf(a,b),s2=opp[s1];const p1=sidePoint(a,s1),p2=sidePoint(b,s2);
  if(e.route==='orthogonal'){
    if(s1==='l'||s1==='r'){const mx=(p1.x+p2.x)/2;return {d:`M${p1.x},${p1.y} H${mx} V${p2.y} H${p2.x}`,mid:{x:mx,y:(p1.y+p2.y)/2}};}
    const my=(p1.y+p2.y)/2;return {d:`M${p1.x},${p1.y} V${my} H${p2.x} V${p2.y}`,mid:{x:(p1.x+p2.x)/2,y:my}};
  }
  const dist=Math.max(30,Math.hypot(p2.x-p1.x,p2.y-p1.y)*.4);const off=s=>s==='l'?[-dist,0]:s==='r'?[dist,0]:s==='t'?[0,-dist]:[0,dist];
  const o1=off(s1),o2=off(s2);const c1={x:p1.x+o1[0],y:p1.y+o1[1]},c2={x:p2.x+o2[0],y:p2.y+o2[1]};
  const mid={x:.125*p1.x+.375*c1.x+.375*c2.x+.125*p2.x,y:.125*p1.y+.375*c1.y+.375*c2.y+.125*p2.y};
  return {d:`M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`,mid};
}
function contentBounds(nodes=doc.nodes){
  if(!nodes.length)return {x:0,y:0,w:400,h:300};
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;nodes.forEach(n=>{x0=Math.min(x0,n.x);y0=Math.min(y0,n.y);x1=Math.max(x1,n.x+n.w);y1=Math.max(y1,n.y+n.h);});
  doc.edges.forEach(e=>{const g=e.label&&edgeGeometry(e);if(g){x0=Math.min(x0,g.mid.x-60);x1=Math.max(x1,g.mid.x+60);y0=Math.min(y0,g.mid.y-14);y1=Math.max(y1,g.mid.y+14);}});
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}

/* ---------------------------------------------------------------- SVG building (shared by canvas & export) */
const DASH={dashed:'7 5',dotted:'2 4'};
function el(tag,attrs,parent){const e=document.createElementNS(NS,tag);if(attrs)for(const k in attrs){const v=attrs[k];if(v!=null&&v!=='')e.setAttribute(k,v);}if(parent)parent.appendChild(e);return e;}
function markerId(color,start){return 'dfm-'+(start?'s':'e')+'-'+String(color||'#64748b').replace(/[^a-z0-9]/gi,'');}
function ensureMarker(defs,color,start){const id=markerId(color,start);if(defs.querySelector('#'+id))return id;const m=el('marker',{id,viewBox:'0 0 10 10',refX:start?1:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse',markerUnits:'strokeWidth'},defs);el('path',{d:'M0,0 L10,5 L0,10 z',fill:color||'#64748b'},m);return id;}
function drawNode(n,parent,{interactive}={}){
  const g=el('g',{transform:`translate(${n.x} ${n.y})`,'data-id':interactive?n.id:null,class:interactive?'df-node':null},parent);
  if(n.shape==='pen'){el('path',{d:(n.points||[]).map((p,i)=>(i?'L':'M')+p[0]+','+p[1]).join(' '),fill:'none',stroke:n.stroke==='none'?'#0f172a':n.stroke,'stroke-width':n.sw||3,'stroke-linecap':'round','stroke-linejoin':'round'},g);if(interactive)el('rect',{x:-4,y:-4,width:n.w+8,height:n.h+8,fill:'transparent',stroke:'none'},g);return g;}
  if(n.shape==='image'){el('rect',{x:0,y:0,width:n.w,height:n.h,fill:n.fill==='none'?'none':(n.fill||'#ffffff'),stroke:n.stroke||'none','stroke-width':n.sw||0},g);if(n.src)el('image',{href:n.src,x:0,y:0,width:n.w,height:n.h,preserveAspectRatio:'xMidYMid meet'},g);return g;}
  const sp=shapePath(n);
  if(n.shape==='sticky')el('rect',{x:3,y:4,width:n.w,height:n.h,fill:'rgba(15,23,42,.10)',rx:2},g);
  el(sp.tag,{...sp.a,fill:n.fill==='none'?(interactive?'transparent':'none'):n.fill,stroke:n.stroke==='none'?'none':n.stroke,'stroke-width':n.stroke==='none'?0:(n.sw??1.5),'stroke-dasharray':DASH[n.dash]||null,'stroke-linejoin':'round'},g);
  const tb=textBox(n);const fs=n.fontSize||15;const lines=wrapText(n.label,tb.w,fs,n.bold);const lh=fs*1.25;
  const avail=n.h-tb.top-tb.bottom;const total=lines.length*lh;const y0=tb.top+(avail-total)/2+fs*.92;
  if(lines.length&&(lines.length>1||lines[0])){const t=el('text',{x:n.w/2,y:y0,'text-anchor':'middle','font-family':'Inter, "Segoe UI", Arial, sans-serif','font-size':fs,'font-weight':n.bold?600:400,fill:n.color||'#0f172a'},g);lines.forEach((ln,i)=>{const s=el('tspan',{x:n.w/2,dy:i?lh:0},t);s.textContent=ln||'\u00a0';});}
  return g;
}
function drawEdge(e,parent,defs,{interactive}={}){
  const geo=edgeGeometry(e);if(!geo)return null;
  const g=el('g',{class:interactive?'df-edge':null,'data-eid':interactive?e.id:null},parent);
  if(interactive)el('path',{d:geo.d,fill:'none',stroke:'transparent','stroke-width':14,class:'df-edge-hit'},g);
  const color=e.color||'#64748b';
  el('path',{d:geo.d,fill:'none',stroke:color,'stroke-width':e.width||2,'stroke-dasharray':DASH[e.style]||null,'marker-end':e.arrowEnd?`url(#${ensureMarker(defs,color,false)})`:null,'marker-start':e.arrowStart?`url(#${ensureMarker(defs,color,true)})`:null,'stroke-linejoin':'round','stroke-linecap':'round'},g);
  if(e.label){const fs=12.5;measureCtx.font=fs+'px Inter, Arial, sans-serif';const lines=String(e.label).split('\n');const w=Math.max(...lines.map(l=>measureCtx.measureText(l).width))+12,h=lines.length*fs*1.25+6;
    el('rect',{x:geo.mid.x-w/2,y:geo.mid.y-h/2,width:w,height:h,rx:5,fill:'#ffffff',stroke:'#e2e8f0','stroke-width':1},g);
    const t=el('text',{x:geo.mid.x,y:geo.mid.y-h/2+3+fs*.95,'text-anchor':'middle','font-family':'Inter, "Segoe UI", Arial, sans-serif','font-size':fs,fill:'#334155'},g);lines.forEach((l,i)=>{const s=el('tspan',{x:geo.mid.x,dy:i?fs*1.25:0},t);s.textContent=l;});}
  return g;
}

/* ---------------------------------------------------------------- canvas render */
function render(){
  if(!svg)return;
  const {zoom,pan}=doc.view;
  svg.textContent='';
  const defs=el('defs',null,svg);
  const gp=el('pattern',{id:'df-grid-pat',width:24*zoom,height:24*zoom,patternUnits:'userSpaceOnUse',x:pan.x%(24*zoom),y:pan.y%(24*zoom)},defs);
  el('circle',{cx:1,cy:1,r:Math.max(.6,zoom*.9),fill:'#cbd5e1'},gp);
  el('rect',{x:0,y:0,width:'100%',height:'100%',fill:doc.grid?'url(#df-grid-pat)':'#ffffff',class:'df-bg'},svg);
  const world=el('g',{transform:`translate(${pan.x} ${pan.y}) scale(${zoom})`},svg);
  const groups=new Map();doc.nodes.forEach(n=>{if(n.groupId){const b=groups.get(n.groupId)||[];b.push(n);groups.set(n.groupId,b);}});
  groups.forEach(ns=>{if(ns.some(n=>selN.includes(n.id))){const b=contentBounds(ns);el('rect',{x:b.x-8,y:b.y-8,width:b.w+16,height:b.h+16,rx:8,class:'df-group-box'},world);}});
  doc.edges.forEach(e=>{const g=drawEdge(e,world,defs,{interactive:true});if(g&&e.id===selE)g.classList.add('selected');});
  doc.nodes.forEach(n=>{const g=drawNode(n,world,{interactive:true});if(selN.includes(n.id))g.classList.add('selected');});
  const ui=el('g',{class:'df-ui'},world);
  selN.forEach(id=>{const n=nodeById(id);if(n)el('rect',{x:n.x-4,y:n.y-4,width:n.w+8,height:n.h+8,class:'df-sel-outline'},ui);});
  if(selN.length===1&&tool==='select'&&!drag){const n=nodeById(selN[0]);if(n){const hs=8/zoom;[['nw',n.x,n.y],['n',n.x+n.w/2,n.y],['ne',n.x+n.w,n.y],['e',n.x+n.w,n.y+n.h/2],['se',n.x+n.w,n.y+n.h],['s',n.x+n.w/2,n.y+n.h],['sw',n.x,n.y+n.h],['w',n.x,n.y+n.h/2]].forEach(([k,x,y])=>el('rect',{x:x-hs/2,y:y-hs/2,width:hs,height:hs,class:'df-handle h-'+k,'data-handle':k},ui));}}
  const portNode=(drag&&drag.mode==='connect')?nodeById(drag.over):hoverNode&&nodeById(hoverNode);
  if(portNode&&portNode.shape!=='pen'&&(tool==='select'||tool==='connector')&&!(drag&&drag.mode!=='connect')){['t','r','b','l'].forEach(s=>{const p=sidePoint(portNode,s);el('circle',{cx:p.x,cy:p.y,r:6/zoom,class:'df-port','data-port':s,'data-node':portNode.id},ui);});}
  if(drag&&drag.mode==='connect'&&drag.cur){const a=nodeById(drag.from);if(a){const c=center(a);const tgt=drag.over&&nodeById(drag.over);const p2=tgt?center(tgt):drag.cur;const p1=boundaryPoint(a,p2.x,p2.y);el('line',{x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,class:'df-temp-edge'},ui);if(tgt)el('rect',{x:tgt.x-5,y:tgt.y-5,width:tgt.w+10,height:tgt.h+10,class:'df-drop-target'},ui);void c;}}
  if(drag&&drag.mode==='marquee'&&drag.box){const b=drag.box;el('rect',{x:b.x,y:b.y,width:b.w,height:b.h,class:'df-marquee'},ui);}
  if(drag&&drag.mode==='create'&&drag.box){const b=drag.box;el('rect',{x:b.x,y:b.y,width:b.w,height:b.h,class:'df-marquee'},ui);}
  guides.forEach(gd=>el('line',gd.axis==='x'?{x1:gd.v,y1:gd.a-20,x2:gd.v,y2:gd.b+20,class:'df-guide'}:{x1:gd.a-20,y1:gd.v,x2:gd.b+20,y2:gd.v,class:'df-guide'},ui));
  const zl=$('df-zoom-label');if(zl)zl.textContent=Math.round(zoom*100)+'%';
  svg.classList.toggle('tool-pan',tool==='pan'||spaceDown);
  svg.dataset.tool=tool;
}
function toWorld(e){const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left-doc.view.pan.x)/doc.view.zoom,y:(e.clientY-r.top-doc.view.pan.y)/doc.view.zoom};}
const snapV=v=>doc.snap?Math.round(v/12)*12:v;
function zoomAt(factor,cx,cy){const r=svg.getBoundingClientRect();if(cx==null){cx=r.width/2;cy=r.height/2;}const z0=doc.view.zoom,z1=clamp(z0*factor,.1,5);const wx=(cx-doc.view.pan.x)/z0,wy=(cy-doc.view.pan.y)/z0;doc.view.zoom=z1;doc.view.pan={x:cx-wx*z1,y:cy-wy*z1};render();saveLocalSoon();}
function fit(){const r=svg.getBoundingClientRect();if(!r.width||!r.height)return;if(!doc.nodes.length){doc.view={zoom:1,pan:{x:40,y:40}};render();return;}const b=contentBounds();const z=clamp(Math.min((r.width-80)/Math.max(b.w,1),(r.height-80)/Math.max(b.h,1)),.1,2);doc.view={zoom:z,pan:{x:(r.width-b.w*z)/2-b.x*z,y:(r.height-b.h*z)/2-b.y*z}};render();saveLocalSoon();}

/* ---------------------------------------------------------------- selection helpers */
function expandGroups(ids){const gs=new Set(ids.map(id=>nodeById(id)?.groupId).filter(Boolean));if(!gs.size)return ids;return [...new Set([...ids,...doc.nodes.filter(n=>gs.has(n.groupId)).map(n=>n.id)])];}
function selectOnly(ids){selN=expandGroups(ids);selE=null;updateInspector();}
function nodeAt(p){for(let i=doc.nodes.length-1;i>=0;i--){const n=doc.nodes[i];if(p.x>=n.x-2&&p.x<=n.x+n.w+2&&p.y>=n.y-2&&p.y<=n.y+n.h+2)return n;}return null;}
function addNode(shape,x,y,label,{select=true,edit=false}={}){
  checkpoint();const n=mkNode(shape,0,0,label??(shape==='text'?'Text':shape==='sticky'?'Note':shape==='diamond'?'Decision?':shape==='cylinder'?'Database':''));
  n.x=snapV(x-n.w/2);n.y=snapV(y-n.h/2);doc.nodes.push(n);if(select)selectOnly([n.id]);commit();if(edit)setTimeout(()=>openEditor(n.id),0);return n;
}
function addEdge(a,b,label=''){if(!a||!b||a===b)return null;if(doc.edges.some(e=>e.from===a&&e.to===b))return null;checkpoint();const e=mkEdge(a,b,label);doc.edges.push(e);selN=[];selE=e.id;updateInspector();commit();return e;}
function deleteSelection(){
  if(!selN.length&&!selE)return;checkpoint();
  if(selE){doc.edges=doc.edges.filter(e=>e.id!==selE);selE=null;}
  if(selN.length){const s=new Set(selN);doc.nodes=doc.nodes.filter(n=>!s.has(n.id));doc.edges=doc.edges.filter(e=>!s.has(e.from)&&!s.has(e.to));selN=[];}
  updateInspector();commit();
}
function copySel(){if(!selN.length)return false;const s=new Set(selN);clip={nodes:clone(doc.nodes.filter(n=>s.has(n.id))),edges:clone(doc.edges.filter(e=>s.has(e.from)&&s.has(e.to)))};return true;}
function pasteClip(dx=24,dy=24){if(!clip||!clip.nodes.length)return;checkpoint();const map=new Map();const gmap=new Map();const ns=clip.nodes.map(n=>{const c=clone(n);c.id=uid('n');c.x+=dx;c.y+=dy;if(c.groupId){if(!gmap.has(c.groupId))gmap.set(c.groupId,uid('g'));c.groupId=gmap.get(c.groupId);}map.set(n.id,c.id);return c;});doc.nodes.push(...ns);clip.edges.forEach(e=>doc.edges.push({...clone(e),id:uid('e'),from:map.get(e.from),to:map.get(e.to)}));clip={nodes:clone(ns),edges:clone(doc.edges.filter(e=>ns.some(n=>n.id===e.from)&&ns.some(n=>n.id===e.to)))};selN=ns.map(n=>n.id);selE=null;updateInspector();commit();}
function duplicate(){if(copySel())pasteClip();}
function groupSel(){if(selN.length<2)return;checkpoint();const g=uid('g');selN.forEach(id=>{const n=nodeById(id);if(n)n.groupId=g;});commit();}
function ungroupSel(){const gs=new Set(selN.map(id=>nodeById(id)?.groupId).filter(Boolean));if(!gs.size)return;checkpoint();doc.nodes.forEach(n=>{if(gs.has(n.groupId))n.groupId=null;});commit();}
function zorder(front){if(!selN.length)return;checkpoint();const s=new Set(selN);const a=doc.nodes.filter(n=>!s.has(n.id)),b=doc.nodes.filter(n=>s.has(n.id));doc.nodes=front?a.concat(b):b.concat(a);commit();}
function alignSel(kind){
  const ns=selN.map(nodeById).filter(Boolean);if(ns.length<2)return notify('Select two or more shapes first.',true);
  if((kind==='distx'||kind==='disty')&&ns.length<3)return notify('Select three or more shapes to distribute.',true);
  checkpoint();
  const minX=Math.min(...ns.map(n=>n.x)),maxX=Math.max(...ns.map(n=>n.x+n.w)),minY=Math.min(...ns.map(n=>n.y)),maxY=Math.max(...ns.map(n=>n.y+n.h));
  if(kind==='left')ns.forEach(n=>n.x=minX);if(kind==='right')ns.forEach(n=>n.x=maxX-n.w);if(kind==='center')ns.forEach(n=>n.x=(minX+maxX)/2-n.w/2);
  if(kind==='top')ns.forEach(n=>n.y=minY);if(kind==='bottom')ns.forEach(n=>n.y=maxY-n.h);if(kind==='middle')ns.forEach(n=>n.y=(minY+maxY)/2-n.h/2);
  if(kind==='distx'){const s=[...ns].sort((a,b)=>a.x-b.x);const gap=(maxX-minX-s.reduce((a,n)=>a+n.w,0))/(s.length-1);let x=minX;s.forEach(n=>{n.x=x;x+=n.w+gap;});}
  if(kind==='disty'){const s=[...ns].sort((a,b)=>a.y-b.y);const gap=(maxY-minY-s.reduce((a,n)=>a+n.h,0))/(s.length-1);let y=minY;s.forEach(n=>{n.y=y;y+=n.h+gap;});}
  if(kind==='samesize'){const r=ns[0];ns.forEach(n=>{n.w=r.w;n.h=r.h;});}
  commit();
}
function setTool(t){tool=t;document.querySelectorAll('#df-tools .df-tool').forEach(b=>{const on=b.dataset.tool===t;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});if(t==='image'){$('df-image-file').click();setTool('select');return;}render();}

/* ---------------------------------------------------------------- snapping guides */
function smartSnap(moving,dx,dy){
  guides=[];if(!doc.snap)return {dx,dy};
  const b=contentBounds(moving);const mx=b.x+dx,my=b.y+dy;
  let sx=snapV(mx)-mx,sy=snapV(my)-my;let bestX=Infinity,bestY=Infinity;
  const ids=new Set(moving.map(n=>n.id));const thr=6/doc.view.zoom;
  const xs=[mx,mx+b.w/2,mx+b.w],ys=[my,my+b.h/2,my+b.h];
  doc.nodes.forEach(o=>{if(ids.has(o.id))return;[o.x,o.x+o.w/2,o.x+o.w].forEach(v=>xs.forEach(q=>{const d=v-q;if(Math.abs(d)<thr&&Math.abs(d)<Math.abs(bestX)){bestX=d;guides=guides.filter(g=>g.axis!=='x');guides.push({axis:'x',v,a:Math.min(o.y,my),b:Math.max(o.y+o.h,my+b.h)});}}));
    [o.y,o.y+o.h/2,o.y+o.h].forEach(v=>ys.forEach(q=>{const d=v-q;if(Math.abs(d)<thr&&Math.abs(d)<Math.abs(bestY)){bestY=d;guides=guides.filter(g=>g.axis!=='y');guides.push({axis:'y',v,a:Math.min(o.x,mx),b:Math.max(o.x+o.w,mx+b.w)});}}));});
  return {dx:dx+(isFinite(bestX)?bestX:sx),dy:dy+(isFinite(bestY)?bestY:sy)};
}

/* ---------------------------------------------------------------- pointer interaction */
const CREATE_TOOLS=new Set(['rect','round','ellipse','diamond','parallelogram','cylinder','hexagon','document','sticky','text']);
function onDown(e){
  if(editor)closeEditor(true);
  svg.focus({preventScroll:true});
  const p=toWorld(e);
  if(e.button===1||tool==='pan'||spaceDown){e.preventDefault();drag={mode:'pan',sx:e.clientX,sy:e.clientY,px:doc.view.pan.x,py:doc.view.pan.y};svg.setPointerCapture(e.pointerId);return;}
  if(e.button!==0)return;
  const t=e.target;
  if(t.dataset&&t.dataset.port){e.preventDefault();drag={mode:'connect',from:t.dataset.node,cur:p,over:null};svg.setPointerCapture(e.pointerId);render();return;}
  if(t.dataset&&t.dataset.handle&&selN.length===1){const n=nodeById(selN[0]);checkpoint();drag={mode:'resize',h:t.dataset.handle,id:n.id,sx:p.x,sy:p.y,o:{x:n.x,y:n.y,w:n.w,h:n.h,points:n.points?clone(n.points):null},changed:false};svg.setPointerCapture(e.pointerId);return;}
  if(tool==='pen'){checkpoint();const n=mkNode('pen',p.x,p.y,'');n.stroke='#0f172a';n.sw=3;n.fill='none';n.points=[[0,0]];n.w=1;n.h=1;doc.nodes.push(n);drag={mode:'pen',id:n.id,abs:[[p.x,p.y]]};svg.setPointerCapture(e.pointerId);return;}
  if(CREATE_TOOLS.has(tool)){drag={mode:'create',shape:tool,sx:p.x,sy:p.y,box:null};svg.setPointerCapture(e.pointerId);return;}
  const nodeEl=t.closest&&t.closest('.df-node');const edgeEl=t.closest&&t.closest('.df-edge');
  if(tool==='connector'){const n=nodeEl&&nodeById(nodeEl.dataset.id);if(n){drag={mode:'connect',from:n.id,cur:p,over:null};svg.setPointerCapture(e.pointerId);render();}return;}
  if(nodeEl){
    const id=nodeEl.dataset.id;
    if(e.shiftKey||e.ctrlKey||e.metaKey){const ids=expandGroups([id]);if(selN.includes(id))selN=selN.filter(x=>!ids.includes(x));else selN=[...new Set([...selN,...ids])];selE=null;updateInspector();render();return;}
    if(!selN.includes(id))selectOnly([id]);
    const moving=selN.map(nodeById).filter(Boolean);
    drag={mode:'move',sx:p.x,sy:p.y,orig:moving.map(n=>({id:n.id,x:n.x,y:n.y})),before:snapshot(),changed:false,alt:e.altKey};
    svg.setPointerCapture(e.pointerId);render();return;
  }
  if(edgeEl){selN=[];selE=edgeEl.dataset.eid;updateInspector();render();return;}
  if(!e.shiftKey){selN=[];selE=null;updateInspector();}
  drag={mode:'marquee',sx:p.x,sy:p.y,box:{x:p.x,y:p.y,w:0,h:0},base:[...selN]};svg.setPointerCapture(e.pointerId);render();
}
function onMove(e){
  const p=toWorld(e);
  if(!drag){const n=nodeAt(p);const id=n&&n.shape!=='pen'?n.id:null;const overPort=e.target?.dataset?.port;if(id!==hoverNode&&!overPort){hoverNode=id;render();}return;}
  if(drag.mode==='pan'){doc.view.pan={x:drag.px+e.clientX-drag.sx,y:drag.py+e.clientY-drag.sy};render();return;}
  if(drag.mode==='move'){
    let dx=p.x-drag.sx,dy=p.y-drag.sy;if(!drag.changed&&Math.hypot(dx,dy)*doc.view.zoom<3)return;
    if(!drag.changed){drag.changed=true;if(drag.alt){checkpoint();const copies=drag.orig.map(o=>{const c=clone(nodeById(o.id));c.id=uid('n');doc.nodes.push(c);return {from:o.id,c};});const m=new Map(copies.map(x=>[x.from,x.c.id]));doc.edges.filter(ed=>m.has(ed.from)&&m.has(ed.to)).forEach(ed=>doc.edges.push({...clone(ed),id:uid('e'),from:m.get(ed.from),to:m.get(ed.to)}));selN=copies.map(x=>x.c.id);drag.orig=copies.map(x=>({id:x.c.id,x:x.c.x,y:x.c.y}));drag.before=null;}}
    const moving=drag.orig.map(o=>nodeById(o.id)).filter(Boolean);
    drag.orig.forEach(o=>{const n=nodeById(o.id);if(n){n.x=o.x;n.y=o.y;}});
    if(!e.altKey||drag.before){const s=smartSnap(moving,dx,dy);dx=s.dx;dy=s.dy;}
    drag.orig.forEach(o=>{const n=nodeById(o.id);if(n){n.x=o.x+dx;n.y=o.y+dy;}});render();return;
  }
  if(drag.mode==='resize'){
    const n=nodeById(drag.id);if(!n)return;const o=drag.o;let dx=p.x-drag.sx,dy=p.y-drag.sy;const h=drag.h;
    let x=o.x,y=o.y,w=o.w,hh=o.h;
    if(h.includes('e'))w=o.w+dx;if(h.includes('s'))hh=o.h+dy;if(h.includes('w')){w=o.w-dx;x=o.x+dx;}if(h.includes('n')){hh=o.h-dy;y=o.y+dy;}
    if(e.shiftKey&&o.w&&o.h){const r=o.w/o.h;if(Math.abs(w-o.w)>Math.abs(hh-o.h)*r)hh=w/r;else w=hh*r;if(h.includes('w'))x=o.x+o.w-w;if(h.includes('n'))y=o.y+o.h-hh;}
    const min=n.shape==='pen'?4:20;if(w<min){if(h.includes('w'))x-=min-w;w=min;}if(hh<min){if(h.includes('n'))y-=min-hh;hh=min;}
    if(doc.snap&&!e.altKey){const x2=snapV(x+w),y2=snapV(y+hh);if(h.includes('w'))x=snapV(x);if(h.includes('n'))y=snapV(y);if(h.includes('e'))w=Math.max(min,x2-x);if(h.includes('s'))hh=Math.max(min,y2-y);}
    if(n.shape==='pen'&&o.points){const sx=w/(o.w||1),sy=hh/(o.h||1);n.points=o.points.map(q=>[q[0]*sx,q[1]*sy]);}
    n.x=x;n.y=y;n.w=w;n.h=hh;drag.changed=true;render();updateInspectorFields();return;
  }
  if(drag.mode==='pen'){const n=nodeById(drag.id);if(!n)return;const last=drag.abs[drag.abs.length-1];if(Math.hypot(p.x-last[0],p.y-last[1])*doc.view.zoom<2)return;drag.abs.push([p.x,p.y]);const xs=drag.abs.map(q=>q[0]),ys=drag.abs.map(q=>q[1]);n.x=Math.min(...xs);n.y=Math.min(...ys);n.w=Math.max(1,Math.max(...xs)-n.x);n.h=Math.max(1,Math.max(...ys)-n.y);n.points=drag.abs.map(q=>[q[0]-n.x,q[1]-n.y]);render();return;}
  if(drag.mode==='connect'){drag.cur=p;const n=nodeAt(p);drag.over=n&&n.id!==drag.from&&n.shape!=='pen'?n.id:null;render();return;}
  if(drag.mode==='marquee'||drag.mode==='create'){drag.box={x:Math.min(drag.sx,p.x),y:Math.min(drag.sy,p.y),w:Math.abs(p.x-drag.sx),h:Math.abs(p.y-drag.sy)};
    if(drag.mode==='marquee'){const b=drag.box;const hit=doc.nodes.filter(n=>n.x<b.x+b.w&&n.x+n.w>b.x&&n.y<b.y+b.h&&n.y+n.h>b.y).map(n=>n.id);selN=expandGroups([...new Set([...drag.base,...hit])]);selE=null;}
    render();}
}
function onUp(e){
  if(!drag)return;const d=drag;drag=null;guides=[];
  try{svg.releasePointerCapture(e.pointerId);}catch(_){}
  if(d.mode==='pan'){saveLocalSoon();render();return;}
  if(d.mode==='move'){if(d.changed){if(d.before){history.push(d.before);if(history.length>120)history.shift();future=[];}commit();}else render();updateInspector();return;}
  if(d.mode==='resize'){if(d.changed)commit();else{history.pop();render();}return;}
  if(d.mode==='pen'){const n=nodeById(d.id);if(n&&d.abs.length<2){doc.nodes=doc.nodes.filter(x=>x!==n);history.pop();}else if(n){n.points=simplify(n.points,1.2/doc.view.zoom);selectOnly([n.id]);}commit();return;}
  if(d.mode==='connect'){const t=d.over||(nodeAt(toWorld(e))?.id);render();if(t&&t!==d.from)addEdge(d.from,t);else render();return;}
  if(d.mode==='create'){const b=d.box;let n;if(b&&b.w>12&&b.h>12){checkpoint();n=mkNode(d.shape,snapV(b.x),snapV(b.y),d.shape==='text'?'Text':d.shape==='sticky'?'Note':'');n.w=Math.max(20,snapV(b.w));n.h=Math.max(20,snapV(b.h));doc.nodes.push(n);selectOnly([n.id]);commit();}else n=addNode(d.shape,d.sx,d.sy);setTool('select');if(n)openEditor(n.id);return;}
  if(d.mode==='marquee'){render();updateInspector();}
}
/* Ramer–Douglas–Peucker to keep freehand strokes light */
function simplify(pts,eps){if(!pts||pts.length<3)return pts;const dist=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const l=dx*dx+dy*dy;if(!l)return Math.hypot(p[0]-a[0],p[1]-a[1]);const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l,0,1);return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};const rec=(s,e)=>{let m=0,i0=-1;for(let i=s+1;i<e;i++){const d=dist(pts[i],pts[s],pts[e]);if(d>m){m=d;i0=i;}}return m>eps?rec(s,i0).slice(0,-1).concat(rec(i0,e)):[pts[s],pts[e]];};return rec(0,pts.length-1).map(p=>[Math.round(p[0]*10)/10,Math.round(p[1]*10)/10]);}
function onDbl(e){
  const t=e.target;const nodeEl=t.closest&&t.closest('.df-node');const edgeEl=t.closest&&t.closest('.df-edge');
  if(nodeEl){const n=nodeById(nodeEl.dataset.id);if(n&&n.shape!=='pen'&&n.shape!=='image')openEditor(n.id);return;}
  if(edgeEl){openEdgeEditor(edgeEl.dataset.eid);return;}
  const p=toWorld(e);addNode('round',p.x,p.y,'',{edit:true});
}
function onWheel(e){
  e.preventDefault();
  if(e.ctrlKey||e.metaKey){const r=svg.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*(e.deltaMode===1?.05:.0025)),e.clientX-r.left,e.clientY-r.top);return;}
  const k=e.deltaMode===1?16:1;doc.view.pan={x:doc.view.pan.x-(e.shiftKey?e.deltaY:e.deltaX)*k,y:doc.view.pan.y-(e.shiftKey?0:e.deltaY)*k};render();saveLocalSoon();
}

/* ---------------------------------------------------------------- inline text editor */
function screenRect(x,y,w,h){const {zoom,pan}=doc.view;return {left:pan.x+x*zoom,top:pan.y+y*zoom,width:w*zoom,height:h*zoom};}
function openEditor(id){
  const n=nodeById(id);if(!n)return;closeEditor(true);
  const r=screenRect(n.x,n.y,n.w,n.h);const ta=document.createElement('textarea');ta.className='df-inline-editor';ta.value=n.label||'';
  Object.assign(ta.style,{left:r.left+'px',top:r.top+'px',width:Math.max(80,r.width)+'px',height:Math.max(32,r.height)+'px'});
  ta.style.setProperty('font-size',Math.max(10,(n.fontSize||15)*doc.view.zoom)+'px','important');ta.style.setProperty('color',/^#/.test(n.color||'')?n.color:'#0f172a','important');ta.style.setProperty('font-weight',n.bold?'600':'400','important');
  wrap.appendChild(ta);ta.focus();ta.select();editor={type:'node',id,ta,orig:n.label||''};
  ta.addEventListener('keydown',ev=>{ev.stopPropagation();if(ev.key==='Escape'){ev.preventDefault();closeEditor(false);}else if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();closeEditor(true);}});
  ta.addEventListener('blur',()=>closeEditor(true));
}
function openEdgeEditor(id){
  const e=edgeById(id);if(!e)return;closeEditor(true);const g=edgeGeometry(e);if(!g)return;
  const {zoom,pan}=doc.view;const inp=document.createElement('textarea');inp.className='df-inline-editor edge';inp.value=e.label||'';inp.rows=1;
  Object.assign(inp.style,{left:(pan.x+g.mid.x*zoom-80)+'px',top:(pan.y+g.mid.y*zoom-16)+'px',width:'160px',height:'32px'});
  wrap.appendChild(inp);inp.focus();inp.select();editor={type:'edge',id,ta:inp,orig:e.label||''};selN=[];selE=id;updateInspector();
  inp.addEventListener('keydown',ev=>{ev.stopPropagation();if(ev.key==='Escape'){ev.preventDefault();closeEditor(false);}else if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();closeEditor(true);}});
  inp.addEventListener('blur',()=>closeEditor(true));
}
function closeEditor(apply){
  if(!editor)return;const ed=editor;editor=null;const v=ed.ta.value;ed.ta.remove();
  if(apply&&v!==ed.orig){checkpoint();if(ed.type==='node'){const n=nodeById(ed.id);if(n)n.label=v;}else{const e=edgeById(ed.id);if(e)e.label=v.trim();}commit();updateInspector();}
  else render();
  svg?.focus({preventScroll:true});
}

/* ---------------------------------------------------------------- inspector */
function updateInspector(){
  const ns=selN.map(nodeById).filter(Boolean);const e=selE&&edgeById(selE);
  $('df-insp-node').hidden=ns.length!==1;$('df-insp-edge').hidden=!e;$('df-insp-multi').hidden=ns.length<2;
  $('df-selected').textContent=e?'Connector selected':ns.length===1?('Shape: '+(ns[0].shape==='pen'?'freehand':ns[0].shape)):ns.length?ns.length+' shapes selected':'Nothing selected — click a shape or connector';
  updateInspectorFields();
}
function hexOr(c,d){return /^#[0-9a-f]{6}$/i.test(c||'')?c:d;}
function updateInspectorFields(){
  const ns=selN.map(nodeById).filter(Boolean);
  if(ns.length===1){const n=ns[0];const set=(id,v)=>{const x=$(id);if(x&&document.activeElement!==x)x.value=v;};
    set('df-n-label',n.label||'');set('df-n-shape',['pen','image'].includes(n.shape)?'rect':n.shape);$('df-n-shape').disabled=['pen','image'].includes(n.shape);$('df-n-label').disabled=['pen','image'].includes(n.shape);
    set('df-n-fill',hexOr(n.fill,'#ffffff'));set('df-n-stroke',hexOr(n.stroke,'#475569'));set('df-n-color',hexOr(n.color,'#0f172a'));set('df-n-size',n.fontSize||15);set('df-n-sw',n.sw??1.5);set('df-n-w',Math.round(n.w));set('df-n-h',Math.round(n.h));set('df-n-dash',n.dash||'');$('df-n-bold').checked=!!n.bold;}
  const e=selE&&edgeById(selE);
  if(e){const set=(id,v)=>{const x=$(id);if(x&&document.activeElement!==x)x.value=v;};set('df-e-label',e.label||'');set('df-e-route',e.route||'curved');set('df-e-style',e.style||'solid');$('df-e-start').checked=!!e.arrowStart;$('df-e-end').checked=e.arrowEnd!==false;set('df-e-color',hexOr(e.color,'#64748b'));set('df-e-width',e.width||2);}
}
let inspectorCheckpointAt=0;
function inspectorChange(fn){const now=Date.now();if(now-inspectorCheckpointAt>800)checkpoint();inspectorCheckpointAt=now;fn();commit();}
function wireInspector(){
  const node=()=>{const ns=selN.map(nodeById).filter(Boolean);return ns.length===1?ns[0]:null;};
  const bindN=(id,prop,conv=v=>v,ev='input')=>$(id).addEventListener(ev,()=>{const n=node();if(!n)return;inspectorChange(()=>{n[prop]=conv($(id).value);});});
  bindN('df-n-label','label');bindN('df-n-shape','shape',v=>v,'change');bindN('df-n-fill','fill');bindN('df-n-stroke','stroke');bindN('df-n-color','color');
  bindN('df-n-size','fontSize',v=>clamp(+v||15,6,120));bindN('df-n-sw','sw',v=>clamp(+v,0,20));bindN('df-n-w','w',v=>clamp(+v||20,10,6000));bindN('df-n-h','h',v=>clamp(+v||20,10,6000));bindN('df-n-dash','dash',v=>v,'change');
  $('df-n-bold').addEventListener('change',()=>{const n=node();if(n)inspectorChange(()=>{n.bold=$('df-n-bold').checked;});});
  const edge=()=>selE&&edgeById(selE);
  const bindE=(id,prop,conv=v=>v,ev='input')=>$(id).addEventListener(ev,()=>{const e=edge();if(!e)return;inspectorChange(()=>{e[prop]=conv($(id).type==='checkbox'?$(id).checked:$(id).value);});});
  bindE('df-e-label','label');bindE('df-e-route','route',v=>v,'change');bindE('df-e-style','style',v=>v,'change');bindE('df-e-start','arrowStart',v=>!!v,'change');bindE('df-e-end','arrowEnd',v=>!!v,'change');bindE('df-e-color','color');bindE('df-e-width','width',v=>clamp(+v||2,.5,12));
  $('df-e-reverse').addEventListener('click',()=>{const e=edge();if(!e)return;checkpoint();[e.from,e.to]=[e.to,e.from];[e.arrowStart,e.arrowEnd]=[e.arrowEnd,e.arrowStart];commit();updateInspectorFields();});
  $('df-m-fill').addEventListener('input',()=>{const ns=selN.map(nodeById).filter(Boolean);inspectorChange(()=>ns.forEach(n=>{if(n.shape!=='pen'&&n.shape!=='text')n.fill=$('df-m-fill').value;}));});
  $('df-m-stroke').addEventListener('input',()=>{const ns=selN.map(nodeById).filter(Boolean);inspectorChange(()=>ns.forEach(n=>{if(n.shape!=='text')n.stroke=$('df-m-stroke').value;}));});
}

/* ---------------------------------------------------------------- auto layout */
async function layoutGraph(nodes,edges,dir='LR'){
  try{
    const dagre=await lib('dagre');const g=new dagre.graphlib.Graph({multigraph:true});
    g.setGraph({rankdir:dir,nodesep:46,ranksep:80,edgesep:20,marginx:40,marginy:40});g.setDefaultEdgeLabel(()=>({}));
    nodes.forEach(n=>g.setNode(n.id,{width:n.w,height:n.h}));
    edges.forEach((e,i)=>{if(g.hasNode(e.from)&&g.hasNode(e.to))g.setEdge(e.from,e.to,{minlen:1,width:e.label?Math.min(160,e.label.length*7):0,height:e.label?18:0},'e'+i);});
    dagre.layout(g);
    nodes.forEach(n=>{const p=g.node(n.id);if(p){n.x=Math.round(p.x-n.w/2);n.y=Math.round(p.y-n.h/2);}});
    return true;
  }catch(err){
    console.warn('dagre unavailable, using simple layered layout',err);
    const indeg=new Map(nodes.map(n=>[n.id,0]));edges.forEach(e=>indeg.has(e.to)&&indeg.set(e.to,indeg.get(e.to)+1));
    const rank=new Map();const q=nodes.filter(n=>!indeg.get(n.id)).map(n=>n.id);if(!q.length&&nodes.length)q.push(nodes[0].id);q.forEach(id=>rank.set(id,0));
    for(let i=0;i<q.length;i++){const id=q[i];edges.filter(e=>e.from===id).forEach(e=>{if(!rank.has(e.to)){rank.set(e.to,rank.get(id)+1);q.push(e.to);}});}
    nodes.forEach(n=>{if(!rank.has(n.id))rank.set(n.id,0);});const cols={};
    nodes.forEach(n=>{const r=rank.get(n.id);cols[r]=(cols[r]||0)+1;const k=cols[r]-1;const horiz=dir==='LR'||dir==='RL';n.x=40+(horiz?r*240:k*220);n.y=40+(horiz?k*130:r*150);});
    return false;
  }
}
async function autoLayout(){
  const target=(selN.length>1?selN.map(nodeById):doc.nodes).filter(n=>n&&n.shape!=='pen');if(target.length<2)return notify('Add at least two shapes to auto-layout.',true);
  checkpoint();const ids=new Set(target.map(n=>n.id));const b0=contentBounds(target);
  await layoutGraph(target,doc.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)),$('df-layout-dir').value);
  if(selN.length>1){const b1=contentBounds(target);target.forEach(n=>{n.x+=b0.x-b1.x;n.y+=b0.y-b1.y;});}
  commit();if(selN.length<2)fit();
}

/* ---------------------------------------------------------------- Canvas → Mermaid */
const MM_SHAPE={rect:['[',']'],round:['(',')'],ellipse:['((','))'],diamond:['{','}'],parallelogram:['[/','/]'],cylinder:['[(',')]'],hexagon:['{{','}}'],document:['[',']'],sticky:['[',']'],text:['[',']']};
function mmLabel(s){return '"'+String(s||' ').replace(/"/g,'#quot;').replace(/\n/g,'<br>')+'"';}
function canvasToMermaid(){
  const ns=doc.nodes.filter(n=>n.shape!=='pen'&&n.shape!=='image');if(!ns.length)return notify('The canvas has no shapes to convert.',true);
  const b=contentBounds(ns);const dir=b.w>=b.h?'LR':'TB';const ids=new Map();ns.forEach((n,i)=>ids.set(n.id,'N'+(i+1)));
  const L=['flowchart '+dir];
  ns.forEach(n=>{const [a,z]=MM_SHAPE[n.shape]||MM_SHAPE.rect;L.push('  '+ids.get(n.id)+a+mmLabel(n.label)+z);});
  doc.edges.forEach(e=>{if(!ids.has(e.from)||!ids.has(e.to))return;const dash=e.style!=='solid';const head=e.arrowEnd!==false;let op=dash?(head?'-.->':'-.-'):(head?'-->':'---');if(e.arrowStart&&head)op=dash?'<-.->':'<-->';L.push('  '+ids.get(e.from)+' '+op+(e.label?'|'+mmLabel(e.label)+'|':'')+' '+ids.get(e.to));});
  ns.forEach(n=>{const st=[];if(/^#/.test(n.fill)&&n.fill.toLowerCase()!=='#ffffff')st.push('fill:'+n.fill);if(/^#/.test(n.stroke)&&n.stroke.toLowerCase()!=='#475569')st.push('stroke:'+n.stroke);if(/^#/.test(n.color)&&n.color.toLowerCase()!=='#0f172a')st.push('color:'+n.color);if(n.dash)st.push('stroke-dasharray:5 4');if(st.length)L.push('  style '+ids.get(n.id)+' '+st.join(','));});
  $('df-code').value=L.join('\n');$('df-type').value='flowchart';doc.mermaid.type='flowchart';setMode('text');renderMermaid();setDirty();saveLocalSoon();
}

/* ---------------------------------------------------------------- Mermaid → Canvas */
function stripComments(code){return code.split('\n').map(l=>l.replace(/%%.*$/,'')).join('\n');}
function decodeMmLabel(s){s=String(s??'').trim();if(/^".*"$/s.test(s))s=s.slice(1,-1);if(/^`.*`$/s.test(s))s=s.slice(1,-1);return s.replace(/#quot;/g,'"').replace(/<br\s*\/?>/gi,'\n').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/^\*\*(.*)\*\*$/,'$1');}
const FC_SHAPES=[['(((',')))','ellipse'],['((','))','ellipse'],['([','])','round'],['[[',']]','rect'],['[(',')]','cylinder'],['{{','}}','hexagon'],['[/','/]','parallelogram'],['[\\','\\]','parallelogram'],['[/','\\]','rect'],['[\\','/]','rect'],['(',')','round'],['[',']','rect'],['{','}','diamond'],['>',']','rect']];
function parseFlowchart(code){
  const lines=stripComments(code).split(/\n|;/).map(l=>l.trim()).filter(Boolean);
  const hdr=/^(flowchart|graph)\b\s*(TB|TD|BT|RL|LR)?/i.exec(lines[0]||'');if(!hdr)return null;
  const dir=({TD:'TB'})[(hdr[2]||'TB').toUpperCase()]||(hdr[2]||'TB').toUpperCase();
  const nodes=new Map(),edges=[],styles=new Map(),classDefs=new Map(),classOf=new Map();
  const ensure=(id,label,shape)=>{let n=nodes.get(id);if(!n){n={id,label:id,shape:'rect'};nodes.set(id,n);}if(label!=null){n.label=label;n.shape=shape;}return n;};
  const readNode=(s,i)=>{
    while(s[i]===' ')i++;const m=/^[A-Za-z0-9_\u00C0-\uFFFF][\w\-.\u00C0-\uFFFF]*/.exec(s.slice(i));if(!m)return null;const id=m[0];i+=id.length;
    if(s.slice(i,i+2)==='@{'){const end=s.indexOf('}',i);const body=s.slice(i+2,end<0?s.length:end);const lab=/label\s*:\s*"([^"]*)"/.exec(body);const shp=/shape\s*:\s*([\w-]+)/.exec(body);const map={rect:'rect',rounded:'round',stadium:'round',circle:'ellipse','sm-circ':'ellipse',diam:'diamond',diamond:'diamond',hex:'hexagon',hexagon:'hexagon',cyl:'cylinder',cylinder:'cylinder',db:'cylinder','lean-r':'parallelogram','lean-l':'parallelogram',doc:'document',document:'document'};ensure(id,lab?lab[1]:id,map[shp?.[1]]||'rect');return {ids:[id],i:end<0?s.length:end+1};}
    for(const [o,c,shape] of FC_SHAPES){if(s.startsWith(o,i)){const j=s.indexOf(c,i+o.length);if(j<0)continue;ensure(id,decodeMmLabel(s.slice(i+o.length,j)),shape);i=j+c.length;break;}}
    if(s.slice(i,i+3)===':::'){const m2=/^:::([\w-]+)/.exec(s.slice(i));if(m2){classOf.set(id,m2[1]);i+=m2[0].length;}}
    ensure(id);return {ids:[id],i};
  };
  const readGroup=(s,i)=>{const r=readNode(s,i);if(!r)return null;let ids=r.ids;i=r.i;while(true){const m=/^\s*&\s*/.exec(s.slice(i));if(!m)break;const r2=readNode(s,i+m[0].length);if(!r2)break;ids=ids.concat(r2.ids);i=r2.i;}return {ids,i};};
  const LINK=/^\s*(<)?(?:(-{2,}|={2,}|-\.+-?|~{3,})\s*([^-=.>|][^>|]*?)\s*)?(--+>|==+>|-\.+->|--+o|--+x|---+|===+|-\.+-|~~~+|--+|==+)(\|([^|]*)\|)?/;
  for(const raw of lines.slice(1)){
    const line=raw.trim();
    if(/^(subgraph|end|direction|click|linkStyle)\b/i.test(line))continue;
    let m;
    if((m=/^style\s+([\w-]+)\s+(.+)$/i.exec(line))){styles.set(m[1],m[2]);continue;}
    if((m=/^classDef\s+([\w-]+)\s+(.+)$/i.exec(line))){classDefs.set(m[1],m[2]);continue;}
    if((m=/^class\s+([\w,\s-]+)\s+([\w-]+)$/i.exec(line))){m[1].split(',').forEach(id=>classOf.set(id.trim(),m[2]));continue;}
    let r=readGroup(line,0);if(!r)continue;let i=r.i,prev=r.ids;
    while(i<line.length){
      const lm=LINK.exec(line.slice(i));if(!lm)break;i+=lm[0].length;
      const op=lm[4];const label=lm[6]!=null?decodeMmLabel(lm[6]):lm[3]?decodeMmLabel(lm[3]):'';
      const nx=readGroup(line,i);if(!nx)break;i=nx.i;
      const style=/\./.test(op)||/^-\./.test(lm[2]||'')?'dashed':'solid';const head=/[>ox]$/.test(op);const width=/=/.test(op)?3.5:2;const invisible=/^~/.test(op);
      if(!invisible)prev.forEach(a=>nx.ids.forEach(b=>edges.push({from:a,to:b,label,style,arrowEnd:head,arrowStart:!!lm[1]&&head,width})));
      prev=nx.ids;
    }
  }
  const css=s=>{const o={};String(s||'').split(',').forEach(kv=>{const [k,v]=kv.split(':').map(x=>x&&x.trim());if(k&&v)o[k.toLowerCase()]=v;});return o;};
  nodes.forEach((n,id)=>{const st={...css(classDefs.get(classOf.get(id))),...css(styles.get(id))};if(st.fill)n.fill=st.fill;if(st.stroke)n.stroke=st.stroke;if(st.color)n.color=st.color;if(st['stroke-dasharray'])n.dash='dashed';});
  return {dir,nodes:[...nodes.values()],edges};
}
function parseState(code){
  const lines=stripComments(code).split('\n').map(l=>l.trim()).filter(Boolean);if(!/^stateDiagram/.test(lines[0]||''))return null;
  const nodes=new Map(),edges=[];let startN=0,endN=0;const dirM=/direction\s+(LR|TB|RL|BT)/i.exec(code);
  const node=(id,isEnd)=>{if(id==='[*]'){const k=isEnd?'__end'+(++endN):'__start'+(++startN);nodes.set(k,{id:k,label:isEnd?'End':'Start',shape:'ellipse',fill:isEnd?'#334155':'#0f172a',color:'#ffffff',w:70,h:40});return k;}if(!nodes.has(id))nodes.set(id,{id,label:id,shape:'round'});return id;};
  for(const l of lines.slice(1)){let m;
    if((m=/^state\s+"([^"]+)"\s+as\s+([\w-]+)/.exec(l))){node(m[2]);nodes.get(m[2]).label=m[1];continue;}
    if((m=/^([\w-]+)\s*:\s*(.+)$/.exec(l))&&!/-->/.test(l)){node(m[1]);nodes.get(m[1]).label=m[1]+'\n'+m[2];continue;}
    if((m=/^(\[\*\]|[\w-]+)\s*-->\s*(\[\*\]|[\w-]+)\s*(?::\s*(.+))?$/.exec(l))){const a=node(m[1],false),b=node(m[2],true);edges.push({from:a,to:b,label:m[3]||''});}
  }
  return {dir:dirM?dirM[1].toUpperCase():'TB',nodes:[...nodes.values()],edges};
}
function parseER(code){
  const src=stripComments(code);if(!/^\s*erDiagram/.test(src))return null;
  const nodes=new Map(),edges=[];const ent=n=>{if(!nodes.has(n))nodes.set(n,{id:n,label:n,attrs:[],shape:'rect'});return nodes.get(n);};
  const block=/^\s*([\w-]+)(?:\["[^"]*"\])?\s*\{([^}]*)\}/gm;let m;while((m=block.exec(src))){const e=ent(m[1]);m[2].split('\n').map(x=>x.trim()).filter(Boolean).forEach(a=>e.attrs.push(a.replace(/\s+/g,' ')));}
  const rel=/^\s*([\w-]+)\s+([|o}{]{2}(?:--|\.\.)[|o}{]{2})\s+([\w-]+)\s*:\s*("[^"]*"|[\w-]+)/gm;while((m=rel.exec(src))){ent(m[1]);ent(m[3]);edges.push({from:m[1],to:m[3],label:m[4].replace(/"/g,'')+'  '+m[2],style:/\.\./.test(m[2])?'dashed':'solid',arrowEnd:false});}
  nodes.forEach(n=>{if(n.attrs.length){n.label=n.id+'\n'+'─'.repeat(Math.min(18,n.id.length+4))+'\n'+n.attrs.join('\n');n.align='left';}});
  return {dir:'LR',nodes:[...nodes.values()],edges};
}
function parseClass(code){
  const src=stripComments(code);if(!/^\s*classDiagram/.test(src))return null;
  const nodes=new Map(),edges=[];const cls=n=>{n=n.replace(/~.*~/,'');if(!nodes.has(n))nodes.set(n,{id:n,label:n,members:[],shape:'rect'});return nodes.get(n);};
  const block=/class\s+([\w-]+)(?:~[^~]*~)?\s*\{([^}]*)\}/g;let m;while((m=block.exec(src))){const c=cls(m[1]);m[2].split('\n').map(x=>x.trim()).filter(Boolean).forEach(x=>c.members.push(x));}
  const one=/^\s*class\s+([\w-]+)\s*$/gm;while((m=one.exec(src)))cls(m[1]);
  const mem=/^\s*([\w-]+)\s*:\s*(.+)$/gm;while((m=mem.exec(src))){if(!/(<\||\*|o|-->|\.\.|--)/.test(m[0].split(':')[0]))cls(m[1]).members.push(m[2].trim());}
  const rel=/^\s*([\w-]+)\s*(?:"[^"]*"\s*)?(<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|--|\.\.)\s*(?:"[^"]*"\s*)?([\w-]+)\s*(?::\s*(.+))?$/gm;
  while((m=rel.exec(src))){cls(m[1]);cls(m[3]);const op=m[2];const rev=op.startsWith('<');edges.push({from:rev?m[3]:m[1],to:rev?m[1]:m[3],label:(m[4]||'').trim(),style:/\.\./.test(op)?'dashed':'solid',arrowEnd:/[>|]/.test(op)||/^</.test(op)});}
  nodes.forEach(n=>{if(n.members.length){n.label=n.id+'\n'+'─'.repeat(Math.min(18,n.id.length+4))+'\n'+n.members.join('\n');n.align='left';}});
  return {dir:'TB',nodes:[...nodes.values()],edges};
}
function parseMindmap(code){
  const lines=stripComments(code).split('\n').filter(l=>l.trim());if(!/^\s*mindmap/.test(lines[0]||''))return null;
  const nodes=[],edges=[];const stack=[];
  lines.slice(1).forEach((l,i)=>{const indent=l.match(/^\s*/)[0].replace(/\t/g,'  ').length;let t=l.trim().replace(/::icon\([^)]*\)/,'').trim();if(!t)return;let shape='round';let label=t;let m;
    if((m=/^[\w-]*\(\((.*)\)\)$/.exec(t))){label=m[1];shape='ellipse';}else if((m=/^[\w-]*\{\{(.*)\}\}$/.exec(t))){label=m[1];shape='hexagon';}else if((m=/^[\w-]*\((.*)\)$/.exec(t))){label=m[1];}else if((m=/^[\w-]*\[(.*)\]$/.exec(t))){label=m[1];shape='rect';}
    const id='m'+i;nodes.push({id,label:decodeMmLabel(label),shape:nodes.length?shape:'ellipse'});
    while(stack.length&&stack[stack.length-1].indent>=indent)stack.pop();if(stack.length)edges.push({from:stack[stack.length-1].id,to:id,arrowEnd:false});stack.push({indent,id});});
  return {dir:'LR',nodes,edges};
}
async function mermaidToCanvas(){
  const code=$('df-code').value||'';
  const g=parseFlowchart(code)||parseState(code)||parseER(code)||parseClass(code)||parseMindmap(code);
  if(!g||!g.nodes.length)return notify('Mermaid → Canvas supports flowchart/graph, state, ER, class and mind-map diagrams. Other types stay in the text editor (export them as SVG/PNG).',true);
  if(doc.nodes.length&&!confirm('Replace the current canvas with '+g.nodes.length+' shapes from the Mermaid text? (Ctrl+Z undoes this.)'))return;
  checkpoint();
  const idMap=new Map();
  const nodes=g.nodes.map(s=>{const n=mkNode(s.shape||'rect',0,0,s.label);if(s.fill)n.fill=s.fill;if(s.stroke)n.stroke=s.stroke;if(s.color)n.color=s.color;if(s.dash)n.dash=s.dash;
    const lines=wrapText(n.label,260,n.fontSize);measureCtx.font=n.fontSize+'px Inter, Arial, sans-serif';const tw=Math.max(...lines.map(l=>measureCtx.measureText(l).width),30);
    const k={diamond:1.7,hexagon:1.4,ellipse:1.35,parallelogram:1.3}[n.shape]||1.12;n.w=s.w||clamp(Math.round(tw*k+36),90,360);n.h=s.h||clamp(Math.round(lines.length*n.fontSize*1.25*(n.shape==='diamond'?1.8:1.15)+30),46,420);
    idMap.set(s.id,n.id);return n;});
  const edges=g.edges.filter(e=>idMap.has(e.from)&&idMap.has(e.to)&&e.from!==e.to).map(e=>({...mkEdge(idMap.get(e.from),idMap.get(e.to),e.label||''),style:e.style||'solid',arrowEnd:e.arrowEnd!==false,arrowStart:!!e.arrowStart,width:e.width||2,route:'curved'}));
  await layoutGraph(nodes,edges,g.dir);
  doc.nodes=nodes;doc.edges=edges;selN=[];selE=null;
  setMode('canvas');commit();updateInspector();requestAnimationFrame(fit);
  notify('Converted '+nodes.length+' shapes and '+edges.length+' connectors to the canvas.');
}

/* ---------------------------------------------------------------- Mermaid rendering */
let mermaidReady=null,renderSeq=0,mermaidTheme=null;
async function ensureMermaid(theme){
  if(!mermaidReady)mermaidReady=lib('mermaid').catch(e=>{mermaidReady=null;throw e;});
  const m=await mermaidReady;
  if(mermaidTheme!==theme){m.initialize({startOnLoad:false,securityLevel:'strict',theme,htmlLabels:false,flowchart:{htmlLabels:false,curve:'basis'},fontFamily:'Inter, "Segoe UI", Arial, sans-serif',suppressErrorRendering:true});mermaidTheme=theme;}
  return m;
}
async function renderMermaid(){
  const out=$('df-mermaid-output'),st=$('df-mermaid-status');const code=$('df-code').value.trim();const seq=++renderSeq;
  doc.mermaid.code=$('df-code').value;
  if(!code){out.innerHTML='<div class="df-empty">Enter Mermaid text or load a template.</div>';st.textContent='Ready';st.className='df-status';return false;}
  st.textContent='Rendering…';st.className='df-status';
  try{
    const m=await ensureMermaid($('df-theme').value||'default');
    try{await m.parse(code);}catch(pe){throw pe;}
    const id='dfm'+Date.now().toString(36)+seq;
    const {svg:svgText,bindFunctions}=await m.render(id,code);
    if(seq!==renderSeq)return false;
    out.innerHTML=svgText;bindFunctions?.(out);
    const s=out.querySelector('svg');if(s){s.style.height='auto';}
    const kind=detectType(code);if(kind&&$('df-type').value!==kind&&!(kind==='flowchart'&&$('df-type').value==='flowchartTD')&&[...$('df-type').options].some(o=>o.value===kind)){$('df-type').value=kind;doc.mermaid.type=kind;}
    st.textContent='✓ Rendered';st.className='df-status ok';return true;
  }catch(e){
    if(seq!==renderSeq)return false;
    document.querySelectorAll('body > [id^="ddfm"], body > [id^="dfm"]').forEach(x=>x.remove());
    const msg=String(e&&(e.message||e.str)||e).replace(/\s+$/,'');
    st.textContent='⚠ '+(msg.split('\n')[0]||'Syntax error');st.className='df-status err';
    out.innerHTML='<pre class="df-error">'+esc(msg)+'</pre>';return false;
  }
}
const TYPE_KEYS=[[/^(flowchart|graph)\b/,'flowchart'],[/^sequenceDiagram/,'sequence'],[/^classDiagram/,'class'],[/^stateDiagram/,'state'],[/^erDiagram/,'er'],[/^mindmap/,'mindmap'],[/^architecture/,'architecture'],[/^C4/,'c4'],[/^gantt/,'gantt'],[/^timeline/,'timeline'],[/^gitGraph/,'git'],[/^pie/,'pie'],[/^journey/,'journey'],[/^requirementDiagram/,'requirement'],[/^sankey/,'sankey'],[/^quadrantChart/,'quadrant'],[/^xychart/,'xychart'],[/^packet/,'packet'],[/^block/,'block'],[/^kanban/,'kanban']];
function detectType(code){const first=stripComments(code).split('\n').map(l=>l.trim()).find(l=>l&&!/^---/.test(l)&&!/^(title|config|%%)/.test(l))||'';const hit=TYPE_KEYS.find(([re])=>re.test(first));return hit?hit[1]:null;}
const liveRender=debounce(()=>{if($('df-live').checked)renderMermaid();},500);

/* ---------------------------------------------------------------- export */
function canvasSVGString({transparent=false,pad=24}={}){
  const ns=doc.nodes;const b=contentBounds(ns);const W=Math.ceil(b.w+pad*2),H=Math.ceil(b.h+pad*2);
  const s=document.createElementNS(NS,'svg');s.setAttribute('xmlns',NS);s.setAttribute('xmlns:xlink','http://www.w3.org/1999/xlink');s.setAttribute('width',W);s.setAttribute('height',H);s.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const defs=el('defs',null,s);if(!transparent)el('rect',{x:0,y:0,width:W,height:H,fill:'#ffffff'},s);
  const g=el('g',{transform:`translate(${pad-b.x} ${pad-b.y})`},s);
  doc.edges.forEach(e=>drawEdge(e,g,defs));doc.nodes.forEach(n=>drawNode(n,g));
  return {text:'<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(s),W,H};
}
function mermaidSVGString(){const s=document.querySelector('#df-mermaid-output svg');if(!s)return null;const c=s.cloneNode(true);c.setAttribute('xmlns',NS);const vb=s.viewBox?.baseVal;const W=Math.ceil(vb&&vb.width||s.getBoundingClientRect().width||800),H=Math.ceil(vb&&vb.height||s.getBoundingClientRect().height||600);c.setAttribute('width',W);c.setAttribute('height',H);c.style.maxWidth='';return {text:'<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(c),W,H};}
async function svgToPng(svgText,W,H,{transparent=false,scale=2}={}){
  const url=URL.createObjectURL(new Blob([svgText],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('The SVG could not be rasterised.'));i.src=url;});
    const sc=Math.min(scale,8000/Math.max(W,H));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(W*sc));c.height=Math.max(1,Math.round(H*sc));const x=c.getContext('2d');
    if(!transparent){x.fillStyle='#ffffff';x.fillRect(0,0,c.width,c.height);}x.drawImage(img,0,0,c.width,c.height);
    return await new Promise((res,rej)=>{try{c.toBlob(b=>b?res(b):rej(new Error('PNG encoding failed')),'image/png');}catch(e){rej(new Error('This diagram contains content the browser will not rasterise; export SVG instead.'));}});
  }finally{URL.revokeObjectURL(url);}
}
const safeName=()=>(docName||'diagram').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|]+/g,'_').trim()||'diagram';
async function exportAs(kind){
  const fromText=mode==='text';
  try{
    if(kind==='mmd'){download(new Blob([$('df-code').value],{type:'text/plain;charset=utf-8'}),safeName()+'.mmd');return;}
    if(kind==='drawio'){if(!doc.nodes.length)return notify('The canvas is empty.',true);download(new Blob([toDrawio()],{type:'application/xml'}),safeName()+'.drawio');return;}
    let S;
    if(fromText){if(!document.querySelector('#df-mermaid-output svg')&&!(await renderMermaid()))return notify('Fix the Mermaid errors before exporting.',true);S=mermaidSVGString();}
    else{if(!doc.nodes.length)return notify('The canvas is empty — nothing to export.',true);S=canvasSVGString({transparent:kind==='png-t'});}
    if(!S)return notify('Nothing to export.',true);
    if(kind==='svg'){download(new Blob([S.text],{type:'image/svg+xml'}),safeName()+'.svg');return;}
    if(kind==='copy-svg'){await navigator.clipboard.writeText(S.text);notify('SVG copied to the clipboard.');return;}
    if(kind==='png'||kind==='png-t'){download(await svgToPng(S.text,S.W,S.H,{transparent:kind==='png-t'}),safeName()+'.png');return;}
    if(kind==='print'){printSVG(S);return;}
  }catch(e){console.error(e);notify('Export failed: '+(e.message||e),true);}
}
function printSVG(S){
  const f=document.createElement('iframe');f.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';document.body.appendChild(f);
  const landscape=S.W>S.H;const d=f.contentDocument;d.open();d.write('<!doctype html><html><head><meta charset="utf-8"><title>'+esc(safeName())+'</title><style>@page{size:'+(landscape?'landscape':'portrait')+';margin:10mm}html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>'+S.text.replace(/^<\?xml[^>]*>\s*/,'')+'</body></html>');d.close();
  setTimeout(()=>{try{f.contentWindow.focus();f.contentWindow.print();}catch(e){notify('Printing failed: '+e.message,true);}setTimeout(()=>f.remove(),60000);},150);
}

/* ---------------------------------------------------------------- draw.io interop */
const xmlEsc=s=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
function toDrawio(){
  const cells=['<mxCell id="0"/>','<mxCell id="1" parent="0"/>'];
  const style=n=>{const base={rect:'rounded=0;',round:'rounded=1;arcSize=20;',ellipse:'ellipse;',diamond:'rhombus;',parallelogram:'shape=parallelogram;perimeter=parallelogramPerimeter;fixedSize=1;',hexagon:'shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;',cylinder:'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=12;',document:'shape=document;boundedLbl=1;',sticky:'shape=note;size=16;',text:'text;align=center;verticalAlign=middle;'}[n.shape]||'rounded=0;';
    let s=base+'whiteSpace=wrap;html=1;';if(n.shape!=='text'){s+='fillColor='+(n.fill==='none'?'none':n.fill)+';strokeColor='+(n.stroke==='none'?'none':n.stroke)+';strokeWidth='+(n.sw??1.5)+';';}else s+='strokeColor=none;fillColor=none;';s+='fontColor='+(n.color||'#0f172a')+';fontSize='+(n.fontSize||15)+';';if(n.bold)s+='fontStyle=1;';if(n.dash)s+='dashed=1;'+(n.dash==='dotted'?'dashPattern=1 3;':'');return s;};
  doc.nodes.forEach(n=>{
    if(n.shape==='pen'){const pts=(n.points||[]).map(p=>'<mxPoint x="'+(n.x+p[0]).toFixed(1)+'" y="'+(n.y+p[1]).toFixed(1)+'"/>');if(pts.length<2)return;cells.push('<mxCell id="'+xmlEsc(n.id)+'" style="endArrow=none;html=1;curved=1;strokeColor='+(n.stroke||'#0f172a')+';strokeWidth='+(n.sw||3)+';" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="'+(n.x+n.points[0][0])+'" y="'+(n.y+n.points[0][1])+'" as="sourcePoint"/><mxPoint x="'+(n.x+n.points.at(-1)[0])+'" y="'+(n.y+n.points.at(-1)[1])+'" as="targetPoint"/><Array as="points">'+pts.slice(1,-1).join('')+'</Array></mxGeometry></mxCell>');return;}
    if(n.shape==='image'){const m=/^data:([^;]+);base64,(.*)$/.exec(n.src||'');cells.push('<mxCell id="'+xmlEsc(n.id)+'" value="" style="shape=image;imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;html=1;image='+(m?'data:'+m[1]+','+m[2]:xmlEsc(n.src||''))+';" vertex="1" parent="1"><mxGeometry x="'+n.x+'" y="'+n.y+'" width="'+n.w+'" height="'+n.h+'" as="geometry"/></mxCell>');return;}
    cells.push('<mxCell id="'+xmlEsc(n.id)+'" value="'+xmlEsc(esc(n.label||'').replace(/\n/g,'<br>'))+'" style="'+style(n)+'" vertex="1" parent="1"><mxGeometry x="'+Math.round(n.x)+'" y="'+Math.round(n.y)+'" width="'+Math.round(n.w)+'" height="'+Math.round(n.h)+'" as="geometry"/></mxCell>');
  });
  doc.edges.forEach(e=>{let s='html=1;rounded=1;strokeColor='+(e.color||'#64748b')+';strokeWidth='+(e.width||2)+';endArrow='+(e.arrowEnd!==false?'classic':'none')+';startArrow='+(e.arrowStart?'classic':'none')+';';if(e.route==='orthogonal')s+='edgeStyle=orthogonalEdgeStyle;';else if(e.route==='curved')s+='curved=1;edgeStyle=orthogonalEdgeStyle;';if(e.style==='dashed')s+='dashed=1;';if(e.style==='dotted')s+='dashed=1;dashPattern=1 3;';
    cells.push('<mxCell id="'+xmlEsc(e.id)+'" value="'+xmlEsc(esc(e.label||''))+'" style="'+s+'" edge="1" parent="1" source="'+xmlEsc(e.from)+'" target="'+xmlEsc(e.to)+'"><mxGeometry relative="1" as="geometry"/></mxCell>');});
  return '<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="Redmark Forge" agent="Redmark Forge Diagram Forge" version="24.0.0"><diagram id="'+uid('d')+'" name="'+xmlEsc(safeName())+'"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="12" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root>'+cells.join('')+'</root></mxGraphModel></diagram></mxfile>';
}
async function inflateDrawio(text){
  const bin=atob(text.trim());const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress compressed draw.io files. In draw.io choose File → Properties → uncheck “Compressed”, then save again.');
  const ds=new DecompressionStream('deflate-raw');const out=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  return decodeURIComponent(out);
}
function styleMap(s){const o={};String(s||'').split(';').forEach(p=>{if(!p)return;const i=p.indexOf('=');if(i<0)o[p]=true;else o[p.slice(0,i)]=p.slice(i+1);});return o;}
function htmlToText(v){if(!/[<&]/.test(v))return v;const d=new DOMParser().parseFromString('<div>'+String(v).replace(/<br\s*\/?>/gi,'\n').replace(/<\/(div|p|li)>/gi,'\n')+'</div>','text/html');return (d.body.textContent||'').replace(/\n{2,}/g,'\n').trim();}
async function fromDrawio(xmlText){
  let x=new DOMParser().parseFromString(xmlText,'application/xml');if(x.querySelector('parsererror'))throw new Error('This is not valid draw.io XML.');
  let model=x.querySelector('mxGraphModel');
  if(!model){const dg=x.querySelector('diagram');if(!dg)throw new Error('No diagram found in this file.');const inner=await inflateDrawio(dg.textContent||'');x=new DOMParser().parseFromString(inner,'application/xml');model=x.querySelector('mxGraphModel');}
  if(!model)throw new Error('No mxGraphModel found.');
  const cells=[...model.querySelectorAll('mxCell')];const byId=new Map(cells.map(c=>[c.getAttribute('id'),c]));
  const abs=c=>{let ox=0,oy=0;let p=byId.get(c.getAttribute('parent'));while(p&&p.getAttribute('vertex')==='1'){const g=p.querySelector(':scope>mxGeometry');ox+=+(g?.getAttribute('x')||0);oy+=+(g?.getAttribute('y')||0);p=byId.get(p.getAttribute('parent'));}return {ox,oy};};
  const nodes=[],edges=[],edgeLabels=new Map();
  cells.forEach(c=>{
    const st=styleMap(c.getAttribute('style'));const geo=c.querySelector(':scope>mxGeometry');
    if(c.getAttribute('vertex')==='1'&&geo){
      const value=htmlToText(c.getAttribute('value')||'');
      const parent=byId.get(c.getAttribute('parent'));if(parent&&parent.getAttribute('edge')==='1'){edgeLabels.set(parent.getAttribute('id'),value);return;}
      if(st.edgeLabel){return;}
      const {ox,oy}=abs(c);const shape=st.ellipse||st.shape==='ellipse'||st.shape==='doubleEllipse'?'ellipse':st.rhombus||st.shape==='rhombus'?'diamond':st.shape==='parallelogram'||st.shape==='trapezoid'?'parallelogram':/cylinder/.test(st.shape||'')||st.shape==='datastore'?'cylinder':/hexagon/.test(st.shape||'')?'hexagon':st.shape==='document'?'document':st.shape==='note'?'sticky':st.text?'text':st.shape==='image'||st.image?'image':st.rounded==='1'?'round':'rect';
      const n=mkNode(shape,ox+ +(geo.getAttribute('x')||0),oy+ +(geo.getAttribute('y')||0),value);n.id=c.getAttribute('id')||uid('n');n.w=+(geo.getAttribute('width')||120);n.h=+(geo.getAttribute('height')||60);
      if(st.fillColor&&st.fillColor!=='default')n.fill=st.fillColor==='none'?'none':st.fillColor;if(st.strokeColor&&st.strokeColor!=='default')n.stroke=st.strokeColor==='none'?'none':st.strokeColor;if(st.fontColor)n.color=st.fontColor;if(st.fontSize)n.fontSize=+st.fontSize;if(st.strokeWidth)n.sw=+st.strokeWidth;if(st.dashed==='1')n.dash='dashed';if((+st.fontStyle||0)&1)n.bold=true;
      if(shape==='text'){n.fill='none';n.stroke='none';}
      if(shape==='image'){let src=st.image||'';const m=/^data:([^,;]+),(.*)$/.exec(src);if(m&&!/;base64/.test(src))src='data:'+m[1]+';base64,'+m[2];n.src=src;n.fill='none';n.stroke='none';n.label='';}
      if(st.swimlane||st.group){n.fill=n.fill==='#ffffff'?'none':n.fill;}
      nodes.push(n);
    }
  });
  const ids=new Set(nodes.map(n=>n.id));
  cells.forEach(c=>{if(c.getAttribute('edge')!=='1')return;const s=c.getAttribute('source'),t=c.getAttribute('target');if(!ids.has(s)||!ids.has(t)||s===t)return;const st=styleMap(c.getAttribute('style'));const e=mkEdge(s,t,htmlToText(c.getAttribute('value')||'')||edgeLabels.get(c.getAttribute('id'))||'');e.id=c.getAttribute('id')||e.id;e.route=st.curved==='1'?'curved':/orthogonal|elbow/i.test(st.edgeStyle||'')?'orthogonal':'straight';if(st.dashed==='1')e.style='dashed';e.arrowEnd=st.endArrow!=='none';e.arrowStart=!!st.startArrow&&st.startArrow!=='none';if(st.strokeColor&&st.strokeColor!=='default'&&st.strokeColor!=='none')e.color=st.strokeColor;if(st.strokeWidth)e.width=+st.strokeWidth;edges.push(e);});
  if(!nodes.length)throw new Error('The draw.io file contains no shapes this editor can import.');
  return {nodes,edges};
}

/* ---------------------------------------------------------------- files */
async function openFile(file){
  if(!file)return;
  const name=file.name||'diagram';const e=(name.split('.').pop()||'').toLowerCase();
  try{
    const text=await file.text();
    if(e==='mmd'||e==='mermaid'||((e==='md'||e==='txt')&&!/^\s*[{<]/.test(text))){const m=/```mermaid\s*([\s\S]*?)```/.exec(text);$('df-code').value=(m?m[1]:text).trim();doc.mermaid.code=$('df-code').value;setMode('text');renderMermaid();setDirty();saveLocalSoon();notify('Opened '+name+' in the text editor.');return;}
    if(e==='drawio'||e==='xml'||/^\s*<(\?xml|mxfile|mxGraphModel)/.test(text)){if(doc.nodes.length&&!confirm('Replace the current canvas with '+name+'?'))return;const g=await fromDrawio(text);checkpoint();doc.nodes=g.nodes;doc.edges=g.edges;}
    else{const x=JSON.parse(text);if(doc.nodes.length&&dirty&&!confirm('Replace the current diagram with '+name+'?'))return;checkpoint();const d=migrate(x);doc.nodes=d.nodes;doc.edges=d.edges;doc.view=d.view;doc.mermaid=d.mermaid;$('df-code').value=d.mermaid.code;$('df-theme').value=d.mermaid.theme||'default';if([...$('df-type').options].some(o=>o.value===d.mermaid.type))$('df-type').value=d.mermaid.type;}
    docName=name.replace(/\.[^.]+$/,'');$('df-docname').textContent=docName;selN=[];selE=null;updateInspector();setMode('canvas');commit();setDirty(false);requestAnimationFrame(fit);renderMermaid();
    notify('Opened '+name+'.');
  }catch(err){console.error(err);notify('Could not open '+name+': '+(err.message||err),true);}
}
function saveProject(){
  doc.mermaid={type:$('df-type').value,code:$('df-code').value,theme:$('df-theme').value};
  const data=JSON.stringify({...doc,app:'Redmark Forge Diagram Forge',savedAt:new Date().toISOString()},null,1);
  download(new Blob([data],{type:'application/json'}),safeName()+'.diagram.json');setDirty(false);saveLocalSoon();notify('Saved '+safeName()+'.diagram.json');
}
function newDiagram(){if(dirty&&doc.nodes.length&&!confirm('Start a new diagram? Unsaved changes are kept only in undo history.'))return;checkpoint();const d=starterDoc();doc.nodes=d.nodes;doc.edges=d.edges;doc.view={zoom:1,pan:{x:40,y:40}};docName='Untitled diagram';$('df-docname').textContent=docName;selN=[];selE=null;updateInspector();setMode('canvas');commit();requestAnimationFrame(fit);}
function insertImage(file){
  if(!file||!/^image\//.test(file.type))return notify('Choose an image file.',true);
  const r=new FileReader();r.onload=async()=>{const src=r.result;const img=new Image();img.onload=()=>{checkpoint();const max=360;const sc=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const n=mkNode('image',0,0,'');n.w=Math.round(img.naturalWidth*sc)||200;n.h=Math.round(img.naturalHeight*sc)||150;n.fill='none';n.stroke='none';n.sw=0;n.src=src;const rr=svg.getBoundingClientRect();const c={x:(rr.width/2-doc.view.pan.x)/doc.view.zoom,y:(rr.height/2-doc.view.pan.y)/doc.view.zoom};n.x=snapV(c.x-n.w/2);n.y=snapV(c.y-n.h/2);doc.nodes.push(n);selectOnly([n.id]);commit();};img.onerror=()=>notify('That image could not be decoded.',true);img.src=src;};r.readAsDataURL(file);
}

/* ---------------------------------------------------------------- mode + keyboard */
function setMode(m){mode=m;['canvas','text'].forEach(k=>{const on=k===m;$('df-mode-'+k).classList.toggle('active',on);$('df-mode-'+k).setAttribute('aria-selected',String(on));$('df-pane-'+k).classList.toggle('active',on);});if(m==='canvas')requestAnimationFrame(render);if(m==='text'&&!document.querySelector('#df-mermaid-output svg'))renderMermaid();}
function onKey(e){
  if(!isActive())return;
  const mod=e.ctrlKey||e.metaKey,k=(e.key||'').toLowerCase();
  if(mod&&k==='s'){e.preventDefault();saveProject();return;}
  if(mod&&k==='o'){e.preventDefault();$('df-file').click();return;}
  if(mode==='text'){if(mod&&e.key==='Enter'){e.preventDefault();renderMermaid();}return;}
  if(typing(document.activeElement)||editor)return;
  if(e.code==='Space'&&!spaceDown){spaceDown=true;e.preventDefault();render();return;}
  if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(mod&&k==='y'){e.preventDefault();redo();return;}
  if(mod&&k==='c'){if(copySel()){e.preventDefault();try{navigator.clipboard?.writeText(JSON.stringify({redmarkDiagramClip:1,...clip}));}catch(_){}}return;}
  if(mod&&k==='x'){if(copySel()){e.preventDefault();deleteSelection();}return;}
  if(mod&&k==='v'){return;/* handled by the paste event so images can be pasted too */}
  if(mod&&k==='d'){e.preventDefault();duplicate();return;}
  if(mod&&k==='a'){e.preventDefault();selN=doc.nodes.map(n=>n.id);selE=null;updateInspector();render();return;}
  if(mod&&k==='g'){e.preventDefault();e.shiftKey?ungroupSel():groupSel();return;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSelection();return;}
  if(e.key==='Escape'){selN=[];selE=null;drag=null;setTool('select');updateInspector();render();return;}
  if(e.key==='Enter'&&selN.length===1){e.preventDefault();openEditor(selN[0]);return;}
  if(e.key==='F2'&&selE){e.preventDefault();openEdgeEditor(selE);return;}
  const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(arrows[e.key]&&selN.length){e.preventDefault();const st=e.shiftKey?10:1;checkpoint();selN.forEach(id=>{const n=nodeById(id);if(n){n.x+=arrows[e.key][0]*st;n.y+=arrows[e.key][1]*st;}});commit();return;}
  if(e.key==='!'||(e.shiftKey&&e.code==='Digit1')){e.preventDefault();fit();return;}
  if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(1.2);return;}
  if(e.key==='-'||e.key==='_'){e.preventDefault();zoomAt(1/1.2);return;}
  if(mod||e.altKey)return;
  const map={v:'select',h:'pan',r:'rect',o:'ellipse',d:'diamond',n:'sticky',t:'text',p:'pen',c:'connector'};if(map[k]){e.preventDefault();setTool(map[k]);}
}

/* ---------------------------------------------------------------- init */
function init(){
  const r=root();if(!r||r.dataset.dfWired)return;r.dataset.dfWired='1';
  svg=$('df-canvas');wrap=$('df-canvas-wrap');if(!svg||!wrap)return;
  /* restore autosave (new key first, then the legacy v1/v3 key) */
  let restored=null;try{const x=JSON.parse(store.get(STORE_KEY)||'null');if(x&&x.doc){restored=migrate(x.doc);docName=x.name||docName;}}catch(_){}
  if(!restored){try{const old=JSON.parse(store.get(LEGACY_KEY)||'null');if(old&&(old.nodes?.length||old.code))restored=migrate(old);}catch(_){}}
  doc=restored&&(restored.nodes.length||restored.mermaid.code)?restored:starterDoc();
  if(!doc.nodes.length&&!restored)doc=starterDoc();
  $('df-docname').textContent=docName;
  $('df-code').value=doc.mermaid.code||TEMPLATES.flowchart;$('df-theme').value=doc.mermaid.theme||'default';if([...$('df-type').options].some(o=>o.value===doc.mermaid.type))$('df-type').value=doc.mermaid.type;
  $('df-snap').checked=doc.snap!==false;$('df-grid').checked=doc.grid!==false;
  /* canvas events */
  svg.addEventListener('pointerdown',onDown);svg.addEventListener('pointermove',onMove);svg.addEventListener('pointerup',onUp);svg.addEventListener('pointercancel',onUp);
  svg.addEventListener('pointerleave',()=>{if(!drag&&hoverNode){hoverNode=null;render();}});
  svg.addEventListener('dblclick',onDbl);svg.addEventListener('wheel',onWheel,{passive:false});
  svg.addEventListener('contextmenu',e=>{if(drag)e.preventDefault();});
  wrap.addEventListener('dragover',e=>{if([...(e.dataTransfer?.types||[])].includes('Files'))e.preventDefault();});
  wrap.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(!f)return;e.preventDefault();if(/^image\//.test(f.type))insertImage(f);else openFile(f);});
  document.addEventListener('keydown',onKey);
  document.addEventListener('keyup',e=>{if(e.code==='Space'&&spaceDown){spaceDown=false;render();}});
  document.addEventListener('paste',e=>{
    if(!isActive()||mode!=='canvas'||typing(document.activeElement)||editor)return;
    const items=[...(e.clipboardData?.items||[])];const img=items.find(i=>/^image\//.test(i.type));
    if(img){e.preventDefault();insertImage(img.getAsFile());return;}
    const t=e.clipboardData?.getData('text/plain')||'';
    if(/^\s*\{"redmarkDiagramClip"/.test(t)){try{const x=JSON.parse(t);clip={nodes:x.nodes||[],edges:x.edges||[]};}catch(_){}}
    if(clip){e.preventDefault();pasteClip();return;}
    if(t.trim()){e.preventDefault();const rr=svg.getBoundingClientRect();addNode('round',(rr.width/2-doc.view.pan.x)/doc.view.zoom,(rr.height/2-doc.view.pan.y)/doc.view.zoom,t.trim().slice(0,500));}
  });
  /* toolbar */
  document.querySelectorAll('#df-tools .df-tool').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  $('df-image-file').addEventListener('change',e=>{insertImage(e.target.files?.[0]);e.target.value='';});
  $('df-undo').onclick=undo;$('df-redo').onclick=redo;$('df-delete').onclick=deleteSelection;$('df-duplicate').onclick=duplicate;
  $('df-group').onclick=groupSel;$('df-ungroup').onclick=ungroupSel;$('df-front').onclick=()=>zorder(true);$('df-back').onclick=()=>zorder(false);
  $('df-align').onchange=e=>{const v=e.target.value;e.target.value='';if(v)alignSel(v);};
  $('df-autolayout').onclick=autoLayout;$('df-to-mermaid').onclick=canvasToMermaid;
  $('df-snap').onchange=e=>{doc.snap=e.target.checked;saveLocalSoon();};$('df-grid').onchange=e=>{doc.grid=e.target.checked;render();saveLocalSoon();};
  $('df-zoom-in').onclick=()=>zoomAt(1.2);$('df-zoom-out').onclick=()=>zoomAt(1/1.2);$('df-zoom-label').onclick=()=>{const rr=svg.getBoundingClientRect();zoomAt(1/doc.view.zoom,rr.width/2,rr.height/2);};$('df-fit').onclick=fit;
  /* header */
  $('df-new').onclick=newDiagram;$('df-open').onclick=()=>$('df-file').click();$('df-file').onchange=e=>{const f=e.target.files?.[0];e.target.value='';if(f)openFile(f);};
  $('df-save').onclick=saveProject;$('df-export').onchange=e=>{const v=e.target.value;e.target.value='';if(v)exportAs(v);};
  $('df-mode-canvas').onclick=()=>setMode('canvas');$('df-mode-text').onclick=()=>setMode('text');
  /* text pane */
  $('df-code').addEventListener('input',()=>{setDirty();saveLocalSoon();liveRender();});
  $('df-code').addEventListener('keydown',e=>{if(e.key==='Tab'&&!e.ctrlKey){e.preventDefault();const t=e.target;t.setRangeText('  ',t.selectionStart,t.selectionEnd,'end');liveRender();}});
  $('df-render').onclick=renderMermaid;$('df-theme').onchange=()=>{doc.mermaid.theme=$('df-theme').value;renderMermaid();saveLocalSoon();};
  $('df-load-template').onclick=()=>{const t=$('df-type').value;if($('df-code').value.trim()&&$('df-code').value.trim()!==(TEMPLATES[doc.mermaid.type]||'').trim()&&!confirm('Replace the current text with the '+t+' template?'))return;$('df-code').value=TEMPLATES[t]||TEMPLATES.flowchart;doc.mermaid.type=t;renderMermaid();setDirty();saveLocalSoon();};
  $('df-type').onchange=()=>{doc.mermaid.type=$('df-type').value;};
  $('df-to-canvas').onclick=mermaidToCanvas;
  document.querySelectorAll('[data-df-template]').forEach(b=>b.addEventListener('click',()=>{const t=b.dataset.dfTemplate;if($('df-code').value.trim()&&dirty&&!confirm('Replace the Mermaid text with the '+b.textContent.trim()+' template?'))return;$('df-type').value=t;doc.mermaid.type=t;$('df-code').value=TEMPLATES[t];setMode('text');renderMermaid();setDirty();saveLocalSoon();}));
  wireInspector();
  /* sizing: render/fit when the studio becomes visible */
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>render()).observe(wrap);
  const mo=new MutationObserver(()=>{if(isActive()){render();if(mode==='text'&&!document.querySelector('#df-mermaid-output svg'))renderMermaid();}});mo.observe(r,{attributes:true,attributeFilter:['class']});
  addEventListener('beforeunload',()=>{doc.mermaid.code=$('df-code').value;store.set(STORE_KEY,JSON.stringify({doc,name:docName}));});
  setTool('select');updateInspector();render();setDirty(false);
  /* expose wiring to the suite's Validation Lab for buttons that have no id */
  r.querySelectorAll('button:not([id])').forEach(b=>{if(!b.dataset.action)b.dataset.action=b.dataset.tool?'tool-'+b.dataset.tool:b.dataset.dfTemplate?'template-'+b.dataset.dfTemplate:'diagram-control';});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.REDMARK_DIAGRAM_FORGE={renderMermaid,openFile,exportAs,saveProject,setMode,
  addNode:(shape,x,y,label)=>addNode(shape||'rect',x??200,y??150,label??'Node',{}),
  addEdge,fit,undo,redo,
  _test:{doc:()=>doc,parseFlowchart,parseState,parseER,parseClass,parseMindmap,mermaidToCanvas,canvasToMermaid,toDrawio,fromDrawio,canvasSVGString,svgToPng,migrate,autoLayout,select:ids=>{selN=ids;selE=null;updateInspector();render();},selectEdge:id=>{selN=[];selE=id;updateInspector();render();},TEMPLATES}};
})();
