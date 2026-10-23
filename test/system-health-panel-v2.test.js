import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const view = read('src/system-health-view.jsx');
const main = read('src/main.jsx');
const router = read('src/system-metrics-clean-router.js');

test('painel identifica o banco real (Supabase), não o D1 antigo', () => {
  assert.match(view, /<span>Banco \(Supabase\)<\/span>/);
  assert.doesNotMatch(view, /<span>D1<\/span>/);
});
test('falha de medição de banco/R2 é avisada na tela', () => {
  assert.match(main, /setMeasurementWarning\(failed\.length/);
  assert.match(view, /measurementWarning && \(/);
});
test('resultado de saúde degradado não fica em cache', () => {
  assert.match(router, /overallStatus === 'degraded'\n\s+\? \{ payload: null, expires_at: 0 \}/);
});
