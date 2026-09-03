import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('System health backend does not claim account billing usage it cannot measure', () => {
  const source = read('src/system-metrics-clean-router.js');
  assert.equal(source.includes('cost_guarantee: false'), true);
  assert.equal(source.includes('provider_billing_connected: false'), true);
  assert.equal(source.includes('account_daily_rows_read: null'), true);
  assert.equal(source.includes('quota_usage: null'), true);
  assert.equal(source.includes('is_free_tier: true'), false);
});

test('System health uses actual configured Gemini model variables instead of legacy UI names', () => {
  const source = read('src/system-metrics-clean-router.js');
  for (const variable of [
    'GEMINI_MODEL',
    'GEMINI_VERIFIER_MODEL',
    'GEMINI_DETAIL_MODEL',
    'GEMINI_EMBEDDING_MODEL'
  ]) {
    assert.equal(source.includes(variable), true, `${variable} deve vir da configuração real`);
  }
});

test('R2 metric explicitly distinguishes bucket snapshot from billing usage', () => {
  const source = read('src/storage-metrics-router.js');
  assert.equal(source.includes("measurement: complete ? 'complete_bucket_snapshot' : 'partial_bucket_snapshot'"), true);
  assert.equal(source.includes('billing_usage: null'), true);
  assert.equal(source.includes('GB-mês'), true);
});

test('Admin UI has no fabricated free-tier guarantee, quota, trend or fallback metric after refactor', () => {
  const main = read('src/main.jsx');
  for (const forbidden of [
    '100% Plano Gratuito (Zero Custos)',
    'Nenhuma cobrança será gerada',
    '1.500 req/dia',
    '100% de garantia',
    'menos de 50 milissegundos',
    'sem depender do Gemini',
    '18/05/2026',
    '|| 342',
    '|| 23',
    'products.length || 1248',
    '.size || 4',
    '+24 esta semana',
    '+18% vs ontem',
    '+{unmatchedToday} pendentes',
    '(&lt;100ms)'
  ]) {
    assert.equal(main.includes(forbidden), false, `texto/dado fictício ainda presente: ${forbidden}`);
  }
});

test('Shadow observability renders inside AdminApp instead of a standalone entry route', () => {
  const main = read('src/main.jsx');
  const entry = read('src/entry.jsx');
  assert.equal(main.includes("activeView === 'shadow-observability'"), true);
  assert.equal(main.includes('<GeometricShadowObservability embedded />'), true);
  assert.equal(entry.includes("pathname === '/admin/shadow-observability'"), false);
  assert.equal(entry.includes("pathname.startsWith('/admin')"), true);
});
