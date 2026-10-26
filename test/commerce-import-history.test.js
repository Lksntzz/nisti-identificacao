import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261026150000_commerce_sales_import_history_v1.sql');
const router=read('src/commerce-admin-router.js');
const app=read('src/commerce-admin-app-v2.jsx');
const ui=read('src/commerce-import-history.jsx');
test('import history SQL is read-only, service_role only and filename-first',()=>{
  assert.match(sql,/language sql stable/);
  assert.doesNotMatch(sql,/\b(insert into|update public|delete from)\b/i);
  assert.match(sql,/revoke all on function public\.commerce_sales_import_history_v1/);
  assert.match(sql,/grant execute[\s\S]*to service_role/);
  assert.match(sql,/regexp_match\(b\.source_filename/);
});
test('route validates platform and GA menu exposes the history view',()=>{
  assert.ok(router.includes("/sales/import-history"));
  assert.ok(router.includes("['TODAS','SHOPEE','ML_ANTIGO','ML_NOVO'].includes(platform)"));
  assert.ok(app.includes("id: 'imports'")&&app.includes('<CommerceImportHistory />'));
});
test('UI separates applied from pending imports and explains the period source',()=>{
  assert.ok(ui.includes('Pendente · não aplicada')&&ui.includes('Aplicada'));
  assert.ok(ui.includes('Período lido do nome do arquivo'));
  assert.ok(ui.includes('dia(s) sem nenhuma venda'));
});
