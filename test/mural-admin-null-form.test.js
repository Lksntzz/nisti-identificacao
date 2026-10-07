import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('new publication form accepts null source and exposes all publication types',()=>{
  assert.match(source,/const sourceItem = item && item\.mode === 'new' \? null : item/);
  assert.match(source,/id: sourceItem\.product_id/);
  assert.ok(source.includes("const [activeKind, setActiveKind] = useState(presetKind || 'product')"));
  assert.ok(source.includes("item={{mode:'new'}}"));
  for(const label of ['Produto','Informação','Coleção']) assert.ok(source.includes(`<span>${label}</span>`));
});
