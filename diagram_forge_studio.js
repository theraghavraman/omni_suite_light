/* Redmark Forge — Diagram Forge
 * Browser-first diagramming studio inspired by open-source diagram ecosystems.
 * No proprietary editor code is copied. Mermaid provides text-to-diagram rendering;
 * the visual canvas below is Redmark Forge's own lightweight SVG editor.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dl=(blob,name)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);};
let nodes=[],edges=[],selected=null,edgeStart=null,zoom=1,pan={x:0,y:0},drag=null,history=[],future=[],currentType='flowchart',mermaidReady=null;

const templates={
 flowchart:`flowchart LR
 A[Start] --> B{Decision}
 B -->|Yes| C[Process]
 B -->|No| D[Alternative]
 C --> E[Finish]
 D --> E`,
 sequence:`sequenceDiagram
 participant U as User
 participant A as Application
 participant DB as Database
 U->>A: Request
 A->>DB: Query
 DB-->>A: Result
 A-->>U: Response`,
 class:`classDiagram
 class Customer {
   +id: int
   +name: string
 }
 class Order {
   +id: int
   +amount: decimal
 }
 Customer "1" --> "*" Order`,
 state:`stateDiagram-v2
 [*] --> Idle
 Idle --> Processing: start
 Processing --> Complete: success
 Processing --> Failed: error
 Complete --> [*]
 Failed --> Idle: retry`,
 er:`erDiagram
 CUSTOMER ||--o{ ORDER : places
 CUSTOMER {
   int id PK
   string name
 }
 ORDER {
   int id PK
   int customer_id FK
   decimal amount
 }`,
 mindmap:`mindmap
 root((Redmark Forge))
   Data
     CSV
     SQL
     JSON
   Engineering
     ETL
     APIs
   Documentation
     Architecture
     Processes`,
 architecture:`architecture-beta
 group app(cloud)[Application]
 service web(server)[Web] in app
 service api(server)[API] in app
 service db(database)[Database] in app
 web:R -- L:api
 api:R -- L:db`,
 gantt:`gantt
 title Project Plan
 dateFormat YYYY-MM-DD
 section Build
 Design :done, d1, 2026-10-01, 3d
 Development :active, d2, after d1, 7d
 Testing :d3, after d2, 4d`,
 timeline:`timeline
 title Product Timeline
 2026 : Research
      : Prototype
 2027 : Launch
      : Scale`,
 git:`gitGraph
 commit id: "Initial"
 branch develop
 checkout develop
 commit id: "Feature"
 checkout main
 merge develop tag: "v1.0"`,
 pie:`pie title Example
 "Browser" : 60
 "Local Engine" : 25
 "Other" : 15`,
 flowchartTD:`flowchart TD
 Client --> API
 API --> Auth
 API --> Data
 Data --> DB`
};
Object.assign(templates,{journey:'journey\n title User Journey\n section Discover\n  Search: 5: User\n  Compare: 4: User\n section Use\n  Create: 5: User\n  Export: 5: User',requirement:'requirementDiagram\n requirement checkout_req {\n  id: 1\n  text: Orders must be payable online.\n  risk: high\n  verifymethod: test\n }\n element checkout_service {\n  type: service\n }\n checkout_service - satisfies -> checkout_req',c4:'C4Context\n title System Context\n Person(user, "User")\n System(app, "Redmark Forge")\n SystemDb(db, "Browser Data")\n Rel(user, app, "uses")\n Rel(app, db, "stores locally")',sankey:'sankey-beta\nBrowser,Editor,60\nEditor,Export,35\nEditor,Storage,25',quadrant:'quadrantChart\n title Priority Matrix\n x-axis Low --> High\n y-axis Low --> High\n quadrant-1 Strategic\n quadrant-2 Invest\n quadrant-3 Defer\n quadrant-4 Quick wins\n Feature A: [0.8,0.7]\n Feature B: [0.7,0.3]',xychart:'xychart-beta\n title "Weekly Activity"\n x-axis [Mon, Tue, Wed, Thu, Fri]\n y-axis "Tasks" 0 --> 10\n bar [3,5,4,8,7]\n line [2,4,6,7,9]',packet:'packet\n 0-7: "Version"\n 8-15: "Type"\n 16-31: "Length"\n 32-63: "Payload"',block:'block-beta\n columns 3\n A[Client] B[API] C[Database]\n A --> B\n B --> C',eventmodeling:'flowchart LR\n C[Command] --> E[Event] --> R[Read Model]\n E --> P[Policy] --> C'});

function saveState(){
 const s=JSON.stringify({nodes,edges,zoom,pan,currentType,code:$('df-code')?.value||''});
 localStorage.setItem('redmark-forge-diagram',s);
}
function snapshot(){return JSON.stringify({nodes,edges});}
function pushHistory(){history.push(snapshot());if(history.length>60)history.shift();future=[];saveState();}
function restore(raw){try{const x=JSON.parse(raw);nodes=x.nodes||[];edges=x.edges||[];selected=null;edgeStart=null;renderCanvas();updateInspector();}catch(e){}}
function undo(){if(!history.length)return;future.push(snapshot());restore(history.pop());saveState();}
function redo(){if(!future.length)return;history.push(snapshot());restore(future.pop());saveState();}
function addNode(x=220+Math.random()*220,y=150+Math.random()*180,label='Node'){
 pushHistory();const id='n'+Date.now()+Math.random().toString(16).slice(2);nodes.push({id,x,y,label,shape:$('df-shape')?.value||'rect',w:150,h:70,fill:'#ffffff',stroke:'#475569',color:'#0f172a',fontSize:16});selected=id;renderCanvas();updateInspector();return id;
}
function removeSelected(){if(!selected)return;pushHistory();nodes=nodes.filter(n=>n.id!==selected);edges=edges.filter(e=>e.from!==selected&&e.to!==selected);selected=null;renderCanvas();updateInspector();}
function addEdge(a,b){if(!a||!b||a===b)return;pushHistory();if(!edges.some(e=>e.from===a&&e.to===b))edges.push({from:a,to:b,label:''});renderCanvas();updateInspector();}
function nodeBy(id){return nodes.find(n=>n.id===id);}
function svgEl(tag,attrs){const e=document.createElementNS(NS,tag);Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));return e;}
function pointFor(n,side){if(side==='left')return{x:n.x,y:n.y+n.h/2};if(side==='right')return{x:n.x+n.w,y:n.y+n.h/2};return{x:n.x+n.w/2,y:n.y+n.h/2};}
function renderCanvas(){
 const svg=$('df-canvas');if(!svg)return;svg.innerHTML='';
 const defs=svgEl('defs');const marker=svgEl('marker',{id:'df-arrow',markerWidth:8,markerHeight:8,refX:7,refY:4,orient:'auto'});marker.appendChild(svgEl('path',{d:'M0,0 L8,4 L0,8 Z',fill:'#64748b'}));defs.appendChild(marker);
 const pat=svgEl('pattern',{id:'df-grid',width:24,height:24,patternUnits:'userSpaceOnUse'});pat.appendChild(svgEl('path',{d:'M 24 0 L 0 0 0 24',fill:'none',stroke:'#e2e8f0','stroke-width':1}));defs.appendChild(pat);svg.appendChild(defs);
 const g=svgEl('g',{transform:'translate('+pan.x+' '+pan.y+') scale('+zoom+')'});svg.appendChild(g);
 g.appendChild(svgEl('rect',{x:-5000,y:-5000,width:10000,height:10000,fill:$('df-grid-toggle')?.checked?'url(#df-grid)':'#fff'}));
 edges.forEach(e=>{const a=nodeBy(e.from),b=nodeBy(e.to);if(!a||!b)return;const p1=pointFor(a,'right'),p2=pointFor(b,'left');const path=svgEl('path',{d:'M '+p1.x+' '+p1.y+' C '+(p1.x+70)+' '+p1.y+' '+(p2.x-70)+' '+p2.y+' '+p2.x+' '+p2.y,fill:'none',stroke:'#64748b','stroke-width':2,'marker-end':'url(#df-arrow)'});g.appendChild(path);if(e.label){const t=svgEl('text',{x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2-7,'font-size':12,fill:'#475569','text-anchor':'middle'});t.textContent=e.label;g.appendChild(t);}});
 nodes.forEach(n=>{const group=svgEl('g',{transform:'translate('+n.x+' '+n.y+')',cursor:'move'});const shape=n.shape==='circle'?svgEl('ellipse',{cx:n.w/2,cy:n.h/2,rx:n.w/2,ry:n.h/2}):n.shape==='diamond'?svgEl('polygon',{points:(n.w/2)+',0 '+n.w+','+(n.h/2)+' '+(n.w/2)+','+n.h+' 0,'+(n.h/2)}):svgEl('rect',{x:0,y:0,width:n.w,height:n.h,rx:n.shape==='round'?18:6});shape.setAttribute('fill',n.fill);shape.setAttribute('stroke',n.id===selected?'#e11d48':n.stroke);shape.setAttribute('stroke-width',n.id===selected?3:1.5);group.appendChild(shape);const text=svgEl('text',{x:n.w/2,y:n.h/2+5,'text-anchor':'middle','font-size':n.fontSize,fill:n.color,'font-family':'Inter,Arial,sans-serif'});text.textContent=n.label;group.appendChild(text);group.addEventListener('pointerdown',e=>{e.stopPropagation();selected=n.id;updateInspector();if(e.shiftKey){if(!edgeStart)edgeStart=n.id;else{addEdge(edgeStart,n.id);edgeStart=null;}return;}drag={id:n.id,sx:e.clientX,sy:e.clientY,ox:n.x,oy:n.y};group.setPointerCapture?.(e.pointerId);renderCanvas();});group.addEventListener('dblclick',e=>{e.stopPropagation();const v=prompt('Node label',n.label);if(v!==null){pushHistory();n.label=v;renderCanvas();updateInspector();}});g.appendChild(group);});
}
function canvasToMermaid(){
 if(!nodes.length){alert('Add at least one node first.');return;}
const names=new Map(nodes.map((n,i)=>[n.id,'N'+(i+1)]));
const lines=['flowchart LR'];
nodes.forEach((n,i)=>lines.push(' '+names.get(n.id)+'['+String(n.label||('Node '+(i+1))).replace(/[\\[\\]]/g,'')+']'));
edges.forEach(e=>{if(names.has(e.from)&&names.has(e.to))lines.push(' '+names.get(e.from)+' --> '+names.get(e.to));});
$('df-type').value='flowchart';$('df-code').value=lines.join('\n');renderMermaid();
}
function mermaidToCanvas(){
const code=$('df-code').value||'',lines=code.split(/\r?\n/),parsed=[],links=[];
lines.forEach(line=>{const m=line.match(/([A-Za-z][\\w-]*)\s*(?:\[([^\]]+)\]|\(([^\)]+)\)|\{([^}]+)\})/);if(m){const id=m[1],label=m[2]||m[3]||m[4]||id;if(!parsed.some(n=>n.id===id))parsed.push({id,x:180+(parsed.length%3)*250,y:120+Math.floor(parsed.length/3)*130,label,shape:'rect',w:150,h:70,fill:'#fff',stroke:'#475569',color:'#0f172a',fontSize:16});}const e=line.match(/([A-Za-z][\\w-]*)[^\n]*?(?:-->|---|==>)[^\n]*?([A-Za-z][\\w-]*)/);if(e)links.push({from:e[1],to:e[2],label:''});});
if(!parsed.length){alert('This Mermaid type does not map cleanly to the visual canvas. Use the live Mermaid preview instead.');return;}
pushHistory();nodes=parsed;edges=links.filter(e=>parsed.some(n=>n.id===e.from)&&parsed.some(n=>n.id===e.to));selected=null;renderCanvas();updateInspector();
}
function updateInspector(){
 const n=nodeBy(selected);$('df-selected').textContent=n?('Selected: '+n.label):'No node selected';
 if(!n)return;
 $('df-node-label').value=n.label;$('df-node-fill').value=n.fill;$('df-node-stroke').value=n.stroke;$('df-node-size').value=n.fontSize;$('df-node-shape').value=n.shape;
}
function applyInspector(){const n=nodeBy(selected);if(!n)return;pushHistory();n.label=$('df-node-label').value;n.fill=$('df-node-fill').value;n.stroke=$('df-node-stroke').value;n.fontSize=+$('df-node-size').value||16;n.shape=$('df-node-shape').value;renderCanvas();updateInspector();}
async function ensureMermaid(){
 if(window.mermaid)return window.mermaid;
 if(mermaidReady)return mermaidReady;
 mermaidReady=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js';s.onload=()=>{if(!window.mermaid)return reject(new Error('Mermaid loaded without API'));window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'default'});resolve(window.mermaid);};s.onerror=()=>reject(new Error('Could not load Mermaid 12.1.0'));document.head.appendChild(s);});
 return mermaidReady;
}
async function renderMermaid(){
 const code=$('df-code').value.trim(),out=$('df-mermaid-output');if(!code){out.innerHTML='<div class="df-empty">Enter Mermaid syntax to render.</div>';return;}
 try{const m=await ensureMermaid();const id='dfm'+Date.now();const r=await m.render(id,code);out.innerHTML=r.svg;out.dataset.svg=r.svg;$('df-mermaid-status').textContent='Rendered successfully';saveState();}catch(e){out.innerHTML='<pre class="df-error">'+esc(e.message)+'</pre>';$('df-mermaid-status').textContent='Syntax/render error';}
}
function template(t){currentType=t;$('df-type').value=t;$('df-code').value=templates[t]||templates.flowchart;renderMermaid();}
function downloadSvg(){
 const svg=$('df-mermaid-output svg');if(!svg)return alert('Render a Mermaid diagram first.');const text=new XMLSerializer().serializeToString(svg);dl(new Blob([text],{type:'image/svg+xml'}),'diagram.svg');
}
function downloadPng(){
 const svg=$('df-mermaid-output svg');if(!svg)return alert('Render a Mermaid diagram first.');const text=new XMLSerializer().serializeToString(svg),blob=new Blob([text],{type:'image/svg+xml'}),u=URL.createObjectURL(blob),img=new Image();
 img.onload=()=>{const c=document.createElement('canvas');c.width=Math.max(1,svg.viewBox?.baseVal?.width||svg.getBoundingClientRect().width||1200);c.height=Math.max(1,svg.viewBox?.baseVal?.height||svg.getBoundingClientRect().height||800);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(img,0,0,c.width,c.height);c.toBlob(b=>{dl(b,'diagram.png');URL.revokeObjectURL(u);},'image/png');};img.src=u;
}
function saveProject(){dl(new Blob([JSON.stringify({version:1,type:currentType,code:$('df-code').value,nodes,edges},{null:2})],{type:'application/json'}),'diagram-forge.json');}
function openProject(file){const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);nodes=x.nodes||[];edges=x.edges||[];currentType=x.type||'flowchart';$('df-type').value=currentType;$('df-code').value=x.code||templates[currentType]||templates.flowchart;renderCanvas();updateInspector();renderMermaid();}catch(e){alert('Invalid Diagram Forge project.');}};r.readAsText(file);}
function clearCanvas(){if(!nodes.length)return;pushHistory();nodes=[];edges=[];selected=null;edgeStart=null;renderCanvas();updateInspector();}
function init(){
 const root=$('tabDiagramForge');if(!root)return;
 $('df-new')?.addEventListener('click',()=>{clearCanvas();addNode(260,180,'Start');addNode(520,180,'Process');addEdge(nodes[0].id,nodes[1].id);});
 $('df-add-node')?.addEventListener('click',()=>addNode());
 $('df-delete')?.addEventListener('click',removeSelected);
 $('df-undo')?.addEventListener('click',undo);$('df-redo')?.addEventListener('click',redo);
 $('df-apply')?.addEventListener('click',applyInspector);
 $('df-render')?.addEventListener('click',renderMermaid);$('df-render-2')?.addEventListener('click',renderMermaid);$('df-copy-svg')?.addEventListener('click',async()=>{const svg=$('df-mermaid-output svg');if(svg)await navigator.clipboard?.writeText(new XMLSerializer().serializeToString(svg));});$('df-print')?.addEventListener('click',()=>window.print());$('df-canvas-to-mermaid')?.addEventListener('click',canvasToMermaid);$('df-mermaid-to-canvas')?.addEventListener('click',mermaidToCanvas);
 $('df-template')?.addEventListener('change',e=>template(e.target.value));
 $('df-type')?.addEventListener('change',e=>template(e.target.value));
 $('df-export-svg')?.addEventListener('click',downloadSvg);$('df-export-png')?.addEventListener('click',downloadPng);
 $('df-save')?.addEventListener('click',saveProject);$('df-open')?.addEventListener('click',()=>$('df-file').click());$('df-file')?.addEventListener('change',e=>{if(e.target.files[0])openProject(e.target.files[0]);});
 $('df-clear')?.addEventListener('click',clearCanvas);
 $('df-code')?.addEventListener('input',()=>{clearTimeout(init._t);init._t=setTimeout(renderMermaid,450);saveState();});
 $('df-zoom-in')?.addEventListener('click',()=>{zoom=Math.min(2.5,zoom+.1);renderCanvas();});$('df-zoom-out')?.addEventListener('click',()=>{zoom=Math.max(.35,zoom-.1);renderCanvas();});$('df-fit')?.addEventListener('click',()=>{zoom=1;pan={x:0,y:0};renderCanvas();});
 const svg=$('df-canvas');svg?.addEventListener('pointermove',e=>{if(!drag)return;const n=nodeBy(drag.id);if(!n)return;n.x=drag.ox+(e.clientX-drag.sx)/zoom;n.y=drag.oy+(e.clientY-drag.sy)/zoom;renderCanvas();});svg?.addEventListener('pointerup',()=>{if(drag){pushHistory();drag=null;saveState();}});svg?.addEventListener('pointerdown',e=>{if(e.target===svg){selected=null;edgeStart=null;updateInspector();renderCanvas();}});
 $('df-node-label')?.addEventListener('keydown',e=>{if(e.key==='Enter')applyInspector();});
 document.addEventListener('keydown',e=>{if(!$('tabDiagramForge')?.classList.contains('active'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}if(e.key==='Delete')removeSelected();});
 try{const x=JSON.parse(localStorage.getItem('redmark-forge-diagram')||'null');if(x){nodes=x.nodes||[];edges=x.edges||[];currentType=x.currentType||'flowchart';$('df-type').value=currentType;$('df-code').value=x.code||templates[currentType]||templates.flowchart;}}catch(e){}
 renderCanvas();updateInspector();renderMermaid();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.REDMARK_DIAGRAM_FORGE={renderMermaid,addNode,addEdge,saveProject};
})();

/* ─────────────────────────────────────────────────────────────────────────────
 * Diagram Forge — Infinite Canvas Upgrade
 * A Redmark Forge-native editor layer inspired by current open-source canvas UX.
 * This layer intentionally does not copy Excalidraw/tldraw source.
 * ─────────────────────────────────────────────────────────────────────────── */
