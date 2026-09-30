import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

test('Mural admin exposes Nano Banana creative scene and background removal controls', () => {
  assert.ok(admin.includes('Estúdio de IA do Mural'));
  assert.ok(admin.includes('Nano Banana'));
  assert.ok(admin.includes("generateAiArt('creative_scene')"));
  assert.ok(admin.includes("generateAiArt('remove_background')"));
  assert.ok(admin.includes('Usar esta arte'));
  assert.ok(admin.includes('não publica automaticamente'));
});

test('AI art stays review-first and only becomes the editorial image after explicit apply', () => {
  assert.ok(admin.includes('const [aiResult, setAiResult] = useState(null)'));
  assert.ok(admin.includes('const applyAiResult = () =>'));
  assert.ok(admin.includes('setImage(aiResult.file)'));
  assert.ok(admin.includes('setImageUrl(URL.createObjectURL(aiResult.file))'));
});

test('server uses product and collection images as Gemini references', () => {
  assert.ok(router.includes('async function muralAiReferenceImages'));
  assert.ok(router.includes('mural_collection_products mcp'));
  assert.ok(router.includes("type:'image'"));
  assert.ok(router.includes('source_count:sources.length'));
  assert.ok(router.includes('Preserve exatamente o produto real'));
});

test('server calls Gemini Interactions API with the dedicated image model and server-side secret', () => {
  assert.ok(router.includes("https://generativelanguage.googleapis.com/v1beta/interactions"));
  assert.ok(router.includes("'x-goog-api-key':env.GEMINI_API_KEY"));
  assert.ok(router.includes("env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'"));
  assert.ok(wrangler.includes('GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image"'));
  assert.equal(admin.includes('GEMINI_API_KEY'), false);
});

test('AI generation is rate-limited and does not alter the public Mural release gate', () => {
  assert.ok(router.includes("reserveGeminiBudget(env,'mural-ai-art',6)"));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(css.includes('.mural-admin-ai-studio'));
});
