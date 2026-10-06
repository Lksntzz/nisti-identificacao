import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261006145000_mural_collection_hero_v1.sql',import.meta.url),'utf8');

test('collection editor exposes optional year and hero banner metadata',()=>{
  assert.ok(admin.includes('Mostrar ano no banner'));
  assert.ok(admin.includes('Frase curta'));
  assert.ok(admin.includes('Direção visual'));
  assert.ok(admin.includes('Elementos / cores do tema'));
  assert.ok(admin.includes("hero_message:item?.hero_message||''"));
  assert.ok(admin.includes("visual_direction:item?.visual_direction||'automatic'"));
});

test('collection API persists hero configuration',()=>{
  for(const field of ['show_year','hero_message','visual_direction','theme_notes']){
    assert.ok(router.includes(field),field);
    assert.ok(migration.includes(field),field);
  }
  assert.ok(router.includes('COLLECTION_VISUAL_DIRECTIONS'));
  assert.ok(router.includes("nullableText(input.hero_message,140)"));
});

test('public Mural hides optional year and prefers short hero message',()=>{
  assert.ok(mural.includes("collection.show_year !== false"));
  assert.ok(mural.includes('item.collection?.hero_message || item.collection?.description'));
});

test('Supabase publish title respects show_year',()=>{
  assert.ok(migration.includes('IF COALESCE(v_current.show_year,true)'));
  assert.ok(migration.includes('NULLIF(BTRIM(v_current.hero_message)'));
});
