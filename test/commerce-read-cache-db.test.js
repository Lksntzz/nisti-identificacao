import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store=fs.readFileSync('src/ga/commerce-supabase-store.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261105120000_commerce_read_cache_v1.sql','utf8');

test('consultas pesadas passam pelo cache do banco, com fallback se a função não existir', () => {
  for(const fn of ['commerce_dashboard_abc_v2','commerce_dashboard_v1','commerce_dashboard_overview_v1','commerce_dashboard_series_v2','commerce_dashboard_monthly_v1','commerce_categories_timeline_v1','commerce_categories_v2'])
    assert.match(store,new RegExp("cachedRpc\\(env,\\s*'"+fn+"'"),fn);
  assert.match(store,/error\.status===404\)return supabaseRpc\(env,fn,args,options\)/);
});
test('cache do banco: lista fechada, só service_role, invalida por importação/dia/6 h', () => {
  assert.match(sql,/funcao_nao_permitida/);
  assert.match(sql,/revoke all on function public\.commerce_cached_read_v1\(text,jsonb\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_cached_read_v1\(text,jsonb\) to service_role/);
  assert.match(sql,/interval '6 hours'/);
  assert.match(sql,/status='COMMITTED'/);
  assert.match(sql,/enable row level security/);
});
