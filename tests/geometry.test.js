import test from 'node:test';
import assert from 'node:assert/strict';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { preset,applyInstruction } from '../src/model.js';
import { buildMesh } from '../src/geometry.js';
import worker from '../src/worker.js';

test('actual mesh dimensions match millimeters',()=>{
  const mesh=buildMesh(preset('box'));
  mesh.geometry.computeBoundingBox();
  const bb=mesh.geometry.boundingBox;
  assert.ok(Math.abs((bb.max.x-bb.min.x)-140)<0.1);
  assert.ok(Math.abs((bb.max.y-bb.min.y)-12)<0.1);
  assert.ok(Math.abs((bb.max.z-bb.min.z)-90)<0.1);
  mesh.geometry.dispose();mesh.material.dispose();
});
test('CSG cuts and printable STL export work',()=>{
  const mesh=buildMesh(applyInstruction('add 4 holes',preset('box')));
  const g=mesh.geometry;
  assert.ok(g.attributes.position.count>100,'CSG should contain triangles');
  const binary=new STLExporter().parse(mesh,{binary:true});
  assert.ok(binary.byteLength>84,'Binary STL has 80-byte header, count and triangles');
  g.dispose();mesh.material.dispose();
});
test('Worker health and local API fallback require no API key',async()=>{
  const health=await worker.fetch(new Request('https://aethercad.example/api/health'),{});
  assert.equal((await health.json()).ok,true);
  const response=await worker.fetch(new Request('https://aethercad.example/api/generate',{
    method:'POST',headers:{'content-type':'application/json','origin':'https://aethercad.example'},
    body:JSON.stringify({prompt:'Create a 90x40x8 plate with 4 holes',model:null})
  }),{});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.mode,'local');
  assert.equal(data.model.holes.length,4);
});
test('cross-origin requests cannot spend AI quota',async()=>{
  const response=await worker.fetch(new Request('https://aethercad.example/api/generate',{
    method:'POST',headers:{'origin':'https://third-party.example','content-type':'application/json'},
    body:JSON.stringify({prompt:'make plate'})
  }),{});
  assert.equal(response.status,403);
});
