import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMlPerformanceSheets, mlPeriodFromFilename } from '../src/commerce-ml-performance-reader.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const header=['ID do anúncio','Anúncio','Status atual','Variação','SKU','Qualidade do anúncio','Experiência de compra','Visitas únicas','Quantidade de vendas','Compradores únicos','Unidades vendidas','Vendas brutas (BRL)','% de participação','Total de opiniões','Opiniões ruins','Opiniões boas'];
const sheet=data=>[{sheet:'Relatório',data:[['Métricas'],[],header,...data]}];
const NAME='Relatorio_desempenho_publicacoes_2026_01_01-2026_10_27.xlsx';
test('periodo vem do nome do arquivo',()=>{
  assert.deepEqual(mlPeriodFromFilename(NAME),{start:'2026-01-01',end:'2026-10-27',days:300});
  assert.throws(()=>mlPeriodFromFilename('relatorio.xlsx'));
});
test('visitas contam uma vez por anuncio e vendas somam as variacoes',()=>{
  const p=parseMlPerformanceSheets(sheet([
    ['5687047620','Caderno','Ativa','Preto','SKU1','Básica','Boa','14.564','900','800','950','R$ 44.000','1%','10','1','9'],
    ['5687047620','Caderno','Ativa','Preto','SKU1','Básica','Boa','14.564','45','40','50','R$ 2.000','1%','10','1','9'],
    ['4039160649','Planner','Inativa','Colorido','','Sem calcular','Ruim',473,6,6,6,'R$ 299','0,1%','',null,'']
  ]),NAME,'NOVO');
  assert.equal(p.rows.length,3);
  assert.equal(p.rows[0].listing_id,'MLB5687047620');
  assert.equal(p.totals.listings,2);
  assert.equal(p.totals.visits,14564+473);
  assert.equal(p.totals.sales,951);
  assert.equal(p.totals.gross,46299);
  assert.equal(p.report.account,'NOVO');
});
test('rejeita conta ausente e planilha de outro tipo, e ignora linha vazia de rodape',()=>{
  assert.throws(()=>parseMlPerformanceSheets(sheet([['1234567','x']]),NAME,'OUTRA'));
  assert.throws(()=>parseMlPerformanceSheets([{sheet:'A',data:[['x','y']]}],NAME,'NOVO'));
  const p=parseMlPerformanceSheets(sheet([['5687047620','C','Ativa','','','','',10,1,1,1,'R$ 10','','','',''],['','','','','','','','','','','','','','','','']]),NAME,'ANTIGO');
  assert.equal(p.rows.length,1);
});
test('migracao e rotas: dados isolados, somente service_role, protecao de conta errada',()=>{
  const m=read('supabase/migrations/20261027130000_commerce_ml_performance_v1.sql');
  const router=read('src/commerce-admin-router.js');
  assert.match(m,/revoke all on function public\.commerce_ml_performance_import_v1/);
  assert.match(m,/grant execute on function public\.commerce_ml_performance_latest_v1\(\) to service_role/);
  assert.match(m,/< 0\.40/);
  assert.doesNotMatch(m,/(update|delete from) public\.commerce_(listings|products|current_sales)/i);
  assert.ok(router.includes("/ml/performance/reports"));
  assert.ok(router.includes("/ml/performance/latest"));
  assert.ok(read('src/commerce-dashboard.jsx').includes('/shopee/performance/latest'));
  assert.ok(read('src/commerce-dashboard.jsx').includes('perfItems[r.external_id]'));
  const sp=read('supabase/migrations/20261027140000_commerce_shopee_performance_latest_v1.sql');
  assert.match(sp,/grant execute on function public\.commerce_shopee_performance_latest_v1\(\) to service_role/);
  assert.match(sp,/order by period_end desc,id desc limit 1/);
  assert.doesNotMatch(sp,/\b(insert into|update public|delete from|drop )\b/i);
  assert.ok(router.includes('/shopee/performance/latest'));
  assert.ok(read('src/commerce-import-center.jsx').includes('CommerceMlPerformanceImport'));
});
