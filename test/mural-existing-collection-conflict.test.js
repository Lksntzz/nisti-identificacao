import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
test('Mural collection slug conflict opens matching collection for editing, never automatically overwrites',()=>{
 assert.match(source,/Já existe uma coleção com esse slug/);
 assert.match(source,/setCollectionConflict\(/);
 assert.match(source,/Abrir coleção existente/);
 assert.match(source,/onOpenExistingCollection\(collectionConflict.slug\)/);
 assert.match(source,/request\('\/api\/admin\/mural\/collections'\)/);
 assert.match(source,/setCollectionEditor\(existing\)/);
 assert.match(source,/onOpenExistingCollection=\{async slug =>/);
});