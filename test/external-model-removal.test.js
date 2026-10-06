import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const runtimeFiles = [
  'wrangler.toml',
  'wrangler.preview.toml',
  ...fs.readdirSync('src')
    .filter(name => /\.(?:js|jsx)$/.test(name))
    .map(name => `src/${name}`)
];
const runtimeSource = runtimeFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const muralAdmin = fs.readFileSync('src/admin/MuralNistiAdminView.jsx', 'utf8');

test('runtime has no external AI, Workers AI or Vectorize integration', () => {
  assert.equal(fs.existsSync('src/ai-product-image-treatment.js'), false);
  assert.equal(fs.existsSync('src/vectorize-admin-router.js'), false);
  assert.doesNotMatch(runtimeSource, /generativelanguage\.googleapis\.com|GEMINI_API_KEY|GEMINI_IMAGE_MODEL|AI_VISION_MODEL|env\.AI\.run|COVER_VECTORS|:embedContent/i);
  assert.doesNotMatch(fs.readFileSync('wrangler.toml','utf8'), /\[ai\]|\[\[vectorize\]\]/);
});

test('Mural treatment is local and publication editor remains manual', () => {
  const worker=fs.readFileSync('src/product-image-treatment-worker.jsx','utf8');
  assert.doesNotMatch(worker, /\/ai\b|Gemini|Workers AI|detected_has_tassel/i);
  assert.match(worker, /tasselCode:item\.tassel_code/);
  assert.doesNotMatch(muralAdmin, /IA aplicada|gemini|preparar versões de prompt|abrir modelo externo/i);
  assert.match(muralAdmin, /Imagem editorial \(opcional\)/);
  assert.match(muralAdmin, /Clique para enviar uma imagem/);
  assert.match(muralAdmin, /accept="image\/jpeg,image\/png,image\/webp"/);
});

test('legacy visual-recognition runtime modules are absent', () => {
  for (const file of [
    'src/recognition-metrics.js',
    'src/geometric-shadow-evidence-router.js',
    'src/geometric-shadow-confirmation-router.js',
    'public/geometric-core.js'
  ]) assert.equal(fs.existsSync(file), false, `legacy AI file still exists: ${file}`);
});
