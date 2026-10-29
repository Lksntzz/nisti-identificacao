import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { growth, pctText } from '../src/commerce-annual-compare-helpers.js';

test('growth nao inventa percentual sem base', () => {
  assert.equal(growth(10, 0), null);
  assert.equal(growth(50, 100), -50);
  assert.equal(pctText(null), '—');
  assert.equal(pctText(12.34), '+12,3%');
});

test('SQL do comparativo anual e somente leitura e restrito ao service_role', () => {
  for (const f of ['20261029120000_commerce_annual_compare_v1', '20261029130000_commerce_annual_compare_coverage_v1']) {
    const sql = fs.readFileSync(`supabase/migrations/${f}.sql`, 'utf8');
    assert.match(sql, /revoke all on function[^;]*from public,\s*anon,\s*authenticated/i);
    assert.match(sql, /grant execute on function[^;]*to service_role/i);
  }
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /sales-compare\/annual/);
});

test('Painel Comercial tem submenu com os tres itens', () => {
  const p = fs.readFileSync('src/commerce-commercial-panel.jsx', 'utf8');
  for (const l of ['Anúncios', 'Comparação anual', 'Categorias']) assert.ok(p.includes(l));
});

import { indexOf, weekHighlights } from '../src/commerce-annual-compare-helpers.js';
test('indice 100 = igual ao ano passado e nao existe sem base', () => {
  assert.equal(indexOf(55, 100), 55);
  assert.equal(indexOf(150, 100), 150);
  assert.equal(indexOf(10, 0), null);
});
test('destaques de semana ignoram semana parcial e semana 5', () => {
  const [m] = weekHighlights([{ month: 10, weeks: [
    { n: 1, cur: 900, base: 2090, days: 7 }, { n: 2, cur: 1359, base: 2302, days: 7 },
    { n: 3, cur: 1286, base: 2146, days: 7 }, { n: 4, cur: 100, base: 1762, days: 3 }] }]);
  assert.equal(m.best.n, 2);
  assert.equal(m.worst.n, 1);
  assert.equal(m.cur, 3645);
});
test('SQL mensal e restrito ao service_role e rota existe', () => {
  const sql = fs.readFileSync('supabase/migrations/20261029140000_commerce_annual_month_v1.sql', 'utf8');
  assert.match(sql, /revoke all on function[^;]*from public,\s*anon,\s*authenticated/i);
  assert.match(fs.readFileSync('src/commerce-admin-router.js', 'utf8'), /sales-compare\/annual-month/);
});
