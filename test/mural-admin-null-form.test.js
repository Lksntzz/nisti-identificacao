import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('new publication form accepts null source without dereferencing it',()=>{
  assert.match(source,/const source = row \?\? EMPTY_POST/);
  assert.match(source,/product_id: source\.product_id \|\| ''/);
  assert.doesNotMatch(source,/product_id: row\.product_id/);
  assert.match(source,/postForm\(sourceItem\)/);
});
