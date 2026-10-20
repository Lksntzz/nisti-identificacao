import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyzeTrafficWindow,trafficDerivedRates} from '../src/commerce-traffic-analysis.js';
const sql=fs.readFileSync('supabase/migrations/20261020095000_commerce_listing_traffic_reports_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const route=fs.readFileSync('src/commerce-admin-router.js','utf8');
const tab=fs.readFileSync('src/commerce-listing-diagnosis-panel.jsx','utf8');
const listing=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const panel=fs.readFileSync('src/commerce-traffic-metrics.jsx','utf8');

test('reports distinguish unknown metric from actual zero',()=>{
  assert.deepEqual(trafficDerivedRates({visits:100,orders:0,clicks:null,impressions:null}),
    {ctr:null,conversion:0});
  assert.deepEqual(trafficDerivedRates({visits:0,orders:0,clicks:0,impressions:0}),
    {ctr:null,conversion:null});
});
test('drop in conversion requires comparable visits, report orders and meaningful volume',()=>{
  const r=analyzeTrafficWindow(
    {visits:980,orders:8,clicks:25,impressions:9500},
    {visits:1000,orders:80,clicks:130,impressions:10000}
  );
  assert.ok(r.evidence.some(x=>x.key==='conversion'));
  assert.ok(r.evidence.some(x=>x.key==='ctr'));
  assert.ok(r.evidence.every(x=>/não|hipótese|comprovad|aumentou/i.test(x.text)));
});
test('without both periods diagnosis refuses to invent change',()=>{
  assert.equal(analyzeTrafficWindow({visits:100},null).evidence.length,0);
  assert.equal(analyzeTrafficWindow({visits:50,orders:3},{visits:null,orders:null}).evidence.length,0);
  assert.ok(!analyzeTrafficWindow({visits:5},{visits:4}).evidence.some(x=>x.key==='visits'));
});
test('secure reporting table uses RLS, service role and exact matching windows',()=>{
  assert.match(sql,/alter table public\.commerce_listing_traffic_reports_v1 enable row level security/);
  assert.match(sql,/revoke all on public\.commerce_listing_traffic_reports_v1 from public, anon, authenticated/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/r\.period_start=b\.current_start and r\.period_end=b\.current_end/);
  assert.match(sql,/r\.period_start=b\.previous_start and r\.period_end=b\.previous_end/);
  assert.match(sql,/traffic_scope in \('ALL','ORGANIC','PAID'\)/);
  assert.doesNotMatch(sql,/create policy .*using \(true\)/i);
});
test('traffic entry remains admin-only, validated and tied to real listing id',()=>{
  assert.match(route,/listings\\\/manager\\\/\(\[0-9\]\+\)\\\/traffic/);
  assert.match(route,/commerceSaveListingTraffic\(env,listingTrafficPath\[1\]/);
  assert.match(store,/commerce_save_listing_traffic_v1/);
  assert.match(store,/commerce_listing_traffic_window_v1/);
  assert.match(store,/validateTrafficBounds/);
  assert.match(tab,/CommerceTrafficMetrics listingId=\{item\.id\} start=\{start\} end=\{end\}/);
  assert.match(listing,/start=\{selectedPeriodStart\} end=\{selectedPeriodEnd\}/);
  assert.match(panel,/source:source\.trim\(\)/);
  assert.match(panel,/A origem informada não foi verificada automaticamente/);
  assert.doesNotMatch(panel,/api\.mercadolibre\.com|api\.shopee\.com/);
});
