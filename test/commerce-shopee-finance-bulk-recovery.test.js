import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  validateFinanceRecoveryFiles,
  recoverMultipleShopeeFinances
} from '../src/commerce-finance-bulk-recovery.js';

const file=(name,size=1000)=>({name,size});
const panel=fs.readFileSync('src/commerce-sales-import-panel.jsx','utf8');
const client=fs.readFileSync('src/commerce-import-client.js','utf8');
const db=fs.readFileSync('supabase/migrations/20261017001000_commerce_shopee_finance_recovery_v1.sql','utf8');

test('accepts batches of Shopee XLSX and processes months and multipart files in numeric order',()=>{
  const selected=validateFinanceRecoveryFiles([
    file('Order.all.order_creation_date.20260901_20260930_part_2_of_2.xlsx'),
    file('Order.all.order_creation_date.20260801_20260831.xlsx'),
    file('Order.all.order_creation_date.20260901_20260930_part_1_of_2.xlsx')
  ]);
  assert.deepEqual(selected.map(x=>x.name),[
    'Order.all.order_creation_date.20260801_20260831.xlsx',
    'Order.all.order_creation_date.20260901_20260930_part_1_of_2.xlsx',
    'Order.all.order_creation_date.20260901_20260930_part_2_of_2.xlsx'
  ]);
});

test('rejects unsupported archives, duplicate names, and oversized batches before any upload',()=>{
  assert.throws(()=>validateFinanceRecoveryFiles([]),/pelo menos uma/);
  assert.throws(()=>validateFinanceRecoveryFiles([file('shopee.zip')]),/Extraia os ZIPs/);
  assert.throws(()=>validateFinanceRecoveryFiles([file('dados.xlsx',26*1024*1024)]),/25 MB/);
  assert.throws(()=>validateFinanceRecoveryFiles([file('a.xlsx'),file('A.xlsx')]),/mesmo nome/);
  assert.throws(()=>validateFinanceRecoveryFiles(
    Array.from({length:25},(_,i)=>file('lote_'+i+'.xlsx'))
  ),/24 planilhas/);
});

test('first multipart WAITING_PARTS is resolved when second part commits',async()=>{
  const calls=[];
  const reports=await recoverMultipleShopeeFinances([
    file('Setembro_part_2_of_2.xlsx'),file('Setembro_part_1_of_2.xlsx')
  ],{
    parse:async f=>({platform_code:'SHOPEE',filename:f.name,finance_month_rows:[{a:1}]}),
    recover:async x=>{
      calls.push(x.filename);
      return {result:x.filename.includes('_part_1_')?
        {status:'WAITING_PARTS',parts_received:1,parts_expected:2}:
        {status:'COMMITTED',finance_months:1}};
    }
  });
  assert.deepEqual(calls,[
    'Setembro_part_1_of_2.xlsx',
    'Setembro_part_2_of_2.xlsx'
  ]);
  assert.equal(reports.recoveredMonths,1);
  assert.equal(reports.successful,1);
  assert.equal(reports.awaitingParts.length,0);
  assert.equal(reports.failures.length,0);
});

test('a missing part remains pending rather than showing a completed financial month',async()=>{
  const result=await recoverMultipleShopeeFinances([file('Outubro_part_1_of_2.xlsx')],{
    parse:async f=>({platform_code:'SHOPEE',finance_month_rows:[{a:1}]}),
    recover:async ()=>({result:{status:'WAITING_PARTS',parts_received:1,parts_expected:2}})
  });
  assert.equal(result.recoveredMonths,0);
  assert.equal(result.awaitingParts.length,1);
  assert.equal(result.successful,0);
});

test('one invalid financial file cannot prevent reconciliation of other files',async()=>{
  const output=await recoverMultipleShopeeFinances([
    file('Janeiro.xlsx'),file('Fevereiro.xlsx')
  ],{
    parse:async f=>{
      if(f.name.startsWith('Janeiro'))throw new Error('SHA de origem diferente');
      return {platform_code:'SHOPEE',filename:f.name,finance_month_rows:[{a:1}]};
    },
    recover:async ()=>({result:{status:'COMMITTED',finance_months:1}})
  });
  assert.equal(output.total,2);
  assert.equal(output.failures.length,1);
  assert.match(output.failures[0].error,/SHA de origem diferente/);
  assert.equal(output.recoveredMonths,1);
});

test('the UI presents a separate finance-only multi-file tool, not a bulk sales re-import',()=>{
  assert.match(panel,/recoverMultipleShopeeFinances\(financeFiles/);
  assert.match(panel,/parse:readCommerceSalesXlsx/);
  assert.match(panel,/recover:reprocessShopeeSalesFinance/);
  assert.match(panel,/type="file" multiple/);
  assert.match(panel,/Recuperar taxas em lote/);
  assert.match(panel,/Nenhuma venda será reimportada/);
  assert.match(panel,/financeFiles\.length/);
  assert.match(panel,/progress\.fileIndex/);
});

test('server still verifies SHA and current snapshot without editing sales or Scanner',()=>{
  const section=client.slice(client.indexOf('export async function reprocessShopeeSalesFinance'));
  assert.match(section,/sales\/finance\/source/);
  assert.match(section,/sales\/finance\/activate/);
  assert.doesNotMatch(section,/sales\/imports\/\$\{batchId\}\/commit/);
  assert.match(db,/p_source_sha256/);
  assert.match(db,/v_actual_units is distinct from v_units/);
  assert.match(db,/WAITING_PARTS/);
  assert.doesNotMatch(db,/update public\.commerce_sales_rows|delete from public\.commerce_sales_rows/);
  assert.doesNotMatch(db,/update public\.products|delete from public\.products/);
});
