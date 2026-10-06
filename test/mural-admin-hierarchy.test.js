import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('Mural admin is controlled only by the main panel submenu',()=>{
  assert.ok(admin.includes("export default function MuralNistiAdminView({ activeSection = 'collections' })"));
  assert.ok(admin.includes('const section = activeSection'));
  assert.ok(admin.includes('mural-admin-workspace-single'));
  assert.equal(admin.includes('MuralAdminOverview'),false);
  assert.equal(admin.includes("section==='overview'"),false);
  assert.equal(admin.includes('mural-admin-hierarchy-nav'),false);
  assert.equal(admin.includes('className="mural-admin-manager-nav"'),false);
});

test('Mural keeps only operational tools after overview removal',()=>{
  for(const label of ['Publicações','Coleções','Imagens dos produtos']) assert.ok(admin.includes(label));
  assert.equal(admin.includes("metrics:{title:'Métricas'"),false);
  assert.equal(admin.includes("qa:{title:'QA de liberação'"),false);
  assert.equal(admin.includes("overview:{title:'Mural NISTI'"),false);
  assert.ok(admin.includes("const currentSection = sectionMeta[section] || sectionMeta.collections"));
});

test('single-navigation workspace uses full width and old overview styles are removed',()=>{
  assert.ok(css.includes('/* Mural Admin hierarchy workspace */'));
  assert.ok(css.includes('.mural-admin-workspace-single'));
  assert.ok(css.includes('display:block'));
  assert.equal(css.includes('.mural-admin-overview-grid'),false);
  assert.equal(css.includes('.mural-admin-overview-hero'),false);
});


test('Publicações fica como gestão e não cria nova publicação genérica',()=>{
  assert.equal(admin.includes('+ Nova publicação'),false);
  assert.equal(admin.includes("setEditor({mode:'new'})"),false);
  assert.ok(admin.includes("section==='collections'&&<button className=\"primary\" onClick={()=>setCollectionEditor({mode:'new'})}>+ Nova coleção</button>"));
});
