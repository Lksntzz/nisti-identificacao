import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  observedVariationCounts, adUnits, adRevenue, adState, variationState
} from '../src/commerce-evolution-helpers.js';

const view = fs.readFileSync('src/commerce-evolution-integrated.jsx', 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));

test('vendas exibidas são as importadas, sem estimativa "≥"', () => {
  const ad = { period_end: '2026-10-16', identified_30: 1145, identified_60: 2268, units_30: null,
    revenue_30: 38302.8 };
  assert.equal(adUnits(ad, 30), 1145);
  assert.equal(adUnits(ad, 60), 2268);
  assert.equal(adRevenue(ad, 30), 38302.8);
  assert.equal(adState(ad, 30), 'SOLD');
  assert.doesNotMatch(view, /≥ /);
});

test('zero só é exibido com relatório importado; sem relatório fica pendente', () => {
  assert.equal(adUnits({ period_end: '2026-10-16', identified_30: 0 }, 30), 0);
  assert.equal(adState({ period_end: '2026-10-16', identified_30: 0 }, 30), 'ZERO');
  const noReport = { period_end: null, units_30: null, identified_30: 0, revenue_30: 0 };
  assert.equal(adUnits(noReport, 30), null);
  assert.equal(adRevenue(noReport, 30), null);
  assert.equal(adState(noReport, 30), 'PENDING');
  assert.match(view, /dados pendentes/);
});

test('contagem de variações separa vendendo, paradas e pendentes', () => {
  const ten = Array.from({ length: 10 }, (_, i) => ({ id: i, match_verified: true, identified_30: 0 }));
  assert.deepEqual(plain(observedVariationCounts({ period_end: 'x', unlinked_30: 0, variations: ten }, 30)),
    { sold: 0, withoutSales: 10, pending: 0 });
  const mixed = { period_end: 'x', unlinked_30: 0, variations: [
    { match_verified: true, identified_30: 5 }, { match_verified: true, identified_30: 0 },
    { match_verified: false, identified_30: null }] };
  assert.deepEqual(plain(observedVariationCounts(mixed, 30)), { sold: 1, withoutSales: 1, pending: 1 });
});

test('venda do anúncio sem SKU atribuído nunca certifica variação zerada', () => {
  const ad = { period_end: 'x', units_30: 2, unlinked_30: 2,
    variations: [{ match_verified: true, identified_30: 0 }] };
  assert.equal(adUnits(ad, 30), 2);
  assert.deepEqual(plain(observedVariationCounts(ad, 30)), { sold: 0, withoutSales: 0, pending: 1 });
  assert.equal(variationState(ad.variations[0], 30, ad), 'UNKNOWN');
  assert.equal(variationState({ match_verified: true, identified_30: 0 }, 30, { unlinked_30: 0 }), 'ZERO');
  assert.equal(variationState({ match_verified: false, identified_30: 3 }, 30, {}), 'LINK');
});

test('layout v2: com/sem vendas em destaque, abas e nada expandido por padrão', () => {
  assert.match(view, /Com vendas em \{days\} dias/);
  assert.match(view, /Sem vendas em \{days\} dias/);
  assert.match(view, /kpis\.with_sales/);
  assert.match(view, /kpis\.no_sales_ads/);
  assert.match(view, /\['ZERO','Sem vendas ou paradas',kpis\.zero\]/);
  assert.match(view, /const \[open,setOpen\]=useState\(false\)/);
  assert.doesNotMatch(view, /initialExpanded/);
  assert.match(view, /Como os números são calculados/);
});

test('mesma API e paginação da versão anterior', () => {
  assert.match(view, /const PAGE=12,WINDOWS=\[30,60,90\]/);
  assert.match(view, /platform:selectedPlatform,days:String\(days\),status,limit:String\(PAGE\),offset:String\(offset\)/);
  assert.match(view, /API\+'\/evolution-ads\?'\+params/);
  assert.match(view, /'\/evolution-weekly'/);
});
