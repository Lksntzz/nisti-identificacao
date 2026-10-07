import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router=fs.readFileSync(new URL('../src/canva-image-router.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-admin.css',import.meta.url),'utf8');

test('Canva artwork API exposes templates create and export routes',()=>{
  assert.ok(router.includes("'/api/admin/canva/templates'"));
  assert.ok(router.includes("'/api/admin/canva/art/create'"));
  assert.ok(router.includes("'/api/admin/canva/art/export'"));
  assert.ok(router.includes('/brand-templates?'));
  assert.ok(router.includes("'/autofills'"));
  assert.ok(router.includes("'/exports'"));
});

test('Canva artwork requires the design and brand-template scopes',()=>{
  for(const scope of [
    'design:content:read',
    'design:content:write',
    'design:meta:read',
    'brandtemplate:meta:read',
    'brandtemplate:content:read',
    'asset:read',
    'asset:write'
  ]) assert.ok(router.includes(scope),scope);
  assert.ok(router.includes('art_creation_ready'));
  assert.ok(router.includes('requires_reconnect'));
});

test('Publicar shows Canva artwork workflow for all publication types',()=>{
  assert.ok(admin.includes('function CanvaArtworkModal'));
  assert.ok(admin.includes('Arte da publicação · Canva'));
  assert.ok(admin.includes('Criar no Canva'));
  assert.ok(admin.includes('Editar no Canva'));
  assert.ok(admin.includes('Usar esta arte'));
  assert.ok(admin.includes("kind={activeKind}"));
  assert.ok(admin.includes('activeKind === 'collection''));
  assert.ok(admin.includes('onUseImage={useCanvaImage}'));
});

test('Canva artwork is responsive and integrated into the publication studio',()=>{
  assert.ok(css.includes('.mural-publish-v2-canva'));
  assert.ok(css.includes('.mural-canva-modal'));
  assert.ok(css.includes('@media(max-width:620px)'));
});
