import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('new publication form accepts null source and starts without forcing a type',()=>{
  assert.match(source,/const source = row \?\? EMPTY_POST/);
  assert.match(source,/product_id: source\.product_id \|\| ''/);
  assert.ok(source.includes('const [activeKind,setActiveKind]=useState(presetKind)'));
  assert.ok(source.includes("item={{mode:'new'}}"));
  assert.ok(source.includes('!activeKind && ('));
});
