import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('generic new publication flow is removed and PostEditor only edits existing posts',()=>{
  assert.equal(source.includes("item && item.mode === 'new' ? null : item"),false);
  assert.equal(source.includes("setEditor({mode:'new'})"),false);
  assert.equal(source.includes("request('/api/admin/mural/posts', { method:'POST'"),false);
  assert.ok(source.includes("if (!id) throw new Error('Publicação inválida para edição.')"));
  assert.ok(source.includes("await request(`/api/admin/mural/posts/${id}`, { method:'PUT'"));
});

test('collection creation remains in the dedicated Collections tool',()=>{
  assert.ok(source.includes("section==='collections'&&<button className=\"primary\" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>"));
  assert.ok(source.includes('return <CollectionEditor'));
});
