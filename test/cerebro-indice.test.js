import test from 'node:test';
import assert from 'node:assert/strict';
import { gerar, areaDe, descricaoDe } from '../scripts/cerebro-indice.mjs';

test('areaDe separa as áreas principais do sistema', () => {
  assert.equal(areaDe('mural-router.js'), 'Mural');
  assert.equal(areaDe('admin/MuralPublishWorkspace.jsx'), 'Mural');
  assert.equal(areaDe('commerce-admin-router.js'), 'GA (Gestor de Anúncios)');
  assert.equal(areaDe('web-push.js'), 'Notificações e expedição');
  assert.equal(areaDe('edge-router.js'), 'Servidor (rotas, login, Worker)');
});

test('descricaoDe usa o comentário do topo ou, sem ele, os exports', () => {
  assert.match(descricaoDe('// Cache curto das leituras pesadas do GA\nexport const A = 1;'), /Cache curto/);
  assert.match(descricaoDe("import x from 'y';\nexport function foo() {}\nexport const bar = 1;"), /exporta: foo, bar/);
  assert.equal(descricaoDe('const so = 1;'), '');
});

test('gerar lista os arquivos reais de src/ sem escrever nada', () => {
  const md = gerar();
  assert.match(md, /Índice de arquivos de `src\/`/);
  assert.match(md, /`src\/mural-router\.js`/);
  assert.match(md, /`src\/commerce-supabase-store\.js`/);
  assert.match(md, /## GA \(Gestor de Anúncios\)/);
});
