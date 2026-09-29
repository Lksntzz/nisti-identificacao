import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/gtin-router.js', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const coreRouter = fs.readFileSync(new URL('../src/core-router.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0017_gtin_scan_events.sql', import.meta.url), 'utf8');
const gtinRegistry = fs.readFileSync(new URL('../src/admin/GtinRegistryView.jsx', import.meta.url), 'utf8');
const gtinEvents = fs.readFileSync(new URL('../src/admin/GtinEventsView.jsx', import.meta.url), 'utf8');
const barcodeGen = fs.readFileSync(new URL('../src/admin/BarcodeGeneratorView.jsx', import.meta.url), 'utf8');
const expeditionDashboard = fs.readFileSync(new URL('../src/admin/ExpeditionDashboard.jsx', import.meta.url), 'utf8');
const productsWithoutGtinView = fs.readFileSync(new URL('../src/admin/ProductsWithoutGtinView.jsx', import.meta.url), 'utf8');
const catalogView = fs.readFileSync(new URL('../src/admin/CatalogView.jsx', import.meta.url), 'utf8');

test('EAN admin mantém gerador, histórico e operações sem a tela duplicada de Códigos EAN', () => {
  assert.match(gtinEvents + main, /function GtinEventsView/);
  assert.match(main, /ProductGtinManager/);
  assert.match(main, /activeView === 'gerador-barras'/);
  assert.match(main, /activeView === 'historico-ean'/);
  assert.match(main, /activeView === 'ean-nao-cadastrados'/);
  assert.doesNotMatch(main, /activeView === 'gtins'/);
  assert.doesNotMatch(main, /GtinRegistryView/);
});

