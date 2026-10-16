import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { preset, normalizeModel, applyInstruction, values } from './model.js';
import { buildMesh, sizeOf } from './geometry.js';
import './styles.css';

const $ = (selector) => document.querySelector(selector);
const icons = {
  cube:'▣', cylinder:'◉', sphere:'●', arrow:'↗', plus:'+', check:'✓', undo:'↶', redo:'↷',
  save:'↓', folder:'↥', wire:'⌗', eye:'◎', bolt:'✦', reset:'⟳'
};
const escapeHtml = value => String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const defaultState = () => {
  try {
    const cached=JSON.parse(localStorage.getItem('aethercad-project-v1')||'null');
    return cached ? normalizeModel(cached) : preset();
  } catch { return preset(); }
};
const app = {
  model: defaultState(), history:[], future:[], logs:[], wireframe:false,
  busy:false, mode:'ready', cameraMode:'iso'
};
const template = `
  <header class="topbar">
    <div class="brand" aria-label="AetherCAD">
      <div class="brand-mark"><span>Æ</span></div>
      <div class="brand-name">Aether<span>CAD</span></div>
      <span class="brand-divider"></span>
      <div class="product-subtitle">Design workspace <span class="muted-slash">/</span> <strong>Untitled project</strong></div>
    </div>
    <div class="top-actions">
      <span class="cloud-pill"><span class="online-dot"></span><span id="connection-label">Cloudflare native</span></span>
      <button class="top-icon" id="import-btn" title="Open project JSON" aria-label="Import JSON">↥</button>
      <button class="action-secondary" id="save-btn" title="Download editable model JSON">Save project</button>
      <button class="action-primary" id="export-btn"><span>↧</span> Export STL</button>
    </div>
  </header>
  <div class="workspace">
    <aside class="left-rail">
      <div class="rail-heading"><span>WORKSPACE</span><span class="rail-symbol">⌘</span></div>
      <div class="panel-section">
        <div class="section-title">CREATE <span class="tiny">03 PRIMITIVES</span></div>
        <button class="primitive-tile active" data-create="box"><span class="shape-icon">▱</span><span class="shape-info"><strong>Box / Plate</strong><small>Precision solid</small></span><span class="tile-arrow">↗</span></button>
        <button class="primitive-tile" data-create="cylinder"><span class="shape-icon">◉</span><span class="shape-info"><strong>Cylinder</strong><small>Radial solid</small></span><span class="tile-arrow">↗</span></button>
        <button class="primitive-tile" data-create="sphere"><span class="shape-icon">●</span><span class="shape-info"><strong>Sphere</strong><small>Spherical solid</small></span><span class="tile-arrow">↗</span></button>
      </div>
      <div class="panel-section separated">
        <div class="section-title">STARTING POINTS <span class="tiny">PRESETS</span></div>
        <button class="preset-tile" data-preset="plate"><span class="preset-graphic">▤</span><span><strong>Mounting plate</strong><small>140 × 90 × 12 mm</small></span></button>
        <button class="preset-tile" data-preset="perforated"><span class="preset-graphic">⊞</span><span><strong>Four-hole plate</strong><small>Mounting pattern</small></span></button>
        <button class="preset-tile" data-preset="cylinder"><span class="preset-graphic">◎</span><span><strong>Turned part</strong><small>Ø50 × 90 mm</small></span></button>
      </div>
      <div class="rail-bottom">
        <div class="session-title"><span class="online-dot"></span> LOCAL-FIRST WORKSPACE</div>
        <p>Projects are saved in your browser. Export JSON to keep a portable copy.</p>
        <div class="kbd-row"><span>Undo <kbd>Ctrl Z</kbd></span><span>Save <kbd>Ctrl S</kbd></span></div>
      </div>
    </aside>
    <section class="center-stage">
      <div class="viewport-toolbar">
        <div class="viewport-title"><span class="viewport-square">▦</span><span>3D VIEWPORT</span><span class="dot-separator">·</span><span id="view-name">Perspective</span></div>
        <div class="view-buttons">
          <button class="view-button selected" data-view="iso">ISO</button>
          <button class="view-button" data-view="top">TOP</button>
          <button class="view-button" data-view="front">FRONT</button>
          <button class="view-button" data-view="right">RIGHT</button>
          <span class="tool-divider"></span>
          <button class="view-button square-button" id="wire-btn" title="Toggle wireframe" aria-label="Wireframe">⌗</button>
          <button class="view-button square-button" id="fit-btn" title="Fit object" aria-label="Fit view">⤢</button>
        </div>
      </div>
      <div id="viewport" role="img" aria-label="Interactive three-dimensional CAD model with orbit and zoom controls">
        <div class="viewport-overlay"><span class="mini-label">MODEL / <span id="mesh-label">SOLID.001</span></span><strong id="model-label"></strong></div>
        <div class="axis-indicator"><span class="axis-x">X</span><span class="axis-y">Y</span><span class="axis-z">Z</span></div>
        <div class="viewport-hint"><span class="mouse-icon">⊙</span> Drag to orbit <span>·</span> Scroll to zoom <span>·</span> Right-drag to pan</div>
        <div class="loading" id="loading" hidden><span class="loading-spinner"></span><span>Designing geometry…</span></div>
      </div>
      <div class="prompt-dock">
        <div class="dock-caption"><span class="prompt-spark">✦</span><strong>DESIGN ASSISTANT</strong><span class="assistant-mode" id="assistant-mode">AI · LOCAL FALLBACK</span></div>
        <form class="prompt-form" id="prompt-form">
          <input id="prompt-input" maxlength="600" placeholder="Try: Make a 120 × 80 × 10 mm plate with 4 countersunk holes…" autocomplete="off" aria-label="Describe your CAD design"/>
          <button type="submit" class="prompt-submit" id="prompt-submit" aria-label="Run design prompt">↗</button>
        </form>
        <div class="prompt-examples"><span>TRY</span>
          <button class="suggestion" data-prompt="Create a 120x80x10 mounting plate with 4 holes">Four-hole plate</button>
          <button class="suggestion" data-prompt="Add a 5mm fillet">Rounded corners</button>
          <button class="suggestion" data-prompt="Make width 180">Resize to 180 mm</button>
          <span class="prompt-tip">Ctrl + Enter to run</span>
        </div>
        <div class="message-row" id="message-row" aria-live="polite"></div>
      </div>
    </section>
    <aside class="right-panel">
      <div class="inspector-top"><div><span class="eyebrow">PROPERTIES</span><h2>Inspector</h2></div><span class="inspector-glyph">☷</span></div>
      <div class="inspector-content">
        <div class="name-card">
          <div class="object-icon">▣</div>
          <div class="object-details"><span>ACTIVE OBJECT</span><strong id="object-name"></strong><small id="object-type"></small></div>
          <span class="visible-icon">◉</span>
        </div>
        <div class="inspector-section"><div class="inspector-section-header"><h3>Dimensions</h3><span>MM</span></div><div id="dimensions"></div></div>
        <div class="inspector-section"><div class="inspector-section-header"><h3>Features</h3><span id="feature-count">0</span></div><div id="features"></div></div>
        <div class="inspector-section"><div class="inspector-section-header"><h3>History</h3><span id="history-count">0</span></div><div id="history-list" class="history-list"></div></div>
      </div>
      <div class="inspector-footer"><button id="undo-btn" title="Undo">↶ Undo</button><button id="redo-btn" title="Redo">↷ Redo</button><span class="measure-unit">UNIT: MILLIMETERS</span></div>
    </aside>
  </div>
  <input id="file-input" type="file" accept=".json,application/json" hidden />
`;
document.getElementById('app').innerHTML=template;

