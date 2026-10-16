export const LIMIT = 2000;
const clamp = (n, lo, hi) => Number.isFinite(+n) ? Math.max(lo, Math.min(hi, +n)) : lo;
const param = (key, value, label = key[0].toUpperCase() + key.slice(1)) => {
  const v = clamp(value, 0.2, LIMIT);
  return { key, label, value: v, min: 0.2, max: Math.min(LIMIT, Math.max(100, Math.ceil(v * 2))), step: 0.5, unit: 'mm' };
};
export function preset(shape = 'box') {
  if (shape === 'cylinder') return { name: 'Precision cylinder', shape, parameters: [param('radius', 25, 'Radius'), param('height', 90, 'Height')], holes: [] };
  if (shape === 'sphere') return { name: 'Parametric sphere', shape, parameters: [param('radius', 40, 'Radius')], holes: [] };
  return { name: 'Mounting plate', shape: 'box', parameters: [param('width', 140, 'Length · X'), param('height', 12, 'Thickness · Y'), param('depth', 90, 'Width · Z')], holes: [] };
}
export function values(model) {
  return Object.fromEntries(model.parameters.map(p => [p.key, p.value]));
}
export function normalizeModel(input) {
  if (!input || typeof input !== 'object') return preset();
  const shape = ['box', 'cylinder', 'sphere'].includes(input.shape) ? input.shape : 'box';
  const model = preset(shape);
  model.name = String(input.name || model.name).replace(/[<>]/g, '').slice(0, 70);
  const incoming = Array.isArray(input.parameters) ? input.parameters : [];
  model.parameters = model.parameters.map(p => {
    const found = incoming.find(x => x && x.key === p.key);
    return param(p.key, found ? found.value : p.value, p.label);
  });
  const maxCorner = Math.min(values(model).width || 0, values(model).depth || 0) / 2;
  if (shape === 'box') {
    if (input.filletRadius != null && +input.filletRadius > 0) model.filletRadius = clamp(input.filletRadius, 0, maxCorner);
    else if (input.chamferDistance != null && +input.chamferDistance > 0) model.chamferDistance = clamp(input.chamferDistance, 0, maxCorner);
  }
  model.holes = [];
  if (shape !== 'sphere' && Array.isArray(input.holes)) {
    model.holes = input.holes.slice(0, 12).map(hole => {
      const raw = Array.isArray(hole.parameters) ? hole.parameters : [];
      const find = (key, fallback) => {
        const hit = raw.find(x => x && x.key === key);
        return hit && Number.isFinite(+hit.value) ? +hit.value : fallback;
      };
      const v = values(model);
      const thickness = shape === 'box' ? v.height : v.height;
      const radius = clamp(find('radius', 4), 0.2, Math.max(0.2, Math.min(v.width || v.radius * 2, v.depth || v.radius * 2) / 2));
      const type = hole.type === 'countersunk' ? 'countersunk' : 'simple';
      const params = [param('radius', radius, 'Hole radius'), param('height', Math.max(thickness + 2, find('height', thickness + 2)), 'Cut depth')];
      for (const key of ['x','y','z']) {
        const pos = clamp(find(key, 0), -LIMIT, LIMIT);
        params.push({key,label:key.toUpperCase()+' position',value:pos,min:-LIMIT,max:LIMIT,step:0.5,unit:'mm'});
      }
      if (type === 'countersunk') params.push(param('countersinkRadius', Math.max(radius, find('countersinkRadius', radius * 1.7)), 'Sink radius'));
      return { shape: 'cylinder', type, parameters: params };
    });
  }
  return model;
}
const extract = (text, regex) => {
  const m = text.match(regex);
  return m ? Number(m[1]) : null;
};
function withValue(model, key, number) {
  const p = model.parameters.find(p => p.key === key);
  if (p && Number.isFinite(number) && number > 0) p.value = clamp(number, 0.2, LIMIT);
}
function addHoles(model, count, diameter, countersunk) {
  if (model.shape === 'sphere') return;
  const v = values(model);
  const n = Math.min(12, Math.max(1, count));
  const rad = Math.max(0.2, (diameter || 8) / 2);
  const spanX = model.shape === 'box' ? v.width * 0.32 : v.radius * 0.8;
  const spanZ = model.shape === 'box' ? v.depth * 0.32 : v.radius * 0.8;
  const points = n === 4 ? [[-spanX,-spanZ],[spanX,-spanZ],[spanX,spanZ],[-spanX,spanZ]] :
    Array.from({length:n},(_,i) => n === 1 ? [0,0] : [Math.cos(i*2*Math.PI/n)*spanX, Math.sin(i*2*Math.PI/n)*spanZ]);
  for (const [x,z] of points) {
    const parameters = [param('radius',rad,'Hole radius'),param('height',v.height+2,'Cut depth'),
      {key:'x',label:'X position',value:x,min:-LIMIT,max:LIMIT,step:0.5,unit:'mm'},
      {key:'y',label:'Y position',value:0,min:-LIMIT,max:LIMIT,step:0.5,unit:'mm'},
      {key:'z',label:'Z position',value:z,min:-LIMIT,max:LIMIT,step:0.5,unit:'mm'}];
    if (countersunk) parameters.push(param('countersinkRadius',rad*1.7,'Sink radius'));
    model.holes.push({shape:'cylinder',type:countersunk?'countersunk':'simple',parameters});
  }
  model.holes = model.holes.slice(0,12);
}
export function applyInstruction(text, prior = null) {
  const instruction = String(text || '').slice(0,600).trim();
  if (!instruction) return normalizeModel(prior);
  const s = instruction.toLowerCase();
  const shapeRequested = /\b(sphere|ball)\b/.test(s) ? 'sphere' : /\b(cylinder|rod|tube)\b/.test(s) ? 'cylinder' : /\b(box|block|plate|bracket)\b/.test(s) ? 'box' : null;
  const newShape = !prior || /\b(new|create|start|design|make a|generate|reset)\b/.test(s) && !!shapeRequested;
  const model = newShape ? preset(shapeRequested || 'box') : normalizeModel(prior);
  const numbers = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/);
  if (numbers && model.shape === 'box') {
    withValue(model,'width',+numbers[1]);
    withValue(model,'depth',+numbers[2]);
    if (numbers[3]) withValue(model,'height',+numbers[3]);
  }
  const dims = {
    width: /(?:\blength\b|\bwide\b|\bwidth\b|\bx-axis\b)/,
    height: /(?:\bthickness\b|\bthick\b|\bheight\b|\btall\b)/,
    depth: /(?:\bdepth\b|\bz-axis\b)/
  };
  for (const [key, regex] of Object.entries(dims)) {
    const m1=s.match(new RegExp('(?:'+regex.source+')\\s*(?:of|to|=|:|is)?\\s*(\\d+(?:\\.\\d+)?)'));
    const m2=s.match(new RegExp('(\\d+(?:\\.\\d+)?)\\s*(?:mm|millimeters)?\\s*(?:'+regex.source+')'));
    if (m1 || m2) withValue(model,key,Number((m1||m2)[1]));
  }
  const radius = extract(s, /\bradius\s*(?:of|to|=|:)?\s*(\d+(?:\.\d+)?)/);
  const diameter = extract(s, /\bdiameter\s*(?:of|to|=|:)?\s*(\d+(?:\.\d+)?)/);
  if (model.shape !== 'box' && (radius != null || diameter != null)) withValue(model,'radius',radius || diameter/2);
  if (/\b(remove|delete|clear)\b.*\bholes?\b/.test(s)) model.holes=[];
  else if (/\bholes?\b/.test(s) && /\b(add|drill|cut|with|create|make|insert|holes?)\b/.test(s)) {
    const count = extract(s, /\b(\d+)\s*(?:x\s*)?(?:countersunk\s*)?holes?\b/) || 1;
    const dia = extract(s, /\b(\d+(?:\.\d+)?)\s*mm\s*(?:diameter\s*)?(?:countersunk\s*)?holes?\b/) || extract(s,/\bhole(?:s)?\s*(?:diameter|of|size)?\s*(\d+(?:\.\d+)?)/) || 8;
    const hasCount = /\b\d+\s*(?:countersunk\s*)?holes?\b/.test(s);
    addHoles(model,count,hasCount ? dia : (diameter || dia),/\bcountersunk\b/.test(s));
  }
  if (/\b(remove|clear|no)\b.*\b(fillet|round|chamfer|bevel)\b/.test(s)) {
    delete model.filletRadius; delete model.chamferDistance;
  } else {
    const treatment = extract(s, /\b(?:fillet|rounded|round corners?|chamfer|bevel)\s*(?:of|to|=|:)?\s*(\d+(?:\.\d+)?)/)
      ?? extract(s,/\b(\d+(?:\.\d+)?)\s*mm\s*(?:fillet|chamfer)/);
    if (treatment !== null && model.shape==='box') {
      delete model.filletRadius; delete model.chamferDistance;
      if (/\b(chamfer|bevel)\b/.test(s)) model.chamferDistance=treatment;
      else model.filletRadius=treatment;
    }
  }
  if (newShape) model.name = instruction.replace(/\s+/g,' ').slice(0,50);
  return normalizeModel(model);
}
