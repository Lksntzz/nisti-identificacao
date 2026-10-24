import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('opening Evolution starts on the no-sales filter rather than all listings',()=>{
  assert.match(manager,/\[evolutionStatus,setEvolutionStatus\]=useState\('ZERO'\)/);
  assert.match(manager,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
});
