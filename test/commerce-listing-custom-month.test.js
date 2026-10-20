import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsx=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261016165500_commerce_listing_manager_custom_month_v1.sql','utf8');

test('o Gestor oferece Personalizado e só exibe seletor de mês dentro do período',()=>{
  assert.match(jsx,/<option value="MONTH">Personalizado · escolher mês<\/option>/);
  assert.match(jsx,/\{days===0&&<label className="nim-filter-field nim-filter-custom-month">Mês personalizado/);
  assert.match(jsx,/aria-label="Selecionar mês para análise personalizada"/);
  assert.doesNotMatch(jsx,/Mês de referência/);
  assert.doesNotMatch(css,/\.nim-filter-month/);
  assert.match(css,/\.nim-filter-period-group\{display:grid/);
});

test('janelas móveis limpam a seleção de mês e não cruzam filtros',()=>{
  assert.match(jsx,/if\(choice!=='MONTH'\)setMonth\(''\);/);
  assert.match(jsx,/change\(setDays,choice==='MONTH'\?0:Number\(choice\)\)/);
  assert.match(jsx,/if\(days===0 && month\)params\.set\('month',month\)/);
  assert.match(jsx,/if\(days===0&&!month\)\{/);
  assert.match(jsx,/lastSuccessfulRequest\.current=null/);
  assert.match(jsx,/setData\(null\);setLoading\(false\)/);
  assert.match(router,/!\[0,7,30,60,90\]\.includes\(days\)/);
  assert.match(router,/days===0 && !\/\^\\d\{4\}-/);
  assert.match(router,/days!==0 && Boolean\(month\)/);
  assert.match(store,/p_days: \[0,7,30,60,90\]\.includes\(Number\(filters.days\)\)/);
  assert.match(store,/Number\(filters.days\)===0 \? cleanText\(filters.month\) : null/);
});

test('o mês personalizado calcula 28-31 dias e não é limitado à última venda diária',()=>{
  assert.match(sql,/p_days=0 and p_reference_month/);
  assert.match(sql,/then least\(i\.month_end, \(now\(\) at time zone 'America\/Sao_Paulo'\)::date-1\)/);
  assert.match(sql,/d\.period_end-date_trunc\('month',d\.month_end\)::date\+1/);
  assert.match(sql,/d\.period_end-d\.days\+1 period_start/);
  assert.match(sql,/dc\.current_days>=b\.days ready/);
});

test('totais mensais não são usados para fabricar vendas individuais de anúncios',()=>{
  assert.match(sql,/commerce_sales_summary_rows s/);
  assert.match(sql,/sn\.is_current=true/);
  assert.match(sql,/s\.platform_code in \(select distinct source_code from listings\)/);
  assert.match(sql,/'imported_month'/);
  assert.match(sql,/d\.external_listing_id=l\.external_listing_id and d\.platform_code=l\.source_code/);
  assert.match(jsx,/data\?\.imported_month/);
  assert.match(jsx,/A cobertura global não comprova ausência de vendas em cada variação/);
  assert.match(jsx,/Vendas identificadas por SKU exclusivo/);
  assert.doesNotMatch(sql,/insert into public\.products|update public\.products|delete from public\.products/);
});

test('detalhes com filtro mensal nunca trocam outubro por janela de 60 dias',()=>{
  assert.match(jsx,/const detailDays=days===0\?0:requestedDetailDays/);
  assert.match(jsx,/days===0\?\s*<span className="nim-detail-period-locked"/);
  assert.match(jsx,/Período fixado pelo mês personalizado/);
  assert.doesNotMatch(jsx,/days===0&&<button type="button" aria-pressed=\{detailDays===0\}/);
  assert.match(jsx,/Esta ficha segue apenas \{periodLabel\(0,month\)\}/);
  assert.match(jsx,/if\(detailDays===days\)\{setPeriodError\(''\);setPeriodLoading\(false\);return;\}/);
  assert.match(jsx,/if\(detailDays===0 && month\)params\.set\('month',month\)/);
  assert.match(jsx,/const detail=detailDays===days\?item/);
  assert.match(jsx,/key=\{\[selected\.id,days,month,selectedTab\]\.join\(':'\)\}/);
});

test('comparações de 7, 30, 60 e 90 dias continuam disponíveis fora do mês personalizado',()=>{
  assert.match(jsx,/const \[requestedDetailDays,setDetailDays\]=useState\(days\)/);
  assert.match(jsx,/PERIODS\.map\(p=><button type="button" key=\{p\}/);
  assert.match(jsx,/setDetailDays\(p\)/);
  assert.match(jsx,/search:String\(item\.external_listing_id\|\|''\)/);
});
