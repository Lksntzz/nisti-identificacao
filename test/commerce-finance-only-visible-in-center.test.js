import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const center=fs.readFileSync('src/commerce-import-center.jsx','utf8');
const css=fs.readFileSync('src/commerce-import-center.css','utf8');
const client=fs.readFileSync('src/commerce-import-client.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const reader=fs.readFileSync('src/commerce-sales-import-reader.js','utf8');

test('finance-only recovery is visible on the real import center used by the manager',()=>{
  const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
  assert.match(manager,/import CommerceImportModal from '\.\/commerce-import-modal\.jsx'/);
  const modal=fs.readFileSync('src/commerce-import-modal.jsx','utf8');
  assert.match(modal,/CommerceImportCenter key=\{mode\} embedded initialMode=\{mode\} hideModeSelector/);
  assert.match(center,/salesPlatform==='SHOPEE'&&<div className="import-center-finance-recovery">/);
  assert.match(center,/Recuperar só taxas/);
  assert.match(center,/onClick=\{handleSalesFinanceOnly\}/);
  assert.match(center,/disabled=\{salesReading\|\|salesImporting\|\|!salesParsed\?\.finance_month_rows\?\.length\}/);
  const pickerPos=center.indexOf('hint="Aceita relatórios .xlsx exportados da plataforma"');
  const recoverPos=center.indexOf('Recuperar só taxas');
  const uploadPos=center.indexOf('onClick={handleSalesImport}',pickerPos);
  assert.ok(pickerPos>0&&recoverPos>pickerPos&&recoverPos<uploadPos);
  assert.match(css,/\.import-center-finance-only/);
  assert.match(css,/@media\(max-width:650px\)/);
});

test('recovery handler does not import or replace sales',()=>{
  const start=center.indexOf('async function handleSalesFinanceOnly()');
  const end=center.indexOf('const catalogProgressText = useMemo',start);
  assert.ok(start>0&&end>start);
  const handler=center.slice(start,end);
  assert.match(handler,/reprocessShopeeSalesFinance\(salesParsed,setSalesProgress\)/);
  assert.match(handler,/WAITING_PARTS/);
  assert.match(handler,/result\.status === 'COMMITTED'/);
  assert.doesNotMatch(handler,/stageCommerceSalesWorkbook|commitCommerceSalesImport|handleSalesImport\(/);
  assert.match(handler,/onSalesChanged\?\.\(\)/);
});

test('backend only activates fees of an exact previously committed Shopee source',()=>{
  assert.match(client,/export async function reprocessShopeeSalesFinance/);
  const block=client.slice(client.indexOf('export async function reprocessShopeeSalesFinance'));
  assert.match(block,/sales\/finance\/source/);
  assert.match(block,/filename:parsedWorkbook\.filename,sha256:sha/);
  assert.match(block,/sales\/finance\/activate/);
  assert.doesNotMatch(block,/sales\/imports\`,\s*\{/);
  assert.match(router,/sales\/finance\/source/);
  assert.match(router,/sales\/finance\/activate/);
  assert.match(reader,/aggregateShopeeFinance\(raw\)/);
});
