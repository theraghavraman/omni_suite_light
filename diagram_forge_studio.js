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