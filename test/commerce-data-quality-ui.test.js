import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {priceStockCard,buildCards,groupCards,compactCard,summaryItems,batchRows,shortText,SECTIONS} from '../src/ga/commerce-data-quality-logic.js';
import {setPrivate} from '../src/ga/commerce-privacy.js';

const jsx=fs.readFileSync(new URL('../src/ga/commerce-data-quality.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/ga/commerce-data-quality.css',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261124140000_commerce_data_quality_v1.sql',import.meta.url),'utf8');

// Fixture mínima e fictícia (nenhum valor real de produção).
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
  const d=mini({ml_unlinked_sales:{severity:'INFORMATIVO',pct_units:1.79,pct_revenue:2.95,total_units:1000,total_revenue:98765.43,listings_with_sales:40,units_without_registered_listing:20,revenue_without_registered_listing:1234.56,listings_without_registered_listing:5,items:null}});
  setPrivate(true);
  try{
    const k=compactCard(buildCards(d).find(c=>c.id==='link'));
    const text=JSON.stringify([k.primary,k.more,k.details]);
    assert.ok(!/1\.234|98\.765/.test(text),'valor em R$ vazou');
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


const ML_ADS=[{kind:'ADS',freshness:'SEM_INFORMACAO',reports:0},{kind:'DESEMPENHO',freshness:'SEM_INFORMACAO',reports:0},{kind:'POS_VENDA',freshness:'SEM_INFORMACAO',reports:0},{kind:'TRAFEGO_MANUAL',freshness:'SEM_INFORMACAO',reports:0},{kind:'ADS_ML',freshness:'SEM_INFORMACAO',reports:0}];
const noPS={registered_price:{status:'SEM_INFORMACAO',variations:0,variations_with_price:0},stock:{status:'SEM_INFORMACAO',variations_with_stock:0},realized_price:{status:'SEM_INFORMACAO',listings_with_units:0}};
const ga011=(status)=>({reconciliation_status:status,coverage_status:'COMPLETO',unmatched_sku_count:0});
const by=(d)=>Object.fromEntries(summaryItems(d).map(i=>[i.key,i]));

test('GA-018A rev.1: conciliação geral não aparece aprovada se GA-011 (Shopee) estiver sem informação; resultados separados',()=>{
  const d=mini({platform:'SHOPEE',ga011_shopee:ga011('SEM_INFORMACAO')});
  const r=by(d).recon;
  assert.notEqual(r.value,'Conciliado internamente');
  assert.match(r.value,/parcial/i);
  assert.match(r.sub,/GA-019/);
  assert.match(r.sub,/GA-011/);
  assert.match(r.sub,/Sem informação/);
  assert.notEqual(r.tone,'ok');
});

test('GA-018A rev.1: GA-019 sem informação também impede aprovação geral, mesmo com GA-011 conciliada',()=>{
  const d=mini({platform:'SHOPEE',ga011_shopee:ga011('CONCILIADO_INTERNAMENTE'),sales:{...mini().sales,reconciliation:{status:'SEM_INFORMACAO',months_checked:0,divergent_months:[]}}});
  assert.notEqual(by(d).recon.value,'Conciliado internamente');
  assert.match(by(d).recon.value,/parcial/i);
});

test('GA-018A rev.1: Shopee sem objeto GA-011 conta como sem informação; ML só tem GA-019 aplicável',()=>{
  assert.match(by(mini({platform:'SHOPEE',ga011_shopee:null})).recon.value,/parcial/i);
  const ml=by(mini({platform:'ML_ANTIGO',ga011_shopee:null})).recon;
  assert.equal(ml.value,'Conciliado internamente');
  assert.doesNotMatch(ml.sub||'',/GA-011/);
});

test('GA-018A rev.1: todas as conciliações aplicáveis sem informação → "Sem informação"; divergência prevalece; tudo conciliado → aprovado',()=>{
  const none={...mini().sales,reconciliation:{status:'SEM_INFORMACAO',months_checked:0,divergent_months:[]}};
  assert.equal(by(mini({platform:'SHOPEE',sales:none,ga011_shopee:ga011('SEM_INFORMACAO')})).recon.value,'Sem informação');
  assert.equal(by(mini({platform:'SHOPEE',ga011_shopee:ga011('DIVERGENTE')})).recon.value,'Divergente');
  const ok=by(mini({platform:'SHOPEE',ga011_shopee:ga011('CONCILIADO_INTERNAMENTE')})).recon;
  assert.equal(ok.value,'Conciliado internamente');
  assert.equal(ok.tone,'ok');
});

test('GA-018A rev.1: Ads do Mercado Livre não é contado duas vezes em "fontes sem informação"',()=>{
  const d=mini({reports:ML_ADS,price_stock:noPS,catalog:{...mini().catalog,freshness:'ATUALIZADO'}});
  // ADS e ADS_ML são a mesma fonte: 4 relatórios distintos + catálogo + preço/estoque = 6; sem informação: 4 relatórios + preço/estoque = 5
  assert.equal(by(d).noinfo.value,'5 de 6');
  const comAds=mini({reports:ML_ADS.map(r=>r.kind==='ADS'?{...r,freshness:'ATUALIZADO',reports:1}:r),price_stock:noPS});
  assert.equal(by(comAds).noinfo.value,'4 de 6');
});

test('GA-018A rev.1: Shopee (sem ADS_ML) mantém a contagem de fontes',()=>{
  const d=mini({platform:'SHOPEE',reports:ML_ADS.filter(r=>r.kind!=='ADS_ML'),price_stock:noPS});
  assert.equal(by(d).noinfo.value,'5 de 6');
});

test('GA-018A rev.1: preço e estoque indisponíveis mostram traço, não zero',()=>{
  const c=priceStockCard(mini({price_stock:noPS}));
  const map=Object.fromEntries(c.lines);
  assert.equal(map['Variações na foto do catálogo'],'—');
  assert.equal(map['Com preço válido'],'—');
  assert.equal(map['Com estoque válido'],'—');
  assert.equal(map['Anúncios com preço realizado no período'],'—');
  const k=compactCard(c);
  assert.ok(![...k.primary,...k.more].some(([,v])=>v==='0'));
});

test('GA-018A rev.1: zero verdadeiro continua zero (sem valor válido) e valores disponíveis aparecem',()=>{
  const c=priceStockCard(mini({price_stock:{registered_price:{status:'SEM_VALOR_VALIDO',variations:12,variations_with_price:0},stock:{status:'DISPONIVEL_FOTO',variations_with_stock:12},realized_price:{status:'DISPONIVEL',listings_with_units:7}}}));
  const map=Object.fromEntries(c.lines);
  assert.equal(map['Com preço válido'],'0');
  assert.equal(map['Variações na foto do catálogo'],'12');
  assert.equal(map['Com estoque válido'],'12');
  assert.equal(map['Anúncios com preço realizado no período'],'7');
});

test('GA-018A rev.1: o arquivo de testes não contém valores comerciais reais',()=>{
  const self=fs.readFileSync(new URL(import.meta.url),'utf8');
  const banned=[['44','08'],['1492','06'],['2075','84268'],['.pre','view']].map(a=>a.join(''));
  for(const b of banned)assert.ok(!self.includes(b),'valor real/local no teste: '+b);
  assert.doesNotMatch(self,/MLB\d{7,}/);
});
