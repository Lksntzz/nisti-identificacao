import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function jsFiles(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry => {
    const full=path.join(dir,entry.name);
    return entry.isDirectory() ? jsFiles(full) : entry.isFile() && /\.js$/.test(entry.name) ? [full] : [];
  });
}

const reviewed = new Set([
  'src/recognition-metrics.js',
  'src/system-metrics-clean-router.js',
  'src/geometric-shadow-evidence-router.js',
  'src/gtin-router.js',
  'src/geometric-shadow-confirmation-router.js',
  'src/gemini-budget.js',
  'src/mural-router.js'
]);

test('every JavaScript module containing a SQL D1 mutation is explicitly inventoried for A2',()=>{
  const mutation=/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;
  const discovered=new Set();

  for(const file of jsFiles('src')){
    const source=fs.readFileSync(file,'utf8');
    if([...source.matchAll(mutation)].length) discovered.add(file.replaceAll('\\','/'));
  }

  assert.deepEqual([...discovered].sort(),[...reviewed].sort());
});

test('A2 inventory documents the remaining primary-cutover blockers',()=>{
  const doc=fs.readFileSync('docs/supabase-cutover-a2-inventory.md','utf8');
  for(const file of reviewed) assert.ok(doc.includes(`\`${file}\``),`missing A2 inventory entry for ${file}`);
  assert.match(doc,/SUPABASE_CUTOVER_WRITE_FREEZE/);
  assert.match(doc,/operational|administrative/);
});
