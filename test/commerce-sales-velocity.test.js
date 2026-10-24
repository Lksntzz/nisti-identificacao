import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=f=>fs.readFileSync(f,'utf8');
const sql=read('supabase/migrations/20261016073000_commerce_sales_velocity_v2_active_zero_only.sql');
const store=read('src/commerce-supabase-store.js');
const router=read('src/commerce-admin-router.js');

test('daily results come from committed listing-day sales, not monthly snapshot rows',()=>{
  assert.match(sql,/commerce_current_sales_listing_daily_v1/);
  assert.match(sql,/commerce_sales_import_stage_summary/);
  assert.match(sql,/b.status='COMMITTED'/);
  assert.match(sql,/s.period_start=s.period_end/);
  assert.match(sql,/covered_sources as/);
  assert.match(sql,/d.sale_date between w.previous_start and w.current_end/);
  assert.match(sql,/current_days>=w.days/);
  assert.match(sql,/previous_days>=w.days/);
  assert.doesNotMatch(sql,/from public\.commerce_sales_rows r/);
  assert.match(store,/commerce_sales_velocity_v2/);
  assert.match(router,/\/sales\/velocity/);
});

test('performance rules compare matching window lengths and report true growth',()=>{
  assert.match(sql,/avg\(units\)::numeric average_sold/);
  assert.match(sql,/p.units < coalesce\(b.average_sold,0\)/);
  assert.match(sql,/p.units>=3/);
  assert.match(sql,/p.units>=p.previous_units\*1\.2/);
  assert.match(sql,/current_end-b.days previous_end/);
  assert.match(sql,/current_end-2\*b.days\+1 previous_start/);
  assert.match(sql,/grant execute.*commerce_sales_velocity_v2/s);
});
