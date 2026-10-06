import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('Mural admin can be controlled by the main panel navigation without creating a second menu',()=>{
  assert.ok(admin.includes('activeSection = null'));
  assert.ok(admin.includes('onSectionChange = null'));
  assert.ok(admin.includes("const [internalSection,setInternalSection]=useState('overview')"));
  assert.ok(admin.includes('const section = activeSection || internalSection'));
  assert.ok(admin.includes('function MuralAdminOverview'));
  assert.ok(admin.includes('mural-admin-workspace-single'));
  assert.equal(admin.includes('mural-admin-hierarchy-nav'),false);
  assert.equal(admin.includes('className="mural-admin-manager-nav"'),false);
  assert.equal(admin.includes('mural-admin-back-overview'),false);
});

test('Mural tools keep hierarchy inside overview cards instead of another menu',()=>{
  for(const label of ['CONTEÚDO','PRODUÇÃO VISUAL','GESTÃO','CONTROLE']) assert.ok(admin.includes(label));
  for(const label of ['Publicações','Coleções','Imagens dos produtos','Métricas','QA de liberação']) assert.ok(admin.includes(label));
  assert.ok(admin.includes('onNavigate={setSection}'));
  assert.ok(admin.includes('const setSection = onSectionChange || setInternalSection'));
});

test('overview explains workflow and exposes primary creation actions',()=>{
  assert.ok(admin.includes('Gerencie o conteúdo seguindo o fluxo certo'));
  assert.ok(admin.includes('<b>1</b> Conteúdo'));
  assert.ok(admin.includes('<b>2</b> Produção visual'));
  assert.ok(admin.includes('<b>3</b> Revisão'));
  assert.ok(admin.includes('<b>4</b> QA e publicação'));
  assert.ok(admin.includes('+ Nova publicação'));
  assert.ok(admin.includes('+ Nova coleção'));
});

test('single-navigation workspace uses full width and remains responsive',()=>{
  assert.ok(css.includes('/* Mural Admin hierarchy workspace */'));
  assert.ok(css.includes('.mural-admin-workspace-single'));
  assert.ok(css.includes('display:block'));
  assert.ok(css.includes('@media(max-width:820px)'));
  assert.equal(css.includes('.mural-admin-hierarchy-nav'),false);
  assert.ok(css.includes('.mural-admin-overview-grid'));
});
