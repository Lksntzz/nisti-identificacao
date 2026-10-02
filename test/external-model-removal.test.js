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
const recognitionRouter = fs.readFileSync('src/vectorize-performance-router.js', 'utf8');

test('external model access is limited to the reviewed product-image assistant', () => {
  const assistant=fs.readFileSync('src/ai-product-image-treatment.js','utf8');
  assert.match(assistant,/generativelanguage\.googleapis\.com/);
  assert.match(assistant,/GEMINI_API_KEY/);
  assert.match(assistant,/env\.AI\.run/);
  assert.doesNotMatch(runtimeSource, /:embedContent/i);
});

test('Mural publication editor is manual-only', () => {
  assert.doesNotMatch(muralAdmin, /gemini|preparar versões de prompt|abrir modelo externo/i);
  assert.match(muralAdmin, /Envie uma arte pronta para a publicação/);
});

test('removed visual-recognition endpoints fail explicitly', () => {
  assert.match(recognitionRouter, /visual_recognition_removed/);
  assert.match(recognitionRouter, /status: 410/);
});
