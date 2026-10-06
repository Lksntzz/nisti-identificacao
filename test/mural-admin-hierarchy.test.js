import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('Mural admin starts on a hierarchical overview instead of a flat tool row',()=>{
  assert.ok(admin.includes("const [section,setSection]=useState('overview')"));
  assert.ok(admin.includes('function MuralAdminOverview'));
  assert.ok(admin.includes('mural-admin-workspace'));
  assert.ok(admin.includes('mural-admin-hierarchy-nav'));
  assert.ok(admin.includes('Ferramentas do Mural'));
  assert.equal(admin.includes('className="mural-admin-manager-nav"'),false);
});

test('Mural tools are grouped by responsibility',()=>{
  for(const label of ['CONTEÚDO','PRODUÇÃO VISUAL','GESTÃO E CONTROLE']) assert.ok(admin.includes(label));
  for(const label of ['Visão geral','Publicações','Coleções','Imagens dos produtos','Métricas','QA de liberação']) assert.ok(admin.includes(label));
  assert.ok(admin.includes('Tratamento e revisão'));
  assert.ok(admin.includes('Validação final'));
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

test('hierarchical workspace is responsive',()=>{
  assert.ok(css.includes('/* Mural Admin hierarchy workspace */'));
  assert.ok(css.includes('grid-template-columns:230px minmax(0,1fr)'));
  assert.ok(css.includes('@media(max-width:820px)'));
  assert.ok(css.includes('.mural-admin-hierarchy-nav'));
  assert.ok(css.includes('.mural-admin-overview-grid'));
});
