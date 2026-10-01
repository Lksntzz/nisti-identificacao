import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('shared product component uses the final treated PNG pipeline', () => {
  const component = read('src/product-cutout-image.jsx');
  const utility = read('src/mural-transparent-image.js');
  assert.ok(component.includes('useTreatedProductImage'));
  assert.ok(component.includes('decoding="async"'));
  assert.ok(utility.includes('export async function treatedProductImageUrl'));
  assert.ok(utility.includes('export async function treatedProductImageBlob'));
  assert.ok(utility.includes('export function useTreatedProductImage'));
  assert.ok(utility.includes('8 / 1024'));
});

test('white and off-white covers use conservative background detection and corruption guards', () => {
  const utility = read('src/mural-transparent-image.js');
  assert.ok(utility.includes('brightness >= 242 && chroma <= 18'));
  assert.ok(utility.includes('productStats.ratio < .055'));
  assert.ok(utility.includes('productWidth < width * .25'));
  assert.ok(utility.includes('productHeight < height * .25'));
  assert.ok(utility.includes('return src'));
});

test('core product screens use the shared treatment', () => {
  const files = [
    'src/main.jsx',
    'src/admin/CatalogView.jsx',
    'src/admin/BarcodeGeneratorView.jsx',
    'src/admin/ExpeditionDashboard.jsx',
    'src/admin/ProductsWithoutGtinView.jsx',
    'src/commerce-catalog-workspace.jsx',
    'src/commerce-products-view.jsx',
    'src/commerce-listings-view.jsx',
    'src/commerce-management-view.jsx',
    'src/commerce-sales-dashboard.jsx',
    'src/commerce-sales-product-performance.jsx',
    'src/commerce-shopee-snapshot-view.jsx',
    'src/gtin-scanner-overlay.jsx',
    'src/public-main.jsx'
  ];
  for (const path of files) {
    assert.ok(read(path).includes('ProductCutoutImage'), path);
  }
});

test('Mural product rendering uses the same treated image pipeline', () => {
  const mural = read('src/mural-nisti.jsx');
  const experience = read('src/mural-product-experience.jsx');
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  assert.ok(mural.includes('useTreatedProductImage'));
  assert.ok(experience.includes('useTreatedProductImage'));
  assert.ok(admin.includes('useTreatedProductImage'));
});


test('database keeps original image and exposes persisted treated derivative as display image', () => {
  const core = read('src/core-router.js');
  const publicImages = read('src/public-image-router.js');
  const component = read('src/product-cutout-image.jsx');
  const migration = read('migrations/0022_product_display_images.sql');

  assert.ok(core.includes('/api/admin/product-image-treatment/pending'));
  assert.ok(core.includes('/api/admin/product-image-treatment/'));
  assert.ok(core.includes('processed/products/'));
  assert.ok(core.includes("PRODUCT_IMAGE_PROCESSOR = 'system-official-mask'"));
  assert.ok(core.includes('original_image_url'));
  assert.ok(core.includes('/api/product-images/'));

  assert.ok(publicImages.includes("entity === 'product-display'"));
  assert.ok(publicImages.includes('/api\\/product-images\\/'));
  assert.ok(component.includes("replace(/^\\/api\\/images\\/(\\d+)/, '/api/product-images/$1')"));

  assert.ok(migration.includes('trg_products_image_insert_derivative'));
  assert.ok(migration.includes('trg_products_image_update_derivative'));
  assert.ok(migration.includes('source_image_key'));
  assert.ok(migration.includes('processed_image_key'));
  assert.equal(migration.includes('UPDATE products SET image_key'), false);
});

test('admin starts a background queue that persists safe treated PNGs', () => {
  const main = read('src/main.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');

  assert.ok(main.includes('ProductImageTreatmentWorker'));
  assert.ok(worker.includes('/api/admin/product-image-treatment/pending'));
  assert.ok(worker.includes('treatedProductImageBlob'));
  assert.ok(worker.includes('tasselCode:item.tassel_code'));
  assert.ok(worker.includes("form.append('image'"));
  assert.ok(worker.includes('/failed'));
});

test('Mural admin shows live treatment totals and the current SKU', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');
  const css = read('src/mural-admin.css');
  const core = read('src/core-router.js');

  assert.ok(admin.includes("nisti:product-image-treatment-progress"));
  assert.ok(admin.includes("/api/admin/product-image-treatment/pending?limit=1"));
  assert.ok(admin.includes('role="progressbar"'));
  assert.ok(admin.includes('Tratando agora:'));
  assert.ok(worker.includes("new CustomEvent('nisti:product-image-treatment-progress'"));
  assert.ok(worker.includes("phase:'processing'"));
  assert.ok(css.includes('.mural-product-treatment-progress-track'));
  assert.ok(core.includes('failed:Number(row?.failed || 0)'));
});


test('display endpoint marks treated versus original fallback and client reprocesses only original fallback', () => {
  const publicImages = read('src/public-image-router.js');
  const utility = read('src/mural-transparent-image.js');
  const core = read('src/core-router.js');

  assert.ok(publicImages.includes("'x-nisti-image-source':'treated'"));
  assert.ok(publicImages.includes("'x-nisti-image-source':'original'"));
  assert.ok(utility.includes("method:'HEAD'"));
  assert.ok(utility.includes("response.headers.get('x-nisti-image-source')"));
  assert.ok(utility.includes("if (source === 'treated') return normalized"));
  assert.ok(utility.includes("if (source === 'original')"));
  assert.ok(utility.includes('persistedProductOriginalUrl(normalized)'));
  assert.ok(core.includes("PRODUCT_IMAGE_PROCESSOR_VERSION = '6'"));
  assert.ok(core.includes("COALESCE(mpi.processor,'') <> 'admin-upload'"));
  assert.ok(core.includes('p.id,p.sku,p.nome,p.image_key,p.tassel_code'));
  assert.ok(publicImages.includes("const PRODUCT_IMAGE_PROCESSOR_VERSION = '6'"));
  assert.ok(publicImages.includes("row.processor === 'admin-upload'"));
});
