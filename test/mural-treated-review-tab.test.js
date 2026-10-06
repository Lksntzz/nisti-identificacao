import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('Mural image manager has a dedicated treated review tab',()=>{
  assert.ok(view.includes("const [imageTab,setImageTab]=useState('review')"));
  assert.ok(view.includes("imageTab==='review'"));
  assert.ok(view.includes("item.mural_image_reviewable&&!justApprovedIds.has(Number(item.id))"));
  assert.ok(view.includes('Revisar tratados <b>{treatmentReview}</b>'));
});

test('queue tab excludes already treated review images',()=>{
  assert.ok(view.includes("!item.mural_image_ready&&!item.mural_image_reviewable"));
  assert.ok(view.includes("Fila <b>{treatmentPending+treatmentFailed}</b>"));
  assert.ok(view.includes("Revisados <b>{treatmentApproved}</b>"));
});
