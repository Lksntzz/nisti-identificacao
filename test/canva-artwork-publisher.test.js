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
  assert.ok(admin.includes("activeKind === 'collection'"));
  assert.ok(admin.includes('onUseImage={useCanvaImage}'));
});

test('Canva artwork is responsive and integrated into the publication studio',()=>{
  assert.ok(css.includes('.mural-publish-v2-canva'));
  assert.ok(css.includes('.mural-canva-modal'));
  assert.ok(css.includes('@media(max-width:620px)'));
});

test('Canva artwork prevents duplicate creates and handles temporary Canva throttling',()=>{
  assert.ok(admin.includes('const createLockRef = useRef(false)'));
  assert.ok(admin.includes('createCooldownUntil > Date.now()'));
  assert.ok(admin.includes('err?.status === 429'));
  assert.ok(admin.includes('Aguarde um minuto e tente novamente apenas uma vez.'));
});

test('Canva lists all Brand Templates and falls back to a real Canva create URL',()=>{
  assert.match(router,/dataset:'any'/);
  assert.match(router,/create_url:safeCanvaPageUrl\(item\.create_url\)/);
  assert.match(router,/async function manualBrandTemplateResponse\(templateId,token\)/);
  assert.match(router,/canvaGet\(`\/brand-templates\/\$\{encodeURIComponent\(templateId\)\}`,token\)/);
  assert.match(router,/safeCanvaPageUrl\(metadata\?\.brand_template\?\.create_url\)/);
  assert.match(router,/mode:'manual'/);
  assert.match(router,/manual_create_url:createUrl/);
  assert.match(router,/if\(!fields\.length\)return manualBrandTemplateResponse\(templateId,token\)/);
  assert.match(router,/if\(!Object\.keys\(data\)\.length\)return manualBrandTemplateResponse\(templateId,token\)/);
  assert.match(router,/mode:'autofill'/);
  assert.doesNotMatch(router,/code:'canva_template_fields_unmatched'/);
});

test('Canva manual fallback offers editing without inventing an exportable design id',()=>{
  const modal=admin.slice(admin.indexOf('function CanvaArtworkModal'),admin.indexOf('function PublishImageField'));
  assert.match(modal,/payload\?\.mode === 'manual'/);
  assert.match(modal,/setManualCreateUrl\(payload\.manual_create_url\)/);
  assert.match(modal,/href=\{manualCreateUrl\}/);
  assert.match(modal,/target="_blank" rel="noopener noreferrer"/);
  assert.match(modal,/exporte em PNG e envie o arquivo/);
  assert.match(modal,/if \(!payload\?\.design\?\.id\)/);
  assert.match(modal,/setManualCreateUrl\(''\)/);
  assert.match(modal,/onUseImage\?\.\(file\)/);
});

test('Canva modal uses one primary/secondary button row, not unstyled inline actions',()=>{
  const modal=admin.slice(admin.indexOf('function CanvaArtworkModal'),admin.indexOf('function PublishImageField'));
  const footer=modal.slice(modal.indexOf('<footer className="mural-canva-modal-footer">'));
  assert.match(footer,/mural-canva-modal-action-secondary/);
  assert.match(footer,/mural-canva-modal-action-primary/);
  assert.match(footer,/onClick=\{createDesign\}/);
  assert.doesNotMatch(modal,/className="mural-publish-v2-canva-create"/);
  assert.match(css,/\.mural-canva-modal \.mural-canva-modal-action\{/);
  assert.match(css,/min-height:42px/);
  assert.match(css,/\.mural-canva-modal \.mural-canva-modal-action-primary\{/);
  assert.match(css,/\.mural-canva-modal \.mural-canva-modal-action-secondary\{/);
});
