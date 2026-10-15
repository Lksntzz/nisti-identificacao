import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('Mural QA opens within protected admin route instead of public scanner',()=>{
 const admin=read('src/admin/MuralNistiAdminView.jsx');
 const main=read('src/main.jsx');
 const entry=read('src/entry.jsx');
 const mural=read('src/mural-nisti.jsx');
 assert.match(admin,/\/admin\?mural=qa#admin\/mural-nisti/);
 assert.doesNotMatch(admin,/window\.location\.assign\('\/\?mural=qa'\)/);
 assert.match(main,/muralQaMode \? \(/);
 assert.match(main,/<MuralNisti \/>/);
 assert.match(main,/Voltar ao painel/);
 assert.match(entry,/window\.location\.pathname === '\/admin'/);
 assert.match(mural,/'x-mural-qa': '1'/);
});
