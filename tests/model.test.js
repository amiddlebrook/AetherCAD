import test from 'node:test';
import assert from 'node:assert/strict';
import { preset, normalizeModel, applyInstruction, values } from '../src/model.js';
test('default plate is printable in millimeters', () => {
  assert.deepEqual(values(preset()), {width:140,height:12,depth:90});
});
test('natural language creates 4 spaced cutouts', () => {
  const model = applyInstruction('Create a 120x80x10 plate with 4 holes');
  assert.equal(model.shape, 'box');
  assert.equal(values(model).width,120);
  assert.equal(values(model).height,10);
  assert.equal(model.holes.length,4);
  assert.notEqual(model.holes[0].parameters[2].value, model.holes[1].parameters[2].value);
});
test('edits preserve existing holes', () => {
  const model = applyInstruction('width to 150', applyInstruction('add 4 holes',preset()));
  assert.equal(values(model).width,150);
  assert.equal(model.holes.length,4);
});
test('modifications can clear features', () => {
  assert.equal(applyInstruction('remove holes', applyInstruction('add a hole', preset())).holes.length,0);
});
test('input is bounded before geometry operations', () => {
  const model = normalizeModel({shape:'box',parameters:[{key:'width',value:999999}],holes:Array.from({length:100},()=>({type:'simple',parameters:[]}))});
  assert.equal(values(model).width,2000);
  assert.equal(model.holes.length,12);
});
test('sphere generation and radius edits', () => {
  const model = applyInstruction('make a sphere radius 32');
  assert.equal(model.shape,'sphere');
  assert.equal(values(model).radius,32);
});
