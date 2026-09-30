import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../src/edge-router.js', import.meta.url), 'utf8');

test('Mural admin exposes only creative-scene and white-background removal image flows', () => {
  assert.ok(admin.includes('ESCoPO RESTRITO') || admin.includes('ESCOPO RESTRITO'));
  assert.ok(admin.includes("generateAiArt('creative_scene')"));
  assert.ok(admin.includes("generateAiArt('remove_background')"));
  assert.ok(admin.includes('Cenário criativo'));
  assert.ok(admin.includes('Remover fundo branco'));
  assert.ok(admin.includes("['creative_scene','remove_background'].includes(mode)"));
});

test('AI studio is shown only for Product and Collection publications', () => {
  assert.ok(admin.includes("(form.kind === 'product' || form.kind === 'collection')"));
  assert.ok(admin.includes("A IA de imagem está disponível somente para Produto e Coleção."));
  assert.equal(admin.includes('Arte sem produto de referência'), false);
});

test('server rejects every AI operation outside the explicit image allowlist', () => {
  assert.ok(router.includes("new Set(['creative_scene','remove_background'])"));
  assert.ok(router.includes("new Set(['product','collection'])"));
  assert.ok(router.includes('if (!MURAL_AI_IMAGE_MODES.has(mode))'));
  assert.ok(router.includes('if (!MURAL_AI_IMAGE_KINDS.has(kind))'));
  assert.ok(router.includes("mode === 'remove_background' && kind !== 'product'"));
});

test('AI art stays review-first and only becomes the editorial image after explicit apply', () => {
  assert.ok(admin.includes('const [aiResult, setAiResult] = useState(null)'));
  assert.ok(admin.includes('const applyAiResult = () =>'));
  assert.ok(admin.includes('setImage(aiResult.file)'));
  assert.ok(admin.includes('setImageUrl(URL.createObjectURL(aiResult.file))'));
  assert.ok(admin.includes('Usar esta arte'));
});

test('server uses real product and collection images as Gemini references', () => {
  assert.ok(router.includes('async function muralAiReferenceImages'));
  assert.ok(router.includes('mural_collection_products mcp'));
  assert.ok(router.includes("type:'image'"));
  assert.ok(router.includes('source_count:sources.length'));
  assert.ok(router.includes('Preserve exatamente o produto real'));
});

test('Gemini API secret stays server-side and the AI endpoint is admin-protected', () => {
  assert.ok(router.includes("https://generativelanguage.googleapis.com/v1beta/interactions"));
  assert.ok(router.includes("'x-goog-api-key':env.GEMINI_API_KEY"));
  assert.ok(router.includes("env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'"));
  assert.ok(wrangler.includes('GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image"'));
  assert.equal(admin.includes('GEMINI_API_KEY'), false);
  assert.ok(edge.includes("pathname.startsWith('/api/admin/')"));
});

test('AI generation is rate-limited and does not alter the public Mural release gate', () => {
  assert.ok(router.includes("reserveGeminiBudget(env,'mural-ai-art',6)"));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(css.includes('.mural-admin-ai-studio'));
  assert.ok(css.includes('.mural-admin-ai-capabilities'));
});
