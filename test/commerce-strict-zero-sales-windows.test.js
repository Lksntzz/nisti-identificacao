import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020232000_commerce_listing_manager_strict_zero_windows_v1.sql','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');

test('Sem vendas exige anúncio de zero unidades e cobertura completa por todo período',()=>{
  assert.match(sql,/b\.selected_status='ZERO' and c\.ready and c\.units=0/);
  assert.match(sql,/dc\.current_days>=b\.days and l\.source_code<>'SHOPEE'/);
  assert.match(sql,/d\.period_end-d\.days\+1 period_start/);
  assert.match(sql,/d\.sale_date between b\.period_start and b\.period_end/);
  assert.match(sql,/count\(\*\) filter\(where ready and units=0\)::int zero_ads/);
  assert.doesNotMatch(sql,/b\.selected_status='ZERO' and c\.source_code='SHOPEE'/);
  assert.doesNotMatch(sql,/b\.selected_status='ZERO' and c\.ready and \(c\.units=0 or c\.zero_variations>0\)/);
});

test('variações que não venderam e Shopee sem atribuição não contaminam zero real',()=>{
  assert.match(sql,/b\.selected_status='VAR_ZERO' and c\.ready and c\.units>0 and c\.zero_variations>0/);
  assert.match(sql,/b\.selected_status='UNLINKED' and c\.source_code='SHOPEE' and/);
  assert.match(sql,/unlinked_shopee_ads/);
  assert.match(sql,/zero_variation_ads/);
  assert.match(router,/\['ALL','SOLD','ZERO','VAR_ZERO','UNLINKED','LOW','RISING','FALLING','PENDING'\]/);
  assert.match(sql,/SECURITY INVOKER/);
  assert.doesNotMatch(sql,/\b(?:delete\s+from|update|insert\s+into|truncate)\s+public\./i);
});

test('a interface usa janela explícita de 60/90 dias e estado ZERO rigoroso',()=>{
  assert.match(manager,/const noSalesStatus=shopeeUnlinkedView\?'UNLINKED':'ZERO'/);
  assert.match(manager,/const noSalesValue=shopeeUnlinkedView\?kpi\.unlinked_shopee_ads:kpi\.zero_ads/);
  assert.match(manager,/status===noSalesStatus/);
  assert.match(manager,/onClick=\{platform==='SHOPEE'&&days===0\?undefined:changeNoSales\}/);
  assert.match(manager,/\{n\} dias · janela importada/);
  assert.match(manager,/const changeNoSales=\(\)=>change\(setStatus,status===noSalesStatus\?'ALL':noSalesStatus\)/);
  assert.match(manager,/status==='VAR_ZERO'\?'ALL':'VAR_ZERO'/);
  assert.match(manager,/status==='UNLINKED'\?'ALL':'UNLINKED'/);
  assert.match(manager,/zeroFilter=\{status==='VAR_ZERO'\}/);
  assert.match(manager,/A Shopee ainda não possui atribuição confiável/);
  assert.match(manager,/data\?\.period_start/);
  assert.match(evolution,/Este resultado não garante que o anúncio inteiro ficou sem vendas/);
});

test('SQL ainda é somente leitura e preserva a política de segurança',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.commerce_listing_manager_v1/);
  assert.match(sql,/count\(distinct s\.period_start\) filter\(where s\.period_start between b\.period_start and b\.period_end/);
  assert.match(sql,/least\(\s*\(now\(\) at time zone 'America\/Sao_Paulo'\)::date-1/);
});