(function(){
'use strict';
function bootDFX2(){
  const root=document.getElementById('tabDiagramForge'), old=document.getElementById('df-canvas');
  if(!root||!old||document.getElementById('dfx2-canvas')) return;
  const NS='http://www.w3.org/2000/svg', $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const clone=x=>JSON.parse(JSON.stringify(x));
  const uid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  const dl=(blob,name)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),20000);};
  let model={version:3,nodes:[],edges:[],zoom:1,pan:{x:0,y:0},code:'',currentType:'flowchart'};
  let selected=[],tool='select',drag=null,history=[],future=[],clipboard=null,marquee=null,guides=[],snapOn=true;
  const snapGrid=12;

  try{
    const saved=JSON.parse(localStorage.getItem('redmark-forge-diagram')||'null');
    if(saved){model.nodes=saved.nodes||[];model.edges=saved.edges||[];model.zoom=saved.zoom||1;model.pan=saved.pan||{x:0,y:0};model.code=saved.code||'';model.currentType=saved.currentType||'flowchart';}
  }catch(e){}
  if(!model.nodes.length){
    model.nodes=[
      {id:uid('n'),x:180,y:170,w:160,h:72,label:'Start',shape:'rect',fill:'#ffffff',stroke:'#475569',color:'#0f172a',fontSize:16},
      {id:uid('n'),x:440,y:170,w:160,h:72,label:'Process',shape:'round',fill:'#ffffff',stroke:'#475569',color:'#0f172a',fontSize:16}
    ];
    model.edges=[{id:uid('e'),from:model.nodes[0].id,to:model.nodes[1].id,label:'',arrow:'end',style:'solid'}];
  }

  function saveLocal(){try{localStorage.setItem('redmark-forge-diagram',JSON.stringify(model));}catch(e){}}
  function snap(v){return snapOn?Math.round(v/snapGrid)*snapGrid:v;}
  function node(id){return model.nodes.find(n=>n.id===id);}
  function selectedNodes(){return model.nodes.filter(n=>selected.includes(n.id));}
  function bounds(n){return{x:n.x,y:n.y,w:n.w,h:n.h};}
  function svg(tag,attrs){const e=document.createElementNS(NS,tag);Object.entries(attrs||{}).forEach(([k,v])=>e.setAttribute(k,v));return e;}
  function world(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left-model.pan.x)/model.zoom,y:(e.clientY-r.top-model.pan.y)/model.zoom};}
  function snapshot(){return JSON.stringify({nodes:model.nodes,edges:model.edges,zoom:model.zoom,pan:model.pan});}
  function checkpoint(){history.push(snapshot());if(history.length>80)history.shift();future=[];saveLocal();}
  function restore(raw){const x=JSON.parse(raw);model.nodes=x.nodes||[];model.edges=x.edges||[];model.zoom=x.zoom||1;model.pan=x.pan||{x:0,y:0};selected=[];guides=[];render();saveLocal();}
  function undo(){if(!history.length)return;future.push(snapshot());restore(history.pop());}
  function redo(){if(!future.length)return;history.push(snapshot());restore(future.pop());}
  function addNode(x,y,label,shape){
    checkpoint();
    const n={id:uid('n'),x:snap(x),y:snap(y),w:shape==='sticky'?190:shape==='text'?190:160,h:shape==='sticky'?125:shape==='text'?52:72,label:label||'Node',shape:shape||'rect',fill:shape==='sticky'?'#fff3a3':shape==='text'?'transparent':'#ffffff',stroke:shape==='sticky'?'#d4a72c':shape==='text'?'transparent':'#475569',color:'#0f172a',fontSize:shape==='text'?18:16,groupId:null};
    model.nodes.push(n);selected=[n.id];render();return n;
  }
  function removeSelected(){if(!selected.length)return;checkpoint();const s=new Set(selected);model.nodes=model.nodes.filter(n=>!s.has(n.id));model.edges=model.edges.filter(e=>!s.has(e.from)&&!s.has(e.to));selected=[];render();}
  function copy(){if(!selected.length)return;clipboard={nodes:selected.map(id=>clone(node(id))),edges:model.edges.filter(e=>selected.includes(e.from)&&selected.includes(e.to)).map(clone)};try{navigator.clipboard?.writeText(JSON.stringify(clipboard));}catch(e){}}
  async function paste(){let data=clipboard;try{const t=await navigator.clipboard?.readText();if(t&&t.trim().startsWith('{'))data=JSON.parse(t);}catch(e){}if(!data?.nodes?.length)return;checkpoint();const map=new Map();const ns=data.nodes.map(n=>{const c=clone(n);c.id=uid('n');c.x+=32;c.y+=32;map.set(n.id,c.id);return c;});model.nodes.push(...ns);(data.edges||[]).forEach(e=>{if(map.has(e.from)&&map.has(e.to))model.edges.push({...clone(e),id:uid('e'),from:map.get(e.from),to:map.get(e.to)});});selected=ns.map(n=>n.id);render();}
  function duplicate(){copy();paste();}
  function group(){if(selected.length<2)return;checkpoint();const gid=uid('g');selected.forEach(id=>{const n=node(id);if(n)n.groupId=gid;});render();}
  function ungroup(){const gs=new Set(selectedNodes().map(n=>n.groupId).filter(Boolean));if(!gs.size)return;checkpoint();model.nodes.forEach(n=>{if(gs.has(n.groupId))n.groupId=null;});render();}
  function layer(dir){if(!selected.length)return;checkpoint();const s=new Set(selected),a=model.nodes.filter(n=>!s.has(n.id)),b=model.nodes.filter(n=>s.has(n.id));model.nodes=dir==='front'?a.concat(b):b.concat(a);render();}
  function align(kind){
    const ns=selectedNodes();if(ns.length<2)return;checkpoint();
    if(kind==='left'){const v=Math.min(...ns.map(n=>n.x));ns.forEach(n=>n.x=v);}
    if(kind==='center'){const v=ns.reduce((a,n)=>a+n.x+n.w/2,0)/ns.length;ns.forEach(n=>n.x=v-n.w/2);}
    if(kind==='right'){const v=Math.max(...ns.map(n=>n.x+n.w));ns.forEach(n=>n.x=v-n.w);}
    if(kind==='top'){const v=Math.min(...ns.map(n=>n.y));ns.forEach(n=>n.y=v);}
    if(kind==='middle'){const v=ns.reduce((a,n)=>a+n.y+n.h/2,0)/ns.length;ns.forEach(n=>n.y=v-n.h/2);}
    if(kind==='bottom'){const v=Math.max(...ns.map(n=>n.y+n.h));ns.forEach(n=>n.y=v-n.h);}
    render();
  }
  function distribute(axis){
    const ns=selectedNodes().sort((a,b)=>(axis==='x'?a.x-b.x:a.y-b.y));if(ns.length<3)return;checkpoint();
    const first=ns[0],last=ns[ns.length-1],span=axis==='x'?last.x-first.x:last.y-first.y,step=span/(ns.length-1);
    ns.slice(1,-1).forEach((n,i)=>{if(axis==='x')n.x=first.x+step*(i+1);else n.y=first.y+step*(i+1);});render();
  }
  function edge(a,b){if(!a||!b||a===b)return;checkpoint();if(!model.edges.some(e=>e.from===a&&e.to===b))model.edges.push({id:uid('e'),from:a,to:b,label:'',arrow:'end',style:'solid'});render();}
  function setTool(t){tool=t;document.querySelectorAll('.dfx2-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));status.textContent=t==='select'?'Select / multi-select':t==='pen'?'Freehand pen':t==='arrow'?'Connector / arrow':t==='pan'?'Pan canvas':t==='sticky'?'Sticky note':t.charAt(0).toUpperCase()+t.slice(1)+' tool';}
  function select(id,add){if(add){selected=selected.includes(id)?selected.filter(x=>x!==id):selected.concat(id);}else if(!selected.includes(id))selected=[id];}
  function resizeSnap(dx,dy){
    let best={dx,dy};guides=[];
    const ns=selectedNodes();if(!snapOn||!ns.length)return best;
    const primary=ns[0];
    const gx=snap(primary.x+dx)-primary.x,gy=snap(primary.y+dy)-primary.y;
    if(Math.abs(gx-dx)<=8)best.dx=gx;
    if(Math.abs(gy-dy)<=8)best.dy=gy;
    model.nodes.filter(n=>!selected.includes(n.id)).forEach(o=>{
      const xs=[o.x,o.x+o.w/2,o.x+o.w],ys=[o.y,o.y+o.h/2,o.y+o.h];
      xs.forEach(v=>{[primary.x+best.dx,primary.x+best.dx+primary.w/2,primary.x+best.dx+primary.w].forEach(q=>{if(Math.abs(q-v)<7){best.dx+=v-q;guides.push({axis:'x',value:v});}});});
      ys.forEach(v=>{[primary.y+best.dy,primary.y+best.dy+primary.h/2,primary.y+best.dy+primary.h].forEach(q=>{if(Math.abs(q-v)<7){best.dy+=v-q;guides.push({axis:'y',value:v});}});});
    });
    return best;
  }

  const host=old.parentElement;
  old.style.opacity='0';
  old.style.pointerEvents='none';
  old.setAttribute('aria-hidden','true');
  const canvas=document.createElementNS(NS,'svg');
  canvas.id='dfx2-canvas';
  canvas.setAttribute('width','100%');canvas.setAttribute('height','100%');
  canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none;background:transparent;';
  host.style.position=host.style.position||'relative';
  host.appendChild(canvas);
  const status=document.createElement('div');status.id='dfx2-status';status.textContent='Select / multi-select';
  host.appendChild(status);
  const bar=document.createElement('div');bar.id='dfx2-toolbar';
  bar.innerHTML='<div class="dfx2-tools">'+
    '<button class="dfx2-tool active" data-tool="select">↖ Select</button>'+
    '<button class="dfx2-tool" data-tool="rect">▭ Shape</button>'+
    '<button class="dfx2-tool" data-tool="ellipse">○ Circle</button>'+
    '<button class="dfx2-tool" data-tool="diamond">◇ Diamond</button>'+
    '<button class="dfx2-tool" data-tool="sticky">▤ Sticky</button>'+
    '<button class="dfx2-tool" data-tool="text">T Text</button>'+
    '<button class="dfx2-tool" data-tool="pen">✎ Pen</button>'+
    '<button class="dfx2-tool" data-tool="arrow">➜ Connector</button>'+
    '<button class="dfx2-tool" data-tool="pan">✋ Pan</button>'+
    '<button class="dfx2-tool" data-tool="image">▧ Image</button></div>'+
    '<span class="dfx2-divider"></span><div class="dfx2-actions">'+
    '<button data-act="group">Group</button><button data-act="ungroup">Ungroup</button><button data-act="duplicate">Duplicate</button><button data-act="copy">Copy</button><button data-act="paste">Paste</button><button data-act="front">Front</button><button data-act="back">Back</button></div>'+
    '<span class="dfx2-divider"></span><div class="dfx2-actions">'+
    '<button data-align="left">Align L</button><button data-align="center">Center X</button><button data-align="right">Align R</button><button data-align="top">Align T</button><button data-align="middle">Center Y</button><button data-align="bottom">Align B</button><button data-act="distx">Distribute H</button><button data-act="disty">Distribute V</button></div>'+
    '<span class="dfx2-divider"></span><label class="dfx2-snap"><input id="dfx2-snap" type="checkbox" checked> Snap</label>'+
    '<button data-act="export">Export Canvas</button><button data-act="fit">Fit</button><input id="dfx2-image" type="file" accept="image/*" hidden>';
  host.parentElement.insertBefore(bar,host);

  const style=document.createElement('style');style.id='dfx2-style';style.textContent=
  '#dfx2-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;border:1px solid #e2e8f0;border-radius:12px;background:rgba(255,255,255,.96);box-shadow:0 6px 18px rgba(15,23,42,.08);margin-bottom:8px;position:sticky;top:0;z-index:20}'+
  '#dfx2-toolbar button{border:1px solid #dbe2ea;background:#fff;border-radius:8px;padding:6px 9px;font:600 12px Inter,Arial;color:#334155;cursor:pointer}'+
  '#dfx2-toolbar button:hover{border-color:#7c3aed;background:#faf5ff}'+
  '#dfx2-toolbar button.active{background:#ede9fe;border-color:#7c3aed;color:#5b21b6}'+
  '.dfx2-tools,.dfx2-actions{display:flex;flex-wrap:wrap;gap:5px}.dfx2-divider{width:1px;height:26px;background:#e2e8f0}.dfx2-snap{font:600 12px Inter,Arial;color:#475569;display:flex;gap:5px;align-items:center}'+
  '#dfx2-status{position:absolute;left:10px;bottom:10px;z-index:10;padding:5px 9px;border:1px solid #e2e8f0;border-radius:999px;background:rgba(255,255,255,.92);font:600 11px Inter,Arial;color:#475569;pointer-events:none}'+
  '.dfx2-guide{stroke:#7c3aed;stroke-width:1;stroke-dasharray:5 4;pointer-events:none}.dfx2-selection{fill:rgba(124,58,237,.06);stroke:#7c3aed;stroke-width:1.5;stroke-dasharray:5 3;pointer-events:none}.dfx2-handle{fill:#fff;stroke:#7c3aed;stroke-width:1.5;cursor:nwse-resize}';
  root.appendChild(style);

  function render(){
    canvas.innerHTML='';
    const defs=svg('defs');
    const marker=svg('marker',{id:'dfx2-arrow',markerWidth:9,markerHeight:9,refX:8,refY:4.5,orient:'auto'});marker.appendChild(svg('path',{d:'M0,0 L9,4.5 L0,9 Z',fill:'#64748b'}));defs.appendChild(marker);
    const pattern=svg('pattern',{id:'dfx2-grid',width:24,height:24,patternUnits:'userSpaceOnUse'});pattern.appendChild(svg('path',{d:'M24 0 L0 0 0 24',fill:'none',stroke:'#e2e8f0','stroke-width':1}));defs.appendChild(pattern);canvas.appendChild(defs);
    const g=svg('g',{transform:'translate('+model.pan.x+' '+model.pan.y+') scale('+model.zoom+')'});canvas.appendChild(g);
    g.appendChild(svg('rect',{x:-10000,y:-10000,width:20000,height:20000,fill:$('df-grid-toggle')?.checked?'url(#dfx2-grid)':'#fff'}));
    guides.forEach(q=>g.appendChild(q.axis==='x'?svg('line',{x1:q.value,y1:-10000,x2:q.value,y2:10000,class:'dfx2-guide'}):svg('line',{x1:-10000,y1:q.value,x2:10000,y2:q.value,class:'dfx2-guide'})));
    model.edges.forEach(e=>{
      const a=node(e.from),b=node(e.to);if(!a||!b)return;
      let x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2;
      if(a.x>b.x){x1=a.x;y1=a.y+a.h/2;x2=b.x+b.w;y2=b.y+b.h/2;}
      const d='M '+x1+' '+y1+' C '+((x1+x2)/2)+' '+y1+' '+((x1+x2)/2)+' '+y2+' '+x2+' '+y2;
      g.appendChild(svg('path',{d,fill:'none',stroke:'#64748b','stroke-width':2,'marker-end':e.arrow==='none'?'':'url(#dfx2-arrow)','stroke-dasharray':e.style==='dashed'?'7 5':''}));
      if(e.label){const t=svg('text',{x:(x1+x2)/2,y:(y1+y2)/2-8,'font-size':12,fill:'#475569','text-anchor':'middle'});t.textContent=e.label;g.appendChild(t);}
    });
    model.nodes.forEach(n=>{
      const q=svg('g',{transform:'translate('+n.x+' '+n.y+')','data-id':n.id,cursor:tool==='select'?'move':'default'});
      let sh;
      if(n.shape==='circle')sh=svg('ellipse',{cx:n.w/2,cy:n.h/2,rx:n.w/2,ry:n.h/2});
      else if(n.shape==='diamond')sh=svg('polygon',{points:(n.w/2)+',0 '+n.w+','+(n.h/2)+' '+(n.w/2)+','+n.h+' 0,'+(n.h/2)});
      else sh=svg('rect',{x:0,y:0,width:n.w,height:n.h,rx:n.shape==='sticky'||n.shape==='round'?16:7});
      sh.setAttribute('fill',n.fill||'#fff');sh.setAttribute('stroke',selected.includes(n.id)?'#7c3aed':(n.stroke||'#475569'));sh.setAttribute('stroke-width',selected.includes(n.id)?2.5:1.5);q.appendChild(sh);
      if(n.shape==='image'&&n.src){q.appendChild(svg('image',{href:n.src,x:2,y:2,width:n.w-4,height:n.h-4,preserveAspectRatio:'xMidYMid meet'}));}
      else if(n.shape==='pen'&&n.points){const p=svg('path',{d:n.points.map((v,i)=>(i?'L':'M')+' '+v.x+' '+v.y).join(' '),fill:'none',stroke:n.stroke||'#0f172a','stroke-width':n.strokeWidth||3,'stroke-linecap':'round','stroke-linejoin':'round'});p.setAttribute('transform','translate('+(-n.x)+' '+(-n.y)+')');q.appendChild(p);}
      else{const tx=svg('text',{x:n.w/2,y:n.h/2+5,'text-anchor':'middle','font-size':n.fontSize||16,fill:n.color||'#0f172a','font-family':'Inter,Arial,sans-serif','font-weight':n.shape==='sticky'?'600':'500'});String(n.label||'').split('\n').forEach((line,i)=>{const sp=svg('tspan',{x:n.w/2,dy:i?((n.fontSize||16)+4):0});sp.textContent=line;tx.appendChild(sp)});q.appendChild(tx);}
      q.addEventListener('pointerdown',e=>nodeDown(e,n));q.addEventListener('dblclick',e=>{e.stopPropagation();edit(n)});g.appendChild(q);
      if(selected.includes(n.id)&&n.id===selected[0]&&tool==='select'){
        [['nw',0,0],['ne',n.w,0],['sw',0,n.h],['se',n.w,n.h]].forEach(h=>{const r=svg('rect',{x:h[1]-4,y:h[2]-4,width:8,height:8,rx:2,class:'dfx2-handle'});r.dataset.handle=h[0];r.addEventListener('pointerdown',e=>resizeStart(e,n,h[0]));g.appendChild(r);});
      }
    });
    if(marquee)g.appendChild(svg('rect',{x:marquee.x,y:marquee.y,width:marquee.w,height:marquee.h,class:'dfx2-selection'}));
  }

  function edit(n){const v=prompt('Edit text',n.label||'');if(v===null)return;checkpoint();n.label=v;render();saveLocal();}
  function nodeDown(e,n){
    e.stopPropagation();
    if(tool==='arrow'){if(drag?.edgeStart){edge(drag.edgeStart,n.id);drag=null;}else drag={edgeStart:n.id};return;}
    if(tool!=='select')return;
    select(n.id,e.shiftKey);
    const p=world(e);drag={mode:'move',sx:p.x,sy:p.y,orig:selected.map(id=>{const q=node(id);return{id,x:q.x,y:q.y};})};render();
  }
  function resizeStart(e,n,h){e.stopPropagation();const p=world(e);drag={mode:'resize',id:n.id,handle:h,sx:p.x,sy:p.y,ox:n.x,oy:n.y,ow:n.w,oh:n.h};}
  function canvasDown(e){
    if(e.button===1||tool==='pan'||e.code==='Space'){drag={mode:'pan',sx:e.clientX,sy:e.clientY,px:model.pan.x,py:model.pan.y};return;}
    const p=world(e);
    if(tool==='pen'){checkpoint();const n={id:uid('n'),x:p.x,y:p.y,w:1,h:1,label:'',shape:'pen',fill:'transparent',stroke:'#0f172a',color:'#0f172a,fontSize:16,points:[p],strokeWidth:3};model.nodes.push(n);selected=[n.id];drag={mode:'pen',id:n.id};render();return;}
    if(tool==='text'){const v=prompt('Text');if(v!==null)addNode(p.x,p.y,v,'text');setTool('select');return;}
    if(tool==='sticky'){const v=prompt('Sticky note');if(v!==null)addNode(p.x,p.y,v,'sticky');setTool('select');return;}
    if(tool==='rect'||tool==='ellipse'||tool==='diamond'){addNode(p.x,p.y,tool==='diamond'?'Decision':'New '+tool,tool==='ellipse'?'circle':tool);setTool('select');return;}
    if(tool==='image'){$('dfx2-image').click();return;}
    if(tool==='arrow'){drag={mode:'arrow',sx:p.x,sy:p.y};return;}
    if(!e.shiftKey){selected=[];render();}
    if(tool==='select'){marquee={x:p.x,y:p.y,w:0,h:0};drag={mode:'marquee',sx:p.x,sy:p.y};}
  }
  function canvasMove(e){
    if(!drag)return;const p=world(e);
    if(drag.mode==='pan'){model.pan.x=drag.px+(e.clientX-drag.sx);model.pan.y=drag.py+(e.clientY-drag.sy);render();return;}
    if(drag.mode==='move'){const d=resizeSnap(p.x-drag.sx,p.y-drag.sy);drag.orig.forEach(o=>{const n=node(o.id);if(n){n.x=o.x+d.dx;n.y=o.y+d.dy;}});render();return;}
    if(drag.mode==='resize'){const n=node(drag.id);if(!n)return;let dx=p.x-drag.sx,dy=p.y-drag.sy;if(drag.handle.includes('e'))n.w=Math.max(40,drag.ow+dx);if(drag.handle.includes('s'))n.h=Math.max(30,drag.oh+dy);if(drag.handle.includes('w')){n.x=drag.ox+dx;n.w=Math.max(40,drag.ow-dx)}if(drag.handle.includes('n')){n.y=drag.oy+dy;n.h=Math.max(30,drag.oh-dy)}render();return;}
    if(drag.mode==='pen'){const n=node(drag.id);if(!n)return;n.points.push(p);n.x=Math.min(...n.points.map(v=>v.x));n.y=Math.min(...n.points.map(v=>v.y));n.w=Math.max(1,Math.max(...n.points.map(v=>v.x))-n.x);n.h=Math.max(1,Math.max(...n.points.map(v=>v.y))-n.y);render();return;}
    if(drag.mode==='arrow'){drag.ex=p.x;drag.ey=p.y;render();return;}
    if(drag.mode==='marquee'){marquee={x:Math.min(drag.sx,p.x),y:Math.min(drag.sy,p.y),w:Math.abs(p.x-drag.sx),h:Math.abs(p.y-drag.sy)};render();}
  }
  function canvasUp(e){
    if(!drag)return;const p=world(e);
    if(drag.mode==='move'||drag.mode==='resize'){checkpoint();drag=null;guides=[];saveLocal();render();return;}
    if(drag.mode==='pan'){drag=null;saveLocal();return;}
    if(drag.mode==='pen'){drag=null;setTool('select');saveLocal();render();return;}
    if(drag.mode==='arrow'){const t=model.nodes.find(n=>p.x>=n.x&&p.x<=n.x+n.w&&p.y>=n.y&&p.y<=n.y+n.h);if(t){const start=model.nodes.find(n=>Math.hypot(n.x+n.w/2-drag.sx,n.y+n.h/2-drag.sy)<Math.max(n.w,n.h));if(start)edge(start.id,t.id);}drag=null;render();return;}
    if(drag.mode==='marquee'){const m=marquee;selected=model.nodes.filter(n=>n.x<=m.x+m.w&&n.x+n.w>=m.x&&n.y<=m.y+m.h&&n.y+n.h>=m.y).map(n=>n.id);marquee=null;drag=null;render();}
  }

  function saveProject(){model.code=$('df-code')?.value||model.code;model.currentType=$('df-type')?.value||model.currentType;dl(new Blob([JSON.stringify(model,null,2)],{type:'application/json'}),'diagram-forge.json');saveLocal();}
  function openProject(file){const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);model={...model,...x,nodes:x.nodes||[],edges:x.edges||[]};selected=[];render();saveLocal();}catch(e){alert('Invalid Diagram Forge project.')}};r.readAsText(file);}
  function exportCanvas(){
    const c=canvas.cloneNode(true);c.setAttribute('xmlns',NS);c.setAttribute('width',canvas.clientWidth);c.setAttribute('height',canvas.clientHeight);dl(new Blob([new XMLSerializer().serializeToString(c)],{type:'image/svg+xml'}),'diagram-forge-canvas.svg');
  }
  function fit(){if(!model.nodes.length){model.zoom=1;model.pan={x:0,y:0};render();return;}const xs=model.nodes.map(n=>n.x),ys=model.nodes.map(n=>n.y),xe=model.nodes.map(n=>n.x+n.w),ye=model.nodes.map(n=>n.y+n.h);const w=Math.max(1,Math.max(...xe)-Math.min(...xs)),h=Math.max(1,Math.max(...ye)-Math.min(...ys));const r=canvas.getBoundingClientRect();model.zoom=Math.min(2,Math.max(.35,Math.min((r.width-80)/w,(r.height-80)/h)));model.pan={x:r.width/2-model.zoom*(Math.min(...xs)+w/2),y:r.height/2-model.zoom*(Math.min(...ys)+h/2)};render();}
  function intercept(id,fn){const b=$(id);if(!b)return;b.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();fn();},{capture:true});}
  function wire(){
    bar.querySelectorAll('.dfx2-tool').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
    bar.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{const a=b.dataset.act;if(a==='group')group();if(a==='ungroup')ungroup();if(a==='duplicate')duplicate();if(a==='copy')copy();if(a==='paste')paste();if(a==='front')layer('front');if(a==='back')layer('back');if(a==='distx')distribute('x');if(a==='disty')distribute('y');if(a==='export')exportCanvas();if(a==='fit')fit();});
    bar.querySelectorAll('[data-align]').forEach(b=>b.onclick=()=>align(b.dataset.align));
    $('dfx2-snap').onchange=e=>{snapOn=e.target.checked;};
    $('dfx2-image').onchange=e=>{const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{checkpoint();model.nodes.push({id:uid('n'),x:180,y:140,w:280,h:200,label:f.name,shape:'image',src:r.result,fill:'#f8fafc',stroke:'#cbd5e1',color:'#0f172a',fontSize:14});selected=[model.nodes.at(-1).id];render();saveLocal();};r.readAsDataURL(f);e.target.value='';};
    intercept('df-new',()=>{checkpoint();model.nodes=[];model.edges=[];addNode(220,160,'Start','rect');const a=selected[0];addNode(500,160,'Process','round');const b=selected[0];edge(a,b);});
    intercept('df-add-node',()=>addNode(260,160,'Node','rect'));
    intercept('df-delete',removeSelected);intercept('df-undo',undo);intercept('df-redo',redo);intercept('df-save',saveProject);intercept('df-open',()=>$('df-file')?.click());intercept('df-export-svg',()=>{$('df-render')?.click();setTimeout(()=>{const s=$('df-mermaid-output svg');if(s)dl(new Blob([new XMLSerializer().serializeToString(s)],{type:'image/svg+xml'}),'diagram.svg');},250);});intercept('df-export-png',()=>{$('df-render')?.click();});
    intercept('df-canvas-to-mermaid',()=>{model.code='flowchart LR\\n'+model.nodes.filter(n=>n.shape!=='pen'&&n.shape!=='image').map((n,i)=>' N'+(i+1)+'['+String(n.label||'Node').replace(/[\\\\[\\\\]]/g,'')+']').join('\\n')+'\\n'+model.edges.map(e=>{const a=model.nodes.findIndex(n=>n.id===e.from)+1,b=model.nodes.findIndex(n=>n.id===e.to)+1;return ' N'+a+' --> N'+b;}).join('\\n');$('df-code').value=model.code;$('df-type').value='flowchart';$('df-render')?.click();});
    intercept('df-clear',()=>{if(!model.nodes.length)return;checkpoint();model.nodes=[];model.edges=[];selected=[];render();});
    intercept('df-fit',fit);
    intercept('df-apply',()=>{const n=selectedNodes();if(!n.length)return;checkpoint();n.forEach(q=>{q.label=$('df-node-label').value;q.fill=$('df-node-fill').value;q.stroke=$('df-node-stroke').value;q.fontSize=+$('df-node-size').value||16;q.shape=$('df-node-shape').value;});render();});
  }

  canvas.addEventListener('pointerdown',canvasDown);
  canvas.addEventListener('pointermove',canvasMove);
  canvas.addEventListener('pointerup',canvasUp);
  canvas.addEventListener('pointercancel',canvasUp);
  canvas.addEventListener('wheel',e=>{e.preventDefault();const before=world(e),factor=e.deltaY<0?1.08:.925;model.zoom=Math.max(.25,Math.min(3,model.zoom*factor));const r=canvas.getBoundingClientRect();const after=world(e);model.pan.x+=(after.x-before.x)*model.zoom;model.pan.y+=(after.y-before.y)*model.zoom;render();},{passive:false});
  document.addEventListener('keydown',e=>{
    if(!root.classList.contains('active'))return;
    const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase();
    if(e.code==='Space'){e.preventDefault();return;}
    if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return}
    if(mod&&k==='y'){e.preventDefault();redo();return}
    if(mod&&k==='c'){e.preventDefault();copy();return}
    if(mod&&k==='v'){e.preventDefault();paste();return}
    if(mod&&k==='d'){e.preventDefault();duplicate();return}
    if(mod&&k==='g'){e.preventDefault();e.shiftKey?ungroup():group();return}
    if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();return}
    if(k==='v')setTool('select');else if(k==='p')setTool('pen');else if(k==='t')setTool('text');else if(k==='a')setTool('arrow');else if(k==='n')setTool('sticky');else if(k==='r')setTool('rect');else if(k==='o')setTool('ellipse');else if(k==='h')setTool('pan');else if(e.key==='Escape'){drag=null;marquee=null;selected=[];setTool('select');render();}
  });
  document.addEventListener('keyup',e=>{});
  wire();render();saveLocal();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootDFX2);else bootDFX2();
})();
