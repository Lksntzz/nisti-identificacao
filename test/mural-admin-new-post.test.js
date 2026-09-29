import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('new publication editor normalizes the sentinel before initializing state',()=>{
  assert.match(source,/const sourceItem = item && item\.mode === 'new' \? null : item/);
  assert.match(source,/useState\(\(\) => postForm\(sourceItem\)\)/);
  assert.match(source,/item=\{editor\}/);
  assert.match(source,/let id = sourceItem\?\.id/);
});
