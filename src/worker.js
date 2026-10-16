import { normalizeModel, applyInstruction } from './model.js';

const SYSTEM = `You are AetherCAD's parametric 3D modeling planner.
Return ONLY JSON. No markdown, explanations, code, or prose.
You receive a current model JSON (possibly null) and a user request. Modify the existing object unless a new object was requested.
The output schema is:
{"shape":"box|cylinder|sphere","name":"object name","parameters":[{"key":"width|height|depth|radius","label":"label","value":12,"unit":"mm","min":0.2,"max":1000,"step":0.5}],"holes":[{"shape":"cylinder","type":"simple|countersunk","parameters":[{"key":"radius","value":4},{"key":"height","value":15},{"key":"x","value":0},{"key":"y","value":0},{"key":"z","value":0},{"key":"countersinkRadius","value":7}]}],"filletRadius":3}
For boxes parameters are width (X length), height (Y thickness), depth (Z width).
For cylinders: radius and height. Spheres: radius.
Coordinates in mm centered at origin. Cylindrical holes cut along Y. Use hole cut height greater than material thickness. Countersinks open on +Y.
Every parameter must include finite value. For hole requests you MUST preserve existing holes unless removal requested.
"filletRadius" or "chamferDistance" controls box plan-view corners (not both).
Never include tools or external URLs. No other shapes or operations.`;
const json = (body,status=200) => new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
function extractJson(raw) {
  const text=typeof raw === 'string'?raw:'';
  const first=text.indexOf('{'), last=text.lastIndexOf('}');
  if(first<0||last<=first) throw new Error('AI did not return JSON');
  return JSON.parse(text.slice(first,last+1));
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (url.pathname==='/api/health') return json({ok:true,service:'aethercad',cloudflare:true,ai:!!env.AI});
    if (url.pathname!=='/api/generate') return json({error:'Not found'},404);
    if (request.method!=='POST') return json({error:'Use POST'},405);
    const origin=request.headers.get('origin');
    if (origin && origin!==url.origin) return json({error:'Cross-origin requests not permitted'},403);
    if (Number(request.headers.get('content-length')||0)>24000) return json({error:'Request too large'},413);
    let data;
    try { data=await request.json(); } catch { return json({error:'Invalid JSON'},400); }
    if (!data || typeof data.prompt!=='string' || !data.prompt.trim() || data.prompt.length>600) return json({error:'Prompt must be 1–600 characters'},400);
    const current=data.model ? normalizeModel(data.model) : null;
    const fallback=()=>json({model:applyInstruction(data.prompt,current),mode:'local',note:'Local CAD rules used — AI quota or service unavailable'});
    if(!env.AI) return fallback();
    try {
      const response=await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8',{
        messages:[
          {role:'system',content:SYSTEM},
          {role:'user',content:JSON.stringify({currentModel:current,instruction:data.prompt})}
        ],
        max_tokens:1400,
        temperature:0.12,
      });
      const responseText=typeof response==='string'?response:response?.response || response?.result?.response;
      const candidate=extractJson(responseText);
      if(!candidate || !['box','cylinder','sphere'].includes(candidate.shape) || !Array.isArray(candidate.parameters)) throw new Error('Invalid geometry response');
      return json({model:normalizeModel(candidate),mode:'ai'});
    } catch {
      return fallback();
    }
  }
};
