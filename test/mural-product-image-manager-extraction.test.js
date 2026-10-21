import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const manager = fs.readFileSync(new URL('../src/admin/MuralProductImageManager.jsx', import.meta.url), 'utf8');

test('Mural admin delegates treatment interface to exactly one standalone manager', () => {
  assert.match(admin, /import MuralProductImageManager from '\.\/MuralProductImageManager\.jsx'/);
  assert.match(admin, /<MuralProductImageManager products=\{products\} onChanged=\{load\} request=\{request\}\s*\/>/);
  assert.doesNotMatch(admin, /function MuralProductImageManager\(/);
  assert.doesNotMatch(admin, /function TreatedImageLightbox\(/);
  assert.match(manager, /export default function MuralProductImageManager\(\{ products, onChanged, request \}\)/);
});

test('treatment UI retains manual pause, review and approval with original image protected', () => {
  assert.match(manager, /localStorage\.getItem\(TREATMENT_PAUSE_KEY\)/);
  assert.match(manager, /new CustomEvent\(TREATMENT_CONTROL_EVENT/);
  assert.match(manager, /setJustApprovedIds\(current=>new Set\(current\)\.add\(Number\(product\.id\)\)\)/);
  assert.match(manager, /\/api\/admin\/product-image-treatment\/\$\{product\.id\}\/approve/);
  assert.match(manager, /\/api\/admin\/product-image-treatment\/\$\{product\.id\}\/redo/);
  assert.match(manager, /A foto original do catálogo fica intacta/);
  assert.match(manager, /Nenhuma imagem nesta fila/);
  assert.match(manager, /TreatedImageLightbox/);
  assert.match(manager, /mural-product-treatment-progress-track/);
});

test('refactor keeps all network mutations inside existing authenticated request helper', () => {
  assert.match(admin, /fetch\(path, \{ credentials: 'same-origin', cache: 'no-store'/);
  assert.doesNotMatch(manager, /\bfetch\s*\(/);
  assert.match(manager, /await request\(\`\/api\/admin\/mural\/products\/\$\{product\.id\}\/image\`/);
  assert.match(manager, /await request\(\`\/api\/admin\/product-image-treatment\/\$\{product\.id\}\/approve\`/);
});
