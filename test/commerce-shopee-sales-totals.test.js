import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shopeeSalesTotals } from '../src/commerce-ad-evidence.js';

test('mês Shopee mostra o total importado e mantém subtotal vinculado',()=>{
  const data={source_kind:'MONTHLY_SKU_PARTIAL',kpis:{month_linked_units:5156,month_linked_revenue:178251.60},
    imported_month:{units:5171,revenue:178815.10}};
  assert.deepEqual(shopeeSalesTotals(data,0),{
    hasImportedTotal:true,units:5171,revenue:178815.10,
    linkedUnits:5156,linkedRevenue:178251.60
  });
});
test('janela móvel mostra somente valor vinculado',()=>{
  const data={source_kind:'DAILY_SKU_PARTIAL',kpis:{identified_units:4752,identified_revenue:168651.13}};
  assert.deepEqual(shopeeSalesTotals(data,30),{
    hasImportedTotal:false,units:4752,revenue:168651.13,
    linkedUnits:4752,linkedRevenue:168651.13
  });
});
test('na falta de origem confiável não fabrica total nem zeros',()=>{
  const kpis={month_linked_units:6,month_linked_revenue:300};
  const data={source_kind:'MONTHLY_SKU_PARTIAL',kpis};
  assert.equal(shopeeSalesTotals(data,0).hasImportedTotal,false);
  assert.equal(shopeeSalesTotals({...data,imported_month:{units:5,revenue:290}},0).hasImportedTotal,false);
  assert.equal(shopeeSalesTotals({...data,kpis:{month_linked_units:null,month_linked_revenue:null}},0),null);
  assert.equal(shopeeSalesTotals({...data,kpis:{month_linked_units:-1,month_linked_revenue:300}},0),null);
  assert.equal(shopeeSalesTotals({source_kind:'LISTING_DAILY',kpis},30),null);
});
test('a interface distingue bruto do vinculado sem sinal enganoso',()=>{
  const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
  assert.match(ui,/Faturamento bruto importado/);
  assert.match(ui,/Faturamento vinculado/);
  assert.match(ui,/shopeeSalesTotals\(data,days\)/);
  assert.match(ui,/Outros registros podem permanecer sem associação/);
  assert.doesNotMatch(ui,/≥/);
});
