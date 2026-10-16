import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = file => fs.readFileSync(file,'utf8');
const dashboard=read('src/commerce-commercial-dashboard.jsx');
const importView=read('src/commerce-import-center.jsx');
const styles=read('src/commerce-import-center.css');
const main=read('src/main.jsx');
const admin=read('src/commerce-admin-app-v2.jsx');
const nav=read('src/admin-navigation.js');

test('import is a compact card in the commercial dashboard, not a second sidebar page',()=>{
  assert.match(dashboard,/<CommerceImportCenter embedded/);
  assert.match(dashboard,/className="nisti-com-section nisti-com-imports"/);
  assert.match(dashboard,/onSalesChanged=\{\(\)=>setRefresh\(value=>value\+1\)\}/);
  assert.match(dashboard,/onCatalogChanged=\{\(\)=>setRefresh\(value=>value\+1\)\}/);
  assert.doesNotMatch(main,/<CommerceImportCenter onSalesChanged/);
  assert.doesNotMatch(admin,/<CommerceImportCenter onSalesChanged/);
  assert.doesNotMatch(nav,/id: 'import-center'/);
  assert.match(nav,/id: 'pending'/);
  assert.match(admin,/id: 'planning'/);
});

test('operator chooses type first; relevant platform, account and file field then appear in one card',()=>{
  assert.match(importView,/useState\(embedded \? '' : 'catalog'\)/);
  assert.match(importView,/\(!embedded \|\| mode\) && <div className="import-center-layout">/);
  assert.match(importView,/>Produtos e anúncios<\/strong>/);
  assert.match(importView,/>Vendas<\/strong>/);
  assert.match(importView,/CATALOG_PLATFORMS\.map/);
  assert.match(importView,/SALES_PLATFORMS\.map/);
  assert.match(importView,/catalogPlatform === 'MERCADO_LIVRE'/);
  assert.match(importView,/disabled=\{catalogReading \|\| catalogImporting \|\| \(catalogPlatform === 'MERCADO_LIVRE' && !catalogAccount\)\}/);
  assert.match(importView,/FileDrop/);
  assert.match(importView,/readCommerceXlsx\(file, catalogPlatform/);
  assert.match(importView,/readCommerceSalesXlsx\(file, salesPlatform, salesMonth\)/);
});

test('existing catalog staging, conflict review, decisions, status sync and history remain functional in same view',()=>{
  assert.match(importView,/stageCommerceWorkbook\(catalogParsed, setCatalogProgress\)/);
  assert.match(importView,/CatalogBatchReview/);
  assert.match(importView,/onYearDecision=\{handleCatalogYearDecision\}/);
  assert.match(importView,/onCommit=\{handleCatalogCommit\}/);
  assert.match(importView,/onSyncStatuses=\{handleCatalogStatusSync\}/);
  assert.match(importView,/onRetryReconcile=\{handleCatalogRetryReconcile\}/);
  assert.match(importView,/import-center-history-toggle/);
  assert.match(importView,/showHistory \? 'Ocultar histórico e resumo'/);
  assert.match(importView,/refreshCatalogHistory/);
  assert.match(importView,/refreshSalesHistory/);
  assert.match(importView,/onCatalogChanged\?\.\(\)/);
  assert.match(importView,/onSalesChanged\?\.\(\)/);
  assert.match(styles,/\.import-center-embedded/);
  assert.match(styles,/@media\(max-width:780px\)/);
});

test('sales formats are not falsely advertised as supported; account distinction is maintained',()=>{
  for (const code of ["['SHOPEE', 'Shopee']","['ML_NOVO', 'Mercado Livre Novo']","['ML_ANTIGO', 'Mercado Livre Antigo']"]) {
    assert.ok(importView.includes(code),code);
  }
  assert.match(importView,/PENDING_SALES_PLATFORMS/);
  assert.match(importView,/AMAZON', 'Amazon — aguardando modelo de relatório/);
  assert.match(importView,/TIKTOK', 'TikTok Shop — aguardando modelo de relatório/);
  assert.match(importView,/key=\{value\} value=\{value\} disabled/);
  assert.match(importView,/O arquivo de produtos será validado pelo leitor do catálogo/);
  assert.match(importView,/setCatalogAccount\(event\.target\.value\)/);
  assert.match(importView,/setSalesPlatform\(event\.target\.value\)/);
});

test('catalog upload and sales upload are distinct and only activate after preview validation',()=>{
  assert.match(importView,/disabled=\{!catalogParsed \|\| catalogReading \|\| catalogImporting\}/);
  assert.match(importView,/disabled=\{!salesParsed \|\| salesReading \|\| salesImporting\}/);
  assert.match(importView,/stageCommerceSalesWorkbook\(salesParsed, setSalesProgress\)/);
  assert.match(importView,/if \(outcome\.status === 'WAITING_PARTS'\)/);
  assert.match(importView,/Conferência antes de enviar/);
  assert.match(importView,/onClick=\{handleCatalogImport\}/);
  assert.match(importView,/onClick=\{handleSalesImport\}/);
});
