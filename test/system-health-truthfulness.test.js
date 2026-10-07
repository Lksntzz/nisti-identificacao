import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

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
    'sem depender de serviço externo',
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

test('EAN operations replace removed visual tools in the active AdminApp', () => {
  const main = read('src/main.jsx');
  const entry = read('src/entry.jsx');
  assert.equal(main.includes("activeView === 'historico-ean'"), true);
  assert.equal(main.includes("activeView === 'ean-nao-cadastrados'"), true);
  assert.equal(main.includes("activeView === 'shadow-observability'"), false);
  assert.equal(main.includes('<GeometricShadowObservability embedded />'), false);
  assert.equal(entry.includes("pathname === '/admin/shadow-observability'"), false);
  assert.equal(entry.includes("pathname.startsWith('/admin/')"), true);
});


test('System health performs live checks and returns real operational issues', () => {
  const source = read('src/system-metrics-clean-router.js');
  assert.equal(source.includes("'/api/admin/system-health'"), true);
  assert.equal(source.includes("runHealthCheck('d1'"), false);
  assert.equal(source.includes("runHealthCheck('r2'"), true);
  assert.equal(source.includes("runHealthCheck('supabase'"), true);
  assert.equal(source.includes('nisti_system_health_core_v1'), true);
  assert.equal(source.includes("commerce_nisti_product_statuses_v1"), true);
  assert.equal(source.includes('recent_issues'), true);
});

test('Health UI derives service status from backend checks instead of hardcoded active pills', () => {
  const source = read('src/system-health-view.jsx');
  assert.equal(source.includes('health?.checks'), true);
  assert.equal(source.includes('check.status'), true);
  assert.equal(source.includes('Erros e ocorrências recentes'), true);
  assert.equal(source.includes('Sincronização NISTI → Catálogo'), true);
  assert.equal(source.includes('<strong>Scanner EAN</strong>'), false);
  assert.equal(source.includes('status-pill active">• Ativo'), false);
});
