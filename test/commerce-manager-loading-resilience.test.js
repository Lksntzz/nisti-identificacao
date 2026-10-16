import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fetchCommercialManager} from '../src/commerce-manager-fetch.js';

const sql=fs.readFileSync('supabase/migrations/20261016231500_commerce_listing_manager_single_daily_scan_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const base=fs.readFileSync('src/supabase-read-store.js','utf8');

const mockResponse=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>payload});

test('SQL materializes expensive sales day view once without changing business classification logic',()=>{
  assert.match(sql,/sales_days as MATERIALIZED/);
  assert.equal((sql.match(/from public\.commerce_current_sales_listing_daily_v1/g)||[]).length,1);
  assert.equal((sql.match(/(?:join|from) sales_days d/g)||[]).length,3);
  assert.match(sql,/identified_growth_pct/);
  assert.match(sql,/FALLING/);
  assert.match(sql,/create or replace function public\.commerce_listing_manager_v1/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/insert into public\.products|update public\.products|update public\.commerce_sales_rows/);
});

test('only the manager daily and monthly reads get the raised timeout',()=>{
  const manager=store.slice(store.indexOf('export async function commerceListingManager('),
    store.indexOf('export async function commerceListingManagerMonthly('));
  assert.match(manager,/commerce_listing_manager_v1/);
  assert.match(manager,/commerce_listing_manager_month_sku_v2/);
  assert.equal((manager.match(/timeoutMs:9000/g)||[]).length,2);
  assert.match(base,/const DEFAULT_TIMEOUT_MS = 2500/);
  assert.match(base,/const MAX_CUSTOM_TIMEOUT_MS = 30000/);
});

test('the manager read recovers from one explicitly retryable 408 without losing payload',async()=>{
  let attempts=0;
  const value={total:552,items:[{id:1}],kpis:{active_ads:552}};
  const result=await fetchCommercialManager('/manager',{fetchImpl:async(url,options)=>{
    attempts++;
    assert.equal(options.credentials,'same-origin');
    assert.equal(options.cache,'no-store');
    return attempts===1?mockResponse(408,{retryable:true,error:'Consulta demorou'}):mockResponse(200,value);
  }});
  assert.equal(attempts,2);
  assert.deepEqual(result,value);
});

test('invalid filters and auth are not retried',async()=>{
  let calls=0;
  await assert.rejects(
    fetchCommercialManager('/manager',{fetchImpl:async()=>{
      calls++;return mockResponse(400,{error:'Filtro inválido',retryable:false});
    }}),
    /Filtro inválido/
  );
  assert.equal(calls,1);
});

test('transient retry is limited to one extra request',async()=>{
  let calls=0;
  await assert.rejects(
    fetchCommercialManager('/manager',{fetchImpl:async()=>{
      calls++;return mockResponse(503,{error:'Banco temporariamente indisponível',retryable:true});
    }}),
    /temporariamente indisponível/
  );
  assert.equal(calls,2);
});

test('aborted requests do not retry or replace data from a later filter',async()=>{
  let calls=0;
  const controller=new AbortController();controller.abort();
  await assert.rejects(
    fetchCommercialManager('/manager',{signal:controller.signal,fetchImpl:async()=>{
      calls++;throw new DOMException('Aborted','AbortError');
    }}),
    /Abort|Aborted/
  );
  assert.equal(calls,1);
});

test('UI preserves successful same-filter data and clears results for different filters',()=>{
  assert.match(ui,/const lastSuccessfulRequest=useRef\(null\)/);
  assert.match(ui,/const matchingPrevious=lastSuccessfulRequest\.current===requestKey/);
  assert.match(ui,/if\(!matchingPrevious\)setData\(null\)/);
  assert.match(ui,/fetchCommercialManager\(API\+'\?'\+params,\{signal:controller\.signal\}\)/);
  assert.match(ui,/lastSuccessfulRequest\.current=requestKey;setData\(x\)/);
  assert.match(ui,/return \(\)=>\{cancelled=true;controller\.abort\(\);\}/);
  assert.match(ui,/Exibindo o último resultado confirmado para estes filtros/);
  assert.doesNotMatch(ui,/\.catch\(e=>\{if\(!cancelled\)\{setData\(null\);setError\(e\.message\);\}\}\)/);
});
