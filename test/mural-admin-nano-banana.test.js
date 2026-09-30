import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../src/edge-router.js', import.meta.url), 'utf8');

test('mural-router rejects invalid modes and styles outside of the allowlist', () => {
  // Reject mode invalid
  assert.ok(router.includes("const MURAL_AI_IMAGE_MODES = Object.freeze(new Set(['product_scene', 'collection_scene']))"));
  assert.ok(router.includes("if (!MURAL_AI_IMAGE_MODES.has(mode))"));

  // Reject style invalid
  assert.ok(router.includes("const AUTHORIZED_STYLES = Object.freeze({"));
  assert.ok(router.includes("if (!(style in AUTHORIZED_STYLES))"));
});

test('system prevents arbitrary prompt text from the client', () => {
  // Client does not use aiPrompt state and doesn't render prompt textareas
  assert.equal(admin.includes('aiPrompt'), false);
  assert.equal(admin.includes('Briefing criativo'), false);
  assert.equal(admin.includes('<textarea rows="4" maxLength="900"'), false);

  // Server doesn't read any body.prompt parameter or inject user strings into prompts
  assert.equal(router.includes('body.prompt'), false);
});

test('calls to the AI generation endpoint require an administrative session', () => {
  // Endpoint is prefix-matched in protected APIs which verify session
  assert.ok(edge.includes("pathname.startsWith('/api/admin/')"));
  assert.ok(edge.includes("isProtectedApi(pathname) && !(await validSession(request, env))"));
});

test('system prevents nonexistent product and collection requests and loads details directly from database', () => {
  // Server-side checks for product existence and database attributes query
  assert.ok(router.includes("SELECT id, sku, miolo_code, capa_code, acabamento_code, wireo_code, tassel_code, elastico_code, nome, variacao, image_key"));
  assert.ok(router.includes("O produto selecionado não existe no banco atual."));

  // Server-side checks for collection existence and database query
  assert.ok(router.includes("SELECT id, slug, name, year, description, image_key, status"));
  assert.ok(router.includes("A coleção selecionada não existe ou não está ativa no banco atual."));
});

test('Gemini image API uses a dedicated server-side key and never exposes it to the frontend', () => {
  assert.ok(router.includes("if (!env.GEMINI_IMAGE_API_KEY)"));
  assert.ok(router.includes("'x-goog-api-key':env.GEMINI_IMAGE_API_KEY"));
  assert.equal(router.includes("'x-goog-api-key':env.GEMINI_API_KEY"), false);
  assert.equal(admin.includes('GEMINI_IMAGE_API_KEY'), false);
  assert.equal(admin.includes('GEMINI_API_KEY'), false);
});

test('AI generated image does not publish automatically and is applied only after explicit administrator action', () => {
  // Keeps generation review-first on the client
  assert.ok(admin.includes("const [aiResult, setAiResult] = useState(null)"));
  assert.ok(admin.includes("const applyAiResult = () =>"));
  assert.ok(admin.includes("setImage(aiResult.file)"));
  assert.ok(admin.includes("Usar esta arte"));
  assert.ok(admin.includes("Descartar"));
});

test('Aviso posts cannot call image generation', () => {
  // Notices cannot use AI button block
  assert.ok(admin.includes("const canUseAi = form.kind === 'product' || form.kind === 'collection'"));
  assert.ok(admin.includes("{canUseAi && <button"));

  // Notice mode is absent from authorized AI image generation modes
  assert.ok(router.includes("new Set(['product_scene', 'collection_scene'])"));
});

test('mural public release gate remains untouched for QA testing', () => {
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
});

test('Gemini image request uses the MIME accepted by the production Interactions endpoint', () => {
  assert.ok(router.includes("mime_type:'image/jpeg'"));
  assert.equal(router.includes("mime_type:'image/png',\n          aspect_ratio:'16:9'"), false);
  assert.ok(admin.includes("outputMime === 'image/png' ? 'mural-arte-ia.png' : 'mural-arte-ia.jpg'"));
});



test('Gemini Pro fallback prepares the same server-side prompt and real product references without exposing an API key', () => {
  assert.ok(router.includes("async function adminPrepareMuralGeminiPro(request, env)"));
  assert.ok(router.includes("buildProductPrompt(product, finishLabels(product), style)"));
  assert.ok(router.includes("buildCollectionPrompt(collection, products, style)"));
  assert.ok(router.includes("sources = await muralAiReferenceImages(env, { productId })"));
  assert.ok(router.includes("sources = await muralAiReferenceImages(env, { collectionId })"));
  assert.ok(router.includes("gemini_url:'https://gemini.google.com/app'"));
  assert.ok(router.includes("reference_count:sources.length"));
  assert.ok(router.includes("references:sources.map(muralGeminiProReference)"));
  assert.ok(router.includes("'/api/admin/mural/gemini-pro-package'"));
  assert.equal(admin.includes('GEMINI_IMAGE_API_KEY'), false);
});

test('Mural offers a zero-extra-API-cost Gemini Pro handoff and return flow', () => {
  assert.ok(admin.includes('Usar minha conta Gemini Pro'));
  assert.ok(admin.includes('/api/admin/mural/gemini-pro-package'));
  assert.ok(admin.includes('Copiar e abrir Gemini Pro'));
  assert.ok(admin.includes('Baixar'));
  assert.ok(admin.includes('Trazer imagem gerada para o Mural'));
  assert.ok(admin.includes('A cota gratuita da API de imagem foi atingida.'));
  assert.ok(css.includes('.mural-gemini-pro-kit'));
  assert.ok(css.includes('.mural-gemini-pro-references'));
  assert.ok(css.includes('.mural-gemini-pro-return'));
});
