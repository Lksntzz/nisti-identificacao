import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('Publish tool creates a new publication without a dashboard create button',()=>{
  assert.match(source,/const sourceItem = item && item\.mode === 'new' \? null : item/);
  assert.ok(source.includes("if (section === 'publish')"));
  assert.ok(source.includes("item={{mode:'new'}}"));
  assert.ok(source.includes("request('/api/admin/mural/posts', { method:'POST'"));
  assert.equal(source.includes('+ Nova publicação'),false);
});

test('Publish tool routes Collection to the official collection editor',()=>{
  assert.ok(source.includes("onCreateCollection={()=>setCollectionEditor({mode:'new'})}"));
  assert.ok(source.includes('return <CollectionEditor'));
  assert.ok(source.includes("['collection','collection','Coleção','Use a mesma interface de Nova coleção.']"));
});