test('scanner records central EAN events for the admin history', () => {
  assert.match(scanner, /'x-operator-name'/);
  assert.match(router, /scheduleGtinScanEvent\(ctx, request, env/);
  assert.match(router, /status: 'identified'/);
  assert.match(router, /status: 'not_found'/);
  assert.match(router, /\/api\/admin\/gtin-events/);
  assert.match(router, /\/api\/admin\/gtin-dashboard/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gtin_scan_events/);
});

test('EAN history reports loading failures and offers retry', () => {
  assert.match(gtinEvents + main, /setLoadError\(error\?\.message/);
  assert.match(gtinEvents + main, /Tentar novamente/);
});

test('barcode generator exposes collection downloads without removing individual downloads', () => {
  assert.match(barcodeGen + main, /buildEanCollections/);
  assert.match(barcodeGen + main, /Baixar coleção/);
  assert.match(barcodeGen + main, /downloadCollection/);
  assert.match(barcodeGen + main, /Baixar PNG oficial/);
  assert.match(router, /p\.sku,p\.miolo_code,p\.nome/);
});

test('barcode generator presents collection download as an explicit view filter', () => {
  assert.match(barcodeGen + main, /const \[viewMode, setViewMode\]/);
  assert.match(barcodeGen + main, /Modo de download/);
  assert.match(barcodeGen + main, /Produtos individuais/);
  assert.match(barcodeGen + main, /Download por coleção/);
  assert.match(barcodeGen + main, /viewMode === 'collections'/);
});

test('new product registration writes its EAN atomically with an accepted source', () => {
  assert.match(main, /gtin: cleanGtin/);
  assert.doesNotMatch(main, /source: 'ADMIN'/);
  assert.match(coreRouter, /source='NISTI'/);
  assert.doesNotMatch(coreRouter, /source='IMPORT'/);
  assert.match(coreRouter, /upsertCatalogProduct\(env, body\)/);
});

test('manual and bulk registration immediately expose downloadable barcode labels', () => {
  assert.match(main, /function RegistrationBarcodeResult/);
  assert.match(main, /createEan13Svg\(item\)/);
  assert.match(main, /downloadBarcodePng\(item\)/);
  assert.match(main, /downloadBarcodeZip\(barcodeItems/);
  assert.match(main, /Baixar todas em ZIP/);
  assert.match(main, /setResult\(\{ items: registered, errors: failures \}\)/);
  assert.match(main, /setResult\(\{ items: importedItems, errors: importErrors, created, updated \}\)/);
});

test('admin dashboard only shows actionable EAN pending blocks', () => {
  assert.match(router, /products_without_gtin_count/);
  assert.match(router, /products_without_gtin:/);
  assert.match(router, /NOT EXISTS \([\s\S]*?product_gtins g[\s\S]*?g\.active=1/);
  assert.match(expeditionDashboard, /todayNotFound > 0 && \(/);
  assert.match(expeditionDashboard, /productsWithoutGtin > 0 && \(/);
  assert.doesNotMatch(expeditionDashboard, /Todos os produtos do catálogo possuem código EAN/);
});

test('clicking the missing EAN alert opens the affected products', () => {
  assert.match(expeditionDashboard, /onShowProductsWithoutGtin/);
  assert.match(main, /activeView === 'produtos-sem-ean'/);
  assert.match(main, /setViewProduct\(productsWithoutGtin\[0\]\)/);
  assert.match(productsWithoutGtinView, /Produtos sem EAN/);
  assert.match(productsWithoutGtinView, /onClick=\{\(\) => onSelect\?\.\(product\)\}/);
});

test('catalog missing EAN filter uses the active GTIN relationship', () => {
  assert.match(coreRouter, /AS has_active_gtin/);
  assert.match(coreRouter, /AS gtin/);
  assert.match(catalogView, /!p\.has_active_gtin/);
  assert.doesNotMatch(catalogView, /!p\.capa_code && !p\.gtin/);
  assert.match(catalogView, /Apenas sem EAN/);
});


test('cadastro manual de produto não pede plataforma nem link de anúncio', () => {
  const start = main.indexOf('function CreateProductModal');
  const end = main.indexOf('function EditProductModal');
  assert.ok(start >= 0 && end > start);
  const createModal = main.slice(start, end);

  assert.match(createModal, /Nome do Produto Pai/);
  assert.match(createModal, /Plataformas e anúncios são vinculados automaticamente pelo Catálogo Comercial/);
  assert.doesNotMatch(createModal, /Plataforma Padrão/);
  assert.doesNotMatch(createModal, /Link do Anúncio/);
  assert.doesNotMatch(createModal, /platform: platform/);
  assert.doesNotMatch(createModal, /link: link/);
});


test('taxa de sucesso abre as bipagens reais de hoje por resultado', () => {
  assert.match(expeditionDashboard, /openScanDetails/);
  assert.match(expeditionDashboard, /openScanDetails\('identified'\)/);
  assert.match(expeditionDashboard, /today: '1'/);
  assert.match(expeditionDashboard, /Ver bipagens/);
  assert.match(expeditionDashboard, /Ver quais foram/);
  assert.match(expeditionDashboard, /Ver erros/);
  assert.match(expeditionDashboard, /scan-details-modal/);
  assert.match(expeditionDashboard, /operator_name/);
  assert.match(expeditionDashboard, /event\.gtin/);
  assert.match(router, /date\(e\.created_at,'-3 hours'\)=date\('now','-3 hours'\)/);
  assert.match(main, /api=\{api\}/);
});

test('catálogo mostra plataformas sincronizadas em badges compactas', () => {
  const sync = fs.readFileSync(new URL('../src/nisti-commerce-sync.js', import.meta.url), 'utf8');
  const platformMigration = fs.readFileSync(new URL('../supabase/migrations/20260929174500_nisti_catalog_platforms_v1.sql', import.meta.url), 'utf8');

  assert.match(sync, /commerce_nisti_product_platforms_v1/);
  assert.match(sync, /platformsByProduct/);
  assert.match(catalogView, /CatalogPlatformTags/);
  assert.match(catalogView, /catalogPlatforms\(product\)/);
  assert.match(catalogView, /catalog-platform-more/);
  assert.match(catalogView, /Sem anúncio no catálogo/);
  assert.match(platformMigration, /ML_NOVO/);
  assert.match(platformMigration, /ML_ANTIGO/);
  assert.match(platformMigration, /LOJA_INTEGRADA/);
  assert.match(platformMigration, /matched_product_id/);
});


test('plataformas do NISTI exigem evidência real de anúncio e preferem a fonte Gestão', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260929180000_nisti_catalog_platforms_real_presence_v2.sql', import.meta.url), 'utf8');

  assert.match(migration, /listing_url/);
  assert.match(migration, /listing_ref/);
  assert.match(migration, /external_listing_id/);
  assert.match(migration, /source_priority/);
  assert.match(migration, /%_GESTAO/);
  assert.match(migration, /preferred_files/);
});


test('histórico de bipagens usa paginação real no backend e na interface', () => {
  assert.match(router, /const offset = Math\.max\(0/);
  assert.match(router, /SELECT COUNT\(\*\) AS total/);
  assert.match(router, /LIMIT \? OFFSET \?/);
  assert.match(router, /total: Number\(countRow\?\.total/);
  assert.match(gtinEvents, /HISTORY_PAGE_SIZE = 10/);
  assert.match(gtinEvents, /admin-pagination/);
  assert.match(gtinEvents, /Mostrando \{firstItem\}–\{lastItem\}/);
  assert.match(gtinEvents, /Anterior/);
  assert.match(gtinEvents, /Próxima/);
});

test('gerador de barras pagina produtos e coleções sem perder seleção', () => {
  assert.match(barcodeGen, /BARCODE_PRODUCT_PAGE_SIZE = 10/);
  assert.match(barcodeGen, /BARCODE_COLLECTION_PAGE_SIZE = 12/);
  assert.match(barcodeGen, /pagedRows/);
  assert.match(barcodeGen, /pagedCollections/);
  assert.match(barcodeGen, /admin-pagination barcode-pagination/);
  assert.match(barcodeGen, /Selecionar exibidos/);
  assert.match(barcodeGen, /productTotalPages/);
  assert.match(barcodeGen, /collectionTotalPages/);
});
