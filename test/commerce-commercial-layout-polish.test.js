import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(name,'utf8');
const ui = read('src/commerce-import-center.jsx');
const css = read('src/commerce-import-center.css');
const dashboardCss = read('src/commerce-commercial-dashboard.css');
const velocityCss = read('src/commerce-sales-velocity.css');
const abcCss = read('src/commerce-abc-ad-performance.css');
const client = read('src/commerce-import-client.js');
const salesSchema = read('supabase/migrations/20260928205021_commerce_sales_import_pipeline_v1.sql');
const listingSchema = read('supabase/migrations/20261016050000_commerce_sales_listing_daily_v1.sql');

test('import file shows abbreviated filename, size and real remove control; reselecting same file works',()=>{
  assert.match(ui,/file\.name\.length > 44/);
  assert.match(ui,/file\.name\.slice\(0, 27\)/);
  assert.match(ui,/file\.name\.slice\(-14\)/);
  assert.match(ui,/title=\{file\?\.name \|\| 'Selecionar planilha'\}/);
  assert.match(ui,/file\.size \/ 1024 \/ 1024/);
  assert.match(ui,/onClick=\{onClear\}>Remover arquivo/);
  assert.match(ui,/event\.target\.value = ''/);
  assert.match(ui,/setCatalogFile\(null\);setCatalogParsed\(null\)/);
  assert.match(ui,/setSalesFile\(null\);setSalesParsed\(null\)/);
  assert.match(css,/\.import-center-filename/);
  assert.match(css,/text-overflow:ellipsis/);
});

test('visual hierarchy uses full-width verification and submission cards, while keeping desktop layout',()=>{
  assert.match(ui,/className="import-center-step-review"/);
  assert.match(ui,/className="import-center-step-submit"/);
  assert.match(css,/\.import-center-embedded \.import-center-step-review,.import-center-embedded \.import-center-step-submit\{grid-column:1 \/ -1/);
  assert.match(css,/\.import-center-embedded \.import-center-preview\{grid-template-columns:repeat\(4/);
  assert.match(css,/\.import-center-embedded \.import-center-step>.import-center-step-index\{display:grid/);
  assert.match(css,/\.import-center-embedded \.import-center-action-line\{grid-template-columns:/);
  assert.match(dashboardCss,/\.nisti-com-abc-card\{min-height:170px/);
  assert.match(dashboardCss,/\.nisti-com-metric\{min-height:123px/);
  assert.match(velocityCss,/\.nisti-vl-metric\{min-height:135px/);
  assert.match(abcCss,/\.nisti-abc-ad-product\{border-radius:12px/);
  assert.match(css,/\.import-center-embedded \.import-center-mode-grid>button\.active/);
});

test('sales validation details are compact, expandable, and do not hide source warnings',()=>{
  assert.match(ui,/import-center-validation-head/);
  assert.match(ui,/<details className="import-center-validation-details">/);
  assert.match(ui,/Ver critérios de validação/);
  assert.match(ui,/s\.source_warning && <p className="import-center-validation-warning"/);
  assert.match(ui,/Resumos de pacotes, cancelamentos e reembolsos não são somados duas vezes/);
});

test('alerts are dismissible, retain server error and never report 100% on failed sales import',()=>{
  assert.match(ui,/className="import-center-alert error" role="alert"/);
  assert.match(ui,/onClick=\{\(\) => setError\(''\)\}>Fechar/);
  assert.match(ui,/role="status"/);
  assert.match(ui,/setSalesProgress\(current => current \? \{\.\.\.current, phase: 'failed'\}/);
  assert.match(ui,/if \(progress\?\.phase === 'failed'\) percent = 0/);
  assert.match(ui,/failed: 'Importação interrompida/);
  assert.match(ui,/err\?\.status === 429/);
  assert.match(css,/\.import-center-alert-dismiss/);
});

test('rate limit retry only on idempotent staging requests, never commits or batch creation',()=>{
  assert.match(client,/retryRateLimit = false/);
  assert.match(client,/response\.status === 429 && attempt < maxRetries/);
  assert.match(client,/response\.headers\.get\('retry-after'\)/);
  assert.match(client,/await wait\(delay\)/);
  assert.equal((client.match(/retryRateLimit: true/g)||[]).length,4);
  for (const fragment of ['/rows','/summary','/listing-daily'])
    assert.ok(client.includes(fragment),fragment);
  assert.match(salesSchema,/on conflict\(batch_id,source_row_number\) do update set/);
  assert.match(salesSchema,/on conflict\(batch_id,period_key\) do update set/);
  assert.match(listingSchema,/on conflict\(batch_id,sale_date,external_listing_id,sku_norm\) do update set/);
  const commitBlock = client.slice(client.indexOf("onProgress({ phase: 'commit', completed, total: rows.length, batchId });"));
  assert.doesNotMatch(commitBlock.slice(0,260),/retryRateLimit: true/);
});
