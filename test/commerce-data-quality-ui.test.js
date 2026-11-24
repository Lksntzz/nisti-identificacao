import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCards,groupCards,compactCard,summaryItems,batchRows,shortText,SECTIONS} from '../src/ga/commerce-data-quality-logic.js';
import {setPrivate} from '../src/ga/commerce-privacy.js';

const jsx=fs.readFileSync(new URL('../src/ga/commerce-data-quality.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/ga/commerce-data-quality.css',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261124140000_commerce_data_quality_v1.sql',import.meta.url),'utf8');
const fx=(p,d)=>JSON.parse(fs.readFileSync(new URL('../.preview/data/'+p+'_'+d+'.json',import.meta.url),'utf8'));
const hasFx=fs.existsSync(new URL('../.preview/data/ML_ANTIGO_0.json',import.meta.url));

// Fixture mínima e independente de .preview (que não é versionado).
const mini=(over={})=>({platform:'ML_ANTIGO',period:{start:'2026-10-01',end:'2026-11-24',today:'2026-11-24'},
 sales:{status:'PARCIAL',freshness:'ATUALIZADO',last_sale_day:'2026-11-24',complete_days:54,partial_days:1,days_without_information:0,days_with_records_unverified:0,requested_days:55,
  orders:[],reconciliation:{status:'CONCILIADO_INTERNAMENTE',months_checked:2,months_ok:2,divergent_months:[]}},
 catalog:{freshness:'DESATUALIZADO',listings:10,fresh_listings:0,not_fresh_listings:10,not_fresh_pct:100,never_checked_listings:0,threshold_days:7,last_checked_at:'2026-11-10T00:00:00Z',oldest_checked_at:'2026-10-10T00:00:00Z',days_since_oldest_check:45},
 reports:[{kind:'ADS',freshness:'SEM_INFORMACAO',reports:0},{kind:'DESEMPENHO',freshness:'ATUALIZADO',reports:1,last_period_end:'2026-11-20',days_since_period_end:4,overlapping_report_pairs:0,threshold_days:30}],
 price_stock:{registered_price:{status:'SEM_INFORMACAO'},stock:{status:'SEM_INFORMACAO'},realized_price:{status:'DISPONIVEL',listings_with_units:5}},
 ga011_shopee:null,open_batches:[{batch_id:8,file:'a.xlsx',rows:10,status:'STAGED',data_through:'2026-10-15'}],ml_unlinked_sales:null,...over});

test('GA-018A: seções na ordem pedida, sem cartão perdido',()=>{
  assert.deepEqual(SECTIONS.map(s=>s.title),['Vendas e consistência','Fontes complementares','Cadastro comercial','Operação']);
  const cards=buildCards(mini());
  const groups=groupCards(cards);
  assert.equal(groups.reduce((n,g)=>n+g.cards.length,0),cards.length);
  assert.ok(groups.find(g=>g.id==='sources').cards.every(c=>c.id.startsWith('report-')));
  assert.ok(groups.find(g=>g.id==='ops').cards.some(c=>c.id==='batches'));
});

test('GA-018A: compactCard mantém todos os indicadores (principais + detalhes) e limita o visível a 3',()=>{
  for(const c of buildCards(mini())){
    const k=compactCard(c);
    assert.ok(k.primary.length<=3,c.id);
    if(!c.brief){
      const all=[...k.primary,...k.more].map(([a])=>a).sort();
      assert.deepEqual(all,c.lines.map(([a])=>a).sort(),'perdeu indicador em '+c.id);
    }
  }
});

test('GA-018A: ação recomendada vira resumo curto e o texto integral continua disponível',()=>{
  const c=compactCard(buildCards(mini()).find(x=>x.id==='catalog'));
  assert.ok(c.shortAction.length<=110);
  assert.ok(c.actions.length>=1);
  assert.equal(shortText('Primeira frase. Segunda frase longa.'),'Primeira frase.');
  assert.ok(shortText('x'.repeat(300)).endsWith('…'));
  assert.equal(shortText(''),'');
});

test('GA-018A: linha de resumo traz os 5 itens pedidos',()=>{
  const items=summaryItems(mini());
  assert.deepEqual(items.map(i=>i.label),['Conciliação interna','Última atualização de vendas','Períodos divergentes','Fontes sem informação','Pendências críticas']);
  assert.equal(items[0].value,'Conciliado internamente');
  assert.equal(items[1].value,'24/11/2026');
  assert.equal(items[2].value,'0');
  assert.deepEqual(summaryItems(null),[]);
});

test('GA-018A: divergência e vendas desatualizadas contam como pendência crítica; ausência de informação não vira zero',()=>{
  const d=mini({sales:{...mini().sales,freshness:'DESATUALIZADO',reconciliation:{status:'DIVERGENTE',months_checked:2,months_ok:1,divergent_months:[{month:'2026-10-01'}]}}});
  const it=Object.fromEntries(summaryItems(d).map(i=>[i.key,i]));
  assert.equal(it.recon.value,'Divergente');
  assert.equal(it.div.value,'1');
  assert.equal(it.crit.value,'2');
  const none=mini({sales:{...mini().sales,reconciliation:{status:'SEM_INFORMACAO',months_checked:0,divergent_months:[]}}});
  assert.equal(Object.fromEntries(summaryItems(none).map(i=>[i.key,i]))['div'].value,'—');
});

test('GA-018A: GA-011 divergente (Shopee) também entra na linha de resumo',()=>{
  const d=mini({platform:'SHOPEE',ga011_shopee:{reconciliation_status:'DIVERGENTE',coverage_status:'COMPLETO',unmatched_sku_count:0}});
  const it=Object.fromEntries(summaryItems(d).map(i=>[i.key,i]));
  assert.equal(it.recon.value,'Divergente');
  assert.equal(it.crit.value,'1');
});

test('GA-018A: lotes abertos viram linhas de tabela simples',()=>{
  const rows=batchRows(mini());
  assert.deepEqual(rows,[{id:8,file:'a.xlsx',rows:10,dataThrough:'2026-10-15',status:'Lida, não aplicada'}]);
  assert.deepEqual(batchRows({open_batches:[]}),[]);
  assert.deepEqual(batchRows(null),[]);
});

test('GA-018A: modo privacidade continua mascarando valores nos indicadores principais e nos detalhes',()=>{
  const d=mini({ml_unlinked_sales:{severity:'INFORMATIVO',pct_units:1.79,pct_revenue:2.95,total_units:3137,total_revenue:149206.46,listings_with_sales:153,units_without_registered_listing:56,revenue_without_registered_listing:4408.33,listings_without_registered_listing:24,items:null}});
  setPrivate(true);
  try{
    const k=compactCard(buildCards(d).find(c=>c.id==='link'));
    const text=JSON.stringify([k.primary,k.more,k.details]);
    assert.ok(!/4\.408|149\.206/.test(text),'valor em R$ vazou');
    assert.ok(text.includes('R$ •••••'));
  }finally{setPrivate(false);}
});

test('GA-018A: componente — seções, resumo, "Ver detalhes", tabela de lotes e privacidade no código',()=>{
  assert.match(jsx,/groupCards\(/);
  assert.match(jsx,/summaryItems\(/);
  assert.match(jsx,/compactCard/);
  assert.match(jsx,/Ver detalhes/);
  assert.match(jsx,/<table/);
  assert.match(jsx,/usePrivacy\(\)/);
  assert.match(jsx,/Mostrar detalhes/);
  assert.match(jsx,/ndq-summary/);
  assert.doesNotMatch(jsx,/nota geral|score/i);
});

test('GA-018A: grade com no máximo 3 colunas no desktop e quebra de linha segura',()=>{
  assert.match(css,/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(css,/auto-fit/);
  assert.match(css,/overflow-wrap:\s*anywhere/);
  assert.match(css,/@media\s*\(max-width/);
});

test('GA-018A: escopo só de interface — função SQL, rotas e store não mudam',()=>{
  assert.match(sql,/create or replace function public\.commerce_data_quality_v1/);
  const store=fs.readFileSync(new URL('../src/ga/commerce-supabase-store.js',import.meta.url),'utf8');
  assert.match(store,/commerceDataQuality/);
});

test('GA-018A: com dados reais de produção, os três ambientes agrupam todos os cartões',{skip:!hasFx},()=>{
  for(const p of ['SHOPEE','ML_ANTIGO','ML_NOVO']){
    const d=fx(p,0);const cards=buildCards(d);
    assert.equal(groupCards(cards.map(compactCard)).reduce((n,g)=>n+g.cards.length,0),cards.length,p);
  }
});
