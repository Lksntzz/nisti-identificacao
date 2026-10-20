import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsx=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const details=jsx.slice(jsx.indexOf('const DETAIL_TABS='),jsx.indexOf('export default function CommerceCommercialDashboard'));
const sql=fs.readFileSync('supabase/migrations/20261016152000_commerce_listing_manager_v1.sql','utf8');

test('a ficha contém cinco abas acessíveis e todas mostram o mesmo anúncio',()=>{
  assert.match(details,/const DETAIL_TABS=\[\['diagnosis','Diagnóstico'\],\['summary','Resumo'\],\['finance','Financeiro'\],\['variations','Variações'\],\['aftercare','Pós-venda'\]\]/);
  assert.match(details,/role="tablist" aria-label="Informações do anúncio"/);
  assert.match(details,/role="tab"/);
  assert.match(details,/aria-selected=\{activeTab===code\}/);
  assert.match(details,/role="tabpanel"/);
  assert.match(details,/aria-labelledby=\{'nim-detail-tab-'\+activeTab\}/);
  assert.match(details,/setActiveTab\('variations'\)/);
  assert.match(details,/onClose/);
});

test('períodos do detalhe consultam ID real sem redefinir filtros da listagem',()=>{
  assert.match(details,/setDetailDays\(p\)/);
  assert.match(details,/aria-pressed=\{detailDays===p\}/);
  assert.match(details,/readJson\(API\+'\?'\+params\)/);
  assert.match(details,/search:String\(item\.external_listing_id\|\|''\)/);
  assert.match(details,/String\(x\.id\)===String\(item\.id\)/);
  assert.match(details,/if\(detailDays===0 && month\)params\.set\('month',month\)/);
  assert.match(jsx,/periodStart=\{data\?\.period_start\} periodEnd=\{data\?\.period_end\}/);
  assert.match(jsx,/zeroFilter=\{status==='ZERO'\}/);
  assert.match(jsx,/useEffect\(\(\)=>\{setOffset\(0\);setSelectedId\(null\);\},\[platform,days,month,search,status,curve,basis,size\]\)/);
  assert.doesNotMatch(details,/onDaysChange/);
});

test('indicadores ausentes nunca são fabricados a partir de vendas ou reembolsos',()=>{
  assert.match(details,/partialLinked\?num\(partialUnits\):pending\?'—':num\(detail\.units\)/);
  assert.match(details,/partialLinked\?money\(partialRevenue\):pending\?'—':money\(detail\.revenue\)/);
  assert.match(details,/label="Pedidos com item"/);
  assert.match(details,/order_item_incidents==null\?'—':num\(ordersMetrics\.listing\.order_item_incidents\)/);
  assert.match(details,/label="Receita por pedido com item"/);
  assert.match(details,/reference_per_item_order==null\?'—':money\(ordersMetrics\.listing\.reference_per_item_order\)/);
  assert.match(details,/não ticket médio exato do anúncio/);
  assert.match(details,/label="Descontos do vendedor" value="—"/);
  assert.match(details,/label="Taxas de serviço" value="—"/);
  assert.match(details,/label="Devoluções confirmadas" value="Não importado"/);
  assert.match(details,/label="Reembolsos realizados" value="Não importado"/);
  assert.match(details,/Não exibimos zero para cancelamentos ou devoluções sem relatório/);
  assert.match(details,/não representa repasse ou lucro líquido/);
});

test('a aba de variações conserva zeros apenas com cobertura confiável',()=>{
  assert.match(details,/const complete=Boolean\(detail\?\.ready&&detail\?\.variation_data_complete\)/);
  assert.match(details,/zeroFilter&&!showAll\?variations\.filter\(v=>v\.units===0\):variations/);
  assert.match(details,/v\.units==null\?'—':num\(v\.units\)/);
  assert.match(details,/v\.revenue==null\?'—':money\(v\.revenue\)/);
  assert.match(details,/não mostramos zeros presumidos/);
  assert.match(sql,/dc\.current_days>=b\.days/);
  assert.match(sql,/variation_data_complete/);
});

test('o layout usa painel amplo, cartões e hierarquia responsiva',()=>{
  assert.match(css,/\.nim-content\.has-detail\{grid-template-columns:minmax\(0,1fr\) minmax\(460px,570px\)\}/);
  assert.match(css,/\.nim-detail-metrics\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.nim-detail-tab-list\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:1180px\)/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.doesNotMatch(css,/\.nim-four-periods|\.nim-detail-kpis|\.nim-detail-meta/);
});
