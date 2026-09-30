import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../src/edge-router.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../src/core-router.js', import.meta.url), 'utf8');

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
  assert.ok(router.includes('Enquadramento em ângulo 3/4 levemente superior'));
  assert.ok(router.includes('jogo de luzes suave e controlado'));
  assert.equal(router.includes('SEGURANÇA DE INSTRUÇÕES'), false);
  assert.equal(router.includes('ORDEM DE PRIORIDADE'), false);
});

test('Gemini Pro package is server-built from real catalog data and real image references', () => {
  assert.ok(router.includes('async function adminPrepareMuralGeminiPro(request, env)'));
  assert.ok(router.includes('buildProductPromptVersions(product, finishLabels(product), style)'));
  assert.ok(router.includes('buildCollectionPromptVersions(collection, products, style)'));
  assert.ok(router.includes('references = await muralGeminiProReferences(env, { productId })'));
  assert.ok(router.includes('references = await muralGeminiProReferences(env, { collectionId })'));
  assert.ok(router.includes("gemini_url:'https://gemini.google.com/app'"));
  assert.ok(router.includes('prompt_versions:promptVersions'));
  assert.ok(router.includes('direction:AUTHORIZED_STYLES[style]'));
  assert.ok(router.includes('references:references.map(muralGeminiProReference)'));
  assert.ok(router.includes("'/api/admin/mural/gemini-pro-package'"));
});

test('selected visual direction is embedded into each of three prompt versions', () => {
  assert.ok(router.includes('const PROMPT_VARIANTS = Object.freeze(['));
  assert.ok(router.includes("'editorial-hero'"));
  assert.ok(router.includes("'lifestyle'"));
  assert.ok(router.includes("'premium-detail'"));
  assert.ok(router.includes("'DIREÇÃO VISUAL SELECIONADA'"));
  assert.ok(router.includes('styleLabel'));
  assert.ok(admin.includes('Escolha uma das 3 versões de prompt.'));
  assert.ok(admin.includes('mural-gemini-prompt-versions'));
  assert.ok(admin.includes('Visualizar prompt selecionado'));
  assert.ok(css.includes('.mural-gemini-prompt-versions'));
  assert.ok(css.includes('.mural-gemini-direction-summary'));
});

test('collection registration uses the Collection Launch Hero Card standard by default', () => {
  assert.ok(router.includes('const COLLECTION_LAUNCH_BASE_PROMPT ='));
  assert.ok(router.includes('Collection Launch Hero Card'));
  assert.ok(router.includes('approximately 2:1 aspect ratio'));
  assert.ok(router.includes('Small rounded badge: "NOVO"'));
  assert.ok(router.includes('CTA: "NOVA COLEÇÃO"'));
  assert.ok(router.includes('products.slice(0,5)'));
  assert.ok(router.includes('never invent or duplicate products'));
  assert.ok(router.includes('Left typography zone: approximately'));
  assert.ok(router.includes('Right product showcase zone: approximately'));
  assert.ok(admin.includes('PADRÃO VISUAL'));
  assert.ok(admin.includes('Collection Launch Hero Card'));
  assert.ok(admin.includes('Frase / descrição da coleção'));
  assert.ok(admin.includes('banner 2:1, texto à esquerda e produtos reais da coleção à direita'));
  assert.ok(css.includes('.mural-collection-visual-standard'));
});

test('collection launch offers three campaign-specific layout variants', () => {
  assert.ok(router.includes('const COLLECTION_LAUNCH_VARIANTS = Object.freeze(['));
  assert.ok(router.includes("'collection-balanced'"));
  assert.ok(router.includes("'collection-product-forward'"));
  assert.ok(router.includes("'collection-type-forward'"));
  assert.ok(router.includes('Versão 1 · Hero equilibrado'));
  assert.ok(router.includes('Versão 2 · Produtos em destaque'));
  assert.ok(router.includes('Versão 3 · Nome da coleção'));
});

test('product registration no longer creates automatic Mural drafts', () => {
  assert.equal(core.includes('suggestMuralProductDraft'), false);
  assert.equal(core.includes('Falha ao sugerir rascunho para novo produto'), false);
  assert.equal(router.includes('suggestMuralProductDraft'), false);
  assert.equal(router.includes('system:suggestion'), false);
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
  assert.ok(admin.includes('Preparar 3 versões de prompt'));
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
