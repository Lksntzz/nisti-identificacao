import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../src/edge-router.js', import.meta.url), 'utf8');

test('Gemini Pro handoff accepts only product and collection modes plus approved visual styles', () => {
  assert.ok(router.includes("const MURAL_GEMINI_PRO_MODES = Object.freeze(new Set(['product_scene', 'collection_scene']))"));
  assert.ok(router.includes("if (!MURAL_GEMINI_PRO_MODES.has(mode))"));
  assert.ok(router.includes("const AUTHORIZED_STYLES = Object.freeze({"));
  assert.ok(router.includes("if (!(style in AUTHORIZED_STYLES))"));
});

test('Gemini Pro prompt is focused on image direction, lighting, camera, scene and audience', () => {
  assert.ok(router.includes('DIREÇÃO VISUAL'));
  assert.ok(router.includes('ILUMINAÇÃO'));
  assert.ok(router.includes('CÂMERA'));
  assert.ok(router.includes('CENÁRIO'));
  assert.ok(router.includes('PÚBLICO'));
  assert.ok(router.includes('jovens e adultos que valorizam papelaria fina'));
  assert.ok(router.includes('enquadramento em ângulo 3/4 levemente superior'));
  assert.ok(router.includes('jogo de luzes suave e controlado'));
  assert.equal(router.includes('SEGURANÇA DE INSTRUÇÕES'), false);
  assert.equal(router.includes('ORDEM DE PRIORIDADE'), false);
});

test('Gemini Pro package is server-built from real catalog data and real image references', () => {
  assert.ok(router.includes('async function adminPrepareMuralGeminiPro(request, env)'));
  assert.ok(router.includes('buildProductPrompt(product, finishLabels(product), style)'));
  assert.ok(router.includes('buildCollectionPrompt(collection, products, style)'));
  assert.ok(router.includes('references = await muralGeminiProReferences(env, { productId })'));
  assert.ok(router.includes('references = await muralGeminiProReferences(env, { collectionId })'));
  assert.ok(router.includes("gemini_url:'https://gemini.google.com/app'"));
  assert.ok(router.includes('references:references.map(muralGeminiProReference)'));
  assert.ok(router.includes("'/api/admin/mural/gemini-pro-package'"));
});

test('Gemini Pro package remains protected by the administrative session boundary', () => {
  assert.ok(edge.includes("pathname.startsWith('/api/admin/')"));
  assert.ok(edge.includes("isProtectedApi(pathname) && !(await validSession(request, env))"));
});

test('automatic Gemini image API generation was removed from the Mural', () => {
  for (const removed of [
    'GEMINI_IMAGE_API_KEY',
    'adminGenerateMuralAiArt',
    'adminMuralImageStudio',
    '/api/admin/mural/ai-art',
    '/api/admin/mural/image-studio',
    'generativelanguage.googleapis.com'
  ]) {
    assert.equal(router.includes(removed), false, removed);
  }
  assert.equal(wrangler.includes('GEMINI_IMAGE_MODEL'), false);
  assert.equal(admin.includes('Gerar arte com IA'), false);
  assert.equal(admin.includes('IA · Nano Banana'), false);
  assert.equal(admin.includes('generateAiArt'), false);
  assert.equal(admin.includes('aiResult'), false);
  assert.equal(css.includes('.mural-publisher-generate'), false);
  assert.equal(css.includes('.mural-publisher-art-result'), false);
});

test('Mural keeps only the Gemini Pro prompt, reference and return workflow', () => {
  assert.ok(admin.includes('Preparar para o Gemini Pro'));
  assert.ok(admin.includes('/api/admin/mural/gemini-pro-package'));
  assert.ok(admin.includes('Copiar e abrir Gemini Pro'));
  assert.ok(admin.includes('Baixar'));
  assert.ok(admin.includes('Trazer imagem gerada para o Mural'));
  assert.ok(css.includes('.mural-publisher-gemini-pro'));
  assert.ok(css.includes('.mural-gemini-pro-kit'));
  assert.ok(css.includes('.mural-gemini-pro-references'));
  assert.ok(css.includes('.mural-gemini-pro-return'));
});

test('mural public release gate remains untouched', () => {
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
});
