import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const detail=ui.slice(ui.indexOf('function ListingDetail('),ui.indexOf('export default function CommerceCommercialDashboard'));
const summary=detail.slice(detail.indexOf("{activeTab==='summary'&&<>"),detail.indexOf("{activeTab==='finance'&&<>"));
const finance=detail.slice(detail.indexOf("{activeTab==='finance'&&<>"),detail.indexOf("{activeTab==='variations'&&<>"));
const variations=detail.slice(detail.indexOf("{activeTab==='variations'&&<>"),detail.indexOf("{activeTab==='aftercare'&&<>"));
const aftercare=detail.slice(detail.indexOf("{activeTab==='aftercare'&&<>"),detail.indexOf('</section>',detail.indexOf("{activeTab==='aftercare'&&<>")));

test('desempenho aparece exclusivamente no Resumo, nunca fora das abas',()=>{
  assert.equal((detail.match(/className="nim-detail-performance"/g)||[]).length,1);
  assert.match(summary,/className="nim-detail-performance" aria-label="Desempenho do anúncio"/);
  assert.doesNotMatch(detail.slice(0,detail.indexOf("{activeTab==='summary'&&<>")) , /className="nim-detail-performance"/);
  for(const tab of [finance,variations,aftercare])
    assert.doesNotMatch(tab,/className="nim-detail-performance"/);
  assert.match(summary,/PERIODS\.map\(p=><button/);
  assert.match(summary,/partialLinked\?num\(partialUnits\):pending\?'—':num\(detail\.units\)/);
  assert.match(summary,/partialLinked\?money\(partialRevenue\):pending\?'—':money\(detail\.revenue\)/);
});

test('resumo enxuto traz links e informações fundamentadas de todas as outras opções',()=>{
  for(const name of ['Financeiro','Variações','Pós-venda','Shopee Ads'])
    assert.match(summary,new RegExp('>'+name+' <b aria-hidden="true">'));
  for(const tab of ['finance','variations','aftercare','shopee_ads'])
    assert.match(summary,new RegExp("setActiveTab\\('"+tab+"'\\)"));
  assert.match(summary,/hasShopeeAds&&item\.source==='SHOPEE'/);
  assert.match(summary,/latestAds\?\.clicks/);
  assert.match(summary,/CTR /);
  assert.match(summary,/Não importado/);
  assert.match(summary,/vínculo parcial/);
  assert.match(summary,/taxas não conciliadas/);
  assert.match(summary,/Subtotal dos produtos/);
  assert.doesNotMatch(summary,/after_identified_fees/);
  assert.match(detail,/Métricas adicionais de tráfego/);
});

test('histórico mensal continua funcional, mas fica fechado inicialmente',()=>{
  assert.match(summary,/<details className="nim-detail-history">/);
  assert.match(summary,/<summary>Histórico mensal de vendas/);
  assert.match(summary,/<MonthBars months=\{historicalMonths\} basis="REVENUE"\/>/);
  assert.doesNotMatch(summary,/<details className="nim-detail-history" open/);
  assert.match(css,/\.nim-detail-history-body/);
  assert.match(css,/\.nim-detail-overview\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.nim-detail-tab-panel>\.nim-detail-performance/);
});

test('abas de detalhes seguem separadas, sem alteração nos dados de vendas',()=>{
  assert.match(detail,/const detailTabs=hasShopeeAds&&item\.source==='SHOPEE'/);
  assert.match(detail,/activeTab==='finance'/);
  assert.match(detail,/activeTab==='variations'/);
  assert.match(detail,/activeTab==='aftercare'/);
  assert.match(detail,/activeTab==='shopee_ads'/);
  assert.match(detail,/if\(!\['finance','summary'\]\.includes\(activeTab\)\|\|item\.source!=='SHOPEE'\)return/);
  assert.match(detail,/Não exibimos zero para cancelamentos ou devoluções sem relatório/);
  assert.match(detail,/Não foi possível confirmar os dados deste anúncio no período/);
});
