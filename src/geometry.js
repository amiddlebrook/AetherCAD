import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import { values } from './model.js';

export function sizeOf(model) {
  const v = values(model);
  return Math.max(20, model.shape === 'box' ? Math.max(v.width,v.height,v.depth) : model.shape === 'cylinder' ? Math.max(v.radius*2,v.height) : v.radius*2);
}
function plateGeometry(w,h,d,round=0,chamfer=0) {
  if (!round && !chamfer) return new THREE.BoxGeometry(w,h,d);
  const r = Math.max(0.01,Math.min(round || chamfer,w*0.499,d*0.499));
  const x=w/2, z=d/2;
  const s=new THREE.Shape();
  if (round) {
    s.moveTo(-x+r,-z);
    s.lineTo(x-r,-z); s.quadraticCurveTo(x,-z,x,-z+r);
    s.lineTo(x,z-r); s.quadraticCurveTo(x,z,x-r,z);
    s.lineTo(-x+r,z); s.quadraticCurveTo(-x,z,-x,z-r);
    s.lineTo(-x,-z+r); s.quadraticCurveTo(-x,-z,-x+r,-z);
  } else {
    s.moveTo(-x+r,-z);
    s.lineTo(x-r,-z); s.lineTo(x,-z+r);
    s.lineTo(x,z-r); s.lineTo(x-r,z);
    s.lineTo(-x+r,z); s.lineTo(-x,z-r);
    s.lineTo(-x,-z+r);
  }
  s.closePath();
  const g=new THREE.ExtrudeGeometry(s,{depth:h,steps:1,bevelEnabled:false,curveSegments:12});
  g.rotateX(-Math.PI/2);
  g.center();
  return g;
}
export function buildMesh(model) {
  const v=values(model);
  let geometry;
  if (model.shape==='sphere') geometry = new THREE.SphereGeometry(v.radius,48,32);
  else if (model.shape==='cylinder') geometry = new THREE.CylinderGeometry(v.radius,v.radius,v.height,64);
  else geometry = plateGeometry(v.width,v.height,v.depth,model.filletRadius,model.chamferDistance);
  const material=new THREE.MeshStandardMaterial({color:0x65c8e8,metalness:0.36,roughness:0.35,side:THREE.DoubleSide});
  let mesh = new THREE.Mesh(geometry,material);
  mesh.updateMatrix();
  for (const hole of model.holes || []) {
    const p=Object.fromEntries(hole.parameters.map(v=>[v.key,v.value]));
    const r=Math.max(0.2,p.radius), h=Math.max(0.2,p.height);
    const shaftGeom = new THREE.CylinderGeometry(r,r,h,48);
    const shaft = new THREE.Mesh(shaftGeom);
    shaft.position.set(p.x||0,p.y||0,p.z||0);
    shaft.updateMatrix();
    let next = CSG.subtract(mesh,shaft);
    if (hole.type==='countersunk') {
      const cr=Math.max(r,p.countersinkRadius||r*1.7);
      const ch=Math.max(0.1,Math.min(h*0.5,cr-r));
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(cr,r,ch,48));
      cone.position.set(p.x||0,(p.y||0)+(v.height/2)-ch/2,p.z||0);
      cone.updateMatrix();
      const after = CSG.subtract(next,cone);
      next.geometry.dispose();
      next=after;
      cone.geometry.dispose();
    }
    if (mesh !== shaft && mesh.geometry !== geometry) mesh.geometry.dispose();
    mesh=next;
    shaftGeom.dispose();
  }
  if (mesh.geometry!==geometry) geometry.dispose();
  mesh.geometry.computeVertexNormals();
  mesh.castShadow=true;
  mesh.receiveShadow=true;
  return mesh;
}
