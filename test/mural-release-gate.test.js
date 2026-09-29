import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');

test('operator mural stays behind explicit coming-soon release gate',()=>{
  assert.equal(source.includes("import MuralNisti from './mural-nisti.jsx'"),false);
  assert.equal(source.includes("api('/api/mural/unread-count')"),false);
  assert.ok(source.includes('mural-coming-soon'));
  assert.ok(source.includes('<h2>Em breve</h2>'));
  assert.ok(source.includes('Voltar ao Scanner'));
});