let scene, renderer, camera, controls, currentMesh, grid;
let renderError=false;
const viewport=$('#viewport');
function init3d() {
  try {
    scene=new THREE.Scene();
    scene.background=new THREE.Color('#111923');
    camera=new THREE.PerspectiveCamera(42,1,0.01,200000);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.5;
    viewport.prepend(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.dampingFactor=0.07;
    controls.minDistance=1;
    controls.maxDistance=15000;
    scene.add(new THREE.HemisphereLight(0xe9f5ff,0x283448,2.2));
    const light=new THREE.DirectionalLight(0xffffff,3.3);light.position.set(150,280,200);scene.add(light);
    const fill=new THREE.DirectionalLight(0x58adff,1.2);fill.position.set(-150,10,-180);scene.add(fill);
    const ro=new ResizeObserver(()=>{
      const w=Math.max(1,viewport.clientWidth), h=Math.max(1,viewport.clientHeight);
      renderer.setSize(w,h,false);
      camera.aspect=w/h;camera.updateProjectionMatrix();
    });
    ro.observe(viewport);
    renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
  } catch(e) {
    renderError=true;
    viewport.insertAdjacentHTML('beforeend','<div class="webgl-error">Your browser could not start WebGL. Try enabling hardware acceleration.</div>');
    console.error(e);
  }
}
function fitView(mode=app.cameraMode) {
  app.cameraMode=mode;
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===mode));
  $('#view-name').textContent=({iso:'Perspective',top:'Top · XZ',front:'Front · XY',right:'Right · ZY'})[mode];
  if(renderError) return;
  const s=sizeOf(app.model);
  const d=s*2.35;
  const positions={iso:[d,d*.83,d],top:[.001,d*1.7,.001],front:[0,s*.15,d*1.8],right:[d*1.8,s*.15,0]};
  camera.position.set(...positions[mode]);
  camera.near=Math.max(.01,s/10000);
  camera.far=Math.max(10000,s*200);
  camera.updateProjectionMatrix();
  controls.target.set(0,0,0);controls.update();
}
function refreshMesh() {
  if(renderError) return;
  if(currentMesh){scene.remove(currentMesh);currentMesh.geometry.dispose();currentMesh.material.dispose();}
  if(grid){scene.remove(grid);grid.geometry.dispose();grid.material.dispose();}
  try {
    currentMesh=buildMesh(app.model);
    currentMesh.material.wireframe=app.wireframe;
    scene.add(currentMesh);
    const gsize=Math.max(200,Math.ceil(sizeOf(app.model)*3/100)*100);
    grid=new THREE.GridHelper(gsize,Math.max(10,Math.min(100,gsize/20)),0x365268,0x233341);
    const v=values(app.model);
    grid.position.y=-(app.model.shape==='sphere'?v.radius:v.height/2)-2;
    scene.add(grid);
    fitView();
    $('#model-label').textContent=app.model.name;
    $('#mesh-label').textContent=app.model.shape.toUpperCase()+'.001';
    $('#wire-btn').classList.toggle('selected',app.wireframe);
  } catch(e){
    console.error(e);
    message('This model could not be rendered. Try reducing hole count or dimensions.','error');
  }
}
function download(name,blob) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name;
  a.click();
  window.setTimeout(()=>URL.revokeObjectURL(a.href),1500);
}
function filename() {
  return (app.model.name||'aethercad-model').replace(/[^\w.-]+/g,'_').slice(0,60);
}
function saveJson() {
  download(filename()+'.json',new Blob([JSON.stringify(app.model,null,2)],{type:'application/json'}));
  message('Editable project JSON downloaded.','success');
}
function exportStl() {
  if(!currentMesh){message('No model to export.','error');return;}
  try {
    const exporter=new STLExporter();
    const stl=exporter.parse(currentMesh,{binary:true});
    download(filename()+'.stl',new Blob([stl],{type:'model/stl'}));
    message('STL exported at real millimeter dimensions.','success');
  } catch(e) {
    console.error(e);
    message('STL export failed.','error');
  }
}
function store(){
  try { localStorage.setItem('aethercad-project-v1',JSON.stringify(app.model)); }
  catch { message('Browser storage is full. Use Save project to keep a copy.','error'); }
}
function changeModel(model,action='Updated model') {
  app.history.push(structuredClone(app.model));
  app.history=app.history.slice(-30);
  app.future=[];
  app.model=normalizeModel(model);
  app.logs.unshift({action,time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
  app.logs=app.logs.slice(0,5);
  store();refreshAll();
}
function goHistory(direction) {
  const from=direction==='undo'?app.history:app.future;
  const to=direction==='undo'?app.future:app.history;
  if(!from.length)return;
  to.push(structuredClone(app.model));
  app.model=from.pop();
  store();refreshAll();
}
function message(text,level='neutral'){
  const row=$('#message-row');
  row.textContent=text;
  row.className='message-row '+level;
}
function inputMarkup(p,featureIndex) {
  const feature=featureIndex===undefined?'':`data-feature="${featureIndex}"`;
  const percent=Math.max(0,Math.min(100,100*(p.value-p.min)/(p.max-p.min||1)));
  return `<div class="parameter">
    <div class="parameter-head"><label for="param-${featureIndex??'b'}-${p.key}">${escapeHtml(p.label)}</label><span>${escapeHtml(p.key.toUpperCase())}</span></div>
    <div class="parameter-values"><input type="number" step="${p.step}" min="${p.min}" max="${p.max}" data-key="${p.key}" ${feature} id="param-${featureIndex??'b'}-${p.key}" value="${p.value}" aria-label="${escapeHtml(p.label)}"><span class="parameter-unit">mm</span></div>
    <input class="parameter-range" type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}" data-key="${p.key}" ${feature} style="--progress:${percent}%" aria-label="Adjust ${escapeHtml(p.label)}" />
  </div>`;
}
function renderInspector(){
  $('#object-name').textContent=app.model.name;
  $('#object-type').textContent=app.model.shape.toUpperCase()+'  /  SOLID BODY';
  $('#dimensions').innerHTML=app.model.parameters.map(p=>inputMarkup(p)).join('');
  const features=[];
  if(app.model.filletRadius) features.push(`<div class="feature-card"><span>◠</span><div><strong>Corner fillet</strong><small>${app.model.filletRadius} mm radius</small></div><button data-remove="edge" title="Remove fillet">×</button></div>`);
  if(app.model.chamferDistance) features.push(`<div class="feature-card"><span>◇</span><div><strong>Corner chamfer</strong><small>${app.model.chamferDistance} mm cut</small></div><button data-remove="edge" title="Remove chamfer">×</button></div>`);
  (app.model.holes||[]).forEach((h,i)=>{
    const p=Object.fromEntries(h.parameters.map(x=>[x.key,x.value]));
    features.push(`<details class="hole-feature"><summary><span class="hole-mark">◎</span><strong>Hole ${String(i+1).padStart(2,'0')}</strong><span class="hole-dim">Ø${(p.radius*2).toFixed(1)} mm</span><button type="button" data-remove="${i}" title="Remove hole">×</button></summary><div class="hole-params">${h.parameters.map(p=>inputMarkup(p,i)).join('')}</div></details>`);
  });
  if(!features.length) features.push('<p class="empty-features">No features yet. Try asking the assistant to add holes or a corner fillet.</p>');
  $('#features').innerHTML=features.join('');
  $('#feature-count').textContent=String((app.model.holes||[]).length+Number(!!app.model.filletRadius)+Number(!!app.model.chamferDistance));
  $('#history-count').textContent=String(app.history.length);
  $('#history-list').innerHTML=(app.logs.length?app.logs:[{action:'Workspace ready',time:'Now'}]).map((l,i)=>`<div class="history-entry"><span class="history-node ${i===0?'latest':''}"></span><div><strong>${escapeHtml(l.action)}</strong><small>${escapeHtml(l.time)}</small></div></div>`).join('');
  $('#undo-btn').disabled=!app.history.length;
  $('#redo-btn').disabled=!app.future.length;
  document.querySelectorAll('[data-create]').forEach(el=>el.classList.toggle('active',el.dataset.create===app.model.shape));
}
function refreshAll(){renderInspector();refreshMesh();}
function presetModel(key){
  if(key==='perforated') return applyInstruction('Add 4 holes',preset('box'));
  if(key==='plate') return preset('box');
  return preset('cylinder');
}
async function runPrompt(event){
  event.preventDefault();
  if(app.busy)return;
  const input=$('#prompt-input');
  const prompt=input.value.trim();
  if(!prompt)return;
  app.busy=true;
  $('#prompt-submit').disabled=true;
  $('#loading').hidden=false;
  message('Generating parametric geometry…');
  try {
    let model, mode='local', note='';
    try {
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),14000);
      try {
        const response=await fetch('/api/generate',{
          method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({prompt,model:app.model}),
          signal:controller.signal
        });
        if(!response.ok)throw new Error('CAD API unavailable');
        const data=await response.json();
        if(!data.model)throw new Error('No model returned');
        model=normalizeModel(data.model);
        mode=data.mode||mode;note=data.note||'';
      } finally {clearTimeout(timeout);}
    } catch {
      model=applyInstruction(prompt,app.model);
      note='Offline prompt parser used.';
    }
    changeModel(model,prompt.length>35?prompt.slice(0,32)+'…':prompt);
    $('#assistant-mode').textContent=mode==='ai'?'CLOUDFLARE AI':'LOCAL CAD ENGINE';
    input.value='';
    message(mode==='ai'?'Model updated with Cloudflare Workers AI.':(note||'Model updated locally.'),'success');
  } catch(e) {
    console.error(e);
    message('Could not process this request. Try a simpler geometric instruction.','error');
  } finally {
    app.busy=false;
    $('#prompt-submit').disabled=false;
    $('#loading').hidden=true;
  }
}
$('#prompt-form').addEventListener('submit',runPrompt);
document.querySelectorAll('[data-prompt]').forEach(btn=>btn.addEventListener('click',()=>{
  $('#prompt-input').value=btn.dataset.prompt;
  $('#prompt-input').focus();
}));
document.querySelectorAll('[data-create]').forEach(btn=>btn.addEventListener('click',()=>changeModel(preset(btn.dataset.create),'Create '+btn.dataset.create)));
document.querySelectorAll('[data-preset]').forEach(btn=>btn.addEventListener('click',()=>changeModel(presetModel(btn.dataset.preset),'Load '+btn.dataset.preset+' preset')));
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>fitView(btn.dataset.view)));
$('#fit-btn').addEventListener('click',()=>fitView());
$('#wire-btn').addEventListener('click',()=>{app.wireframe=!app.wireframe;refreshMesh();});
$('#save-btn').addEventListener('click',saveJson);
$('#export-btn').addEventListener('click',exportStl);
$('#import-btn').addEventListener('click',()=>$('#file-input').click());
$('#file-input').addEventListener('change',async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  if(file.size>100000){message('JSON project must be smaller than 100 KB.','error');return;}
  try {
    const source=JSON.parse(await file.text());
    if(!source || !['box','cylinder','sphere'].includes(source.shape))throw Error('Unsupported model');
    changeModel(normalizeModel(source),'Imported JSON project');
    message('Project imported.','success');
  }catch{message('Invalid AetherCAD JSON project.','error');}
  e.target.value='';
});
$('#undo-btn').addEventListener('click',()=>goHistory('undo'));
$('#redo-btn').addEventListener('click',()=>goHistory('redo'));
function applyParameter(target) {
  const key=target.dataset.key;
  if(!key)return;
  const v=Number(target.value);
  if(!Number.isFinite(v))return;
  const model=structuredClone(app.model);
  if(target.dataset.feature!==undefined){
    const hole=model.holes[Number(target.dataset.feature)];
    const p=hole?.parameters.find(p=>p.key===key);
    if(p)p.value=v;
  }else{
    const p=model.parameters.find(p=>p.key===key);
    if(p)p.value=v;
  }
  changeModel(model,'Adjusted '+key);
}
$('#dimensions').addEventListener('change',e=>applyParameter(e.target));
$('#features').addEventListener('change',e=>applyParameter(e.target));
$('#features').addEventListener('click',e=>{
  const button=e.target.closest('[data-remove]');
  if(!button)return;
  e.preventDefault();e.stopPropagation();
  const model=structuredClone(app.model);
  if(button.dataset.remove==='edge'){delete model.filletRadius;delete model.chamferDistance;}
  else model.holes.splice(Number(button.dataset.remove),1);
  changeModel(model,'Removed feature');
});
document.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&key==='z'){
    e.preventDefault();goHistory(e.shiftKey?'redo':'undo');
  }else if((e.ctrlKey||e.metaKey)&&key==='s'){
    e.preventDefault();saveJson();
  }else if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){
    e.preventDefault();$('#prompt-form').requestSubmit();
  }
});
init3d();
refreshAll();
fetch('/api/health').then(r=>r.ok?r.json():null).then(data=>{
  if(data?.cloudflare)$('#connection-label').textContent='Cloudflare connected';
}).catch(()=>$('#connection-label').textContent='Offline ready');
