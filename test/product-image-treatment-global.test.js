import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __muralTransparentImageInternals } from '../src/mural-transparent-image.js';

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
  assert.ok(utility.includes('brightness >= minimumBrightness && chroma <= 26'));
  assert.ok(utility.includes('productStats.ratio < .055'));
  assert.ok(utility.includes('productWidth < width * .25'));
  assert.ok(utility.includes('productHeight < height * .25'));
  assert.ok(utility.includes('return src'));
});

test('neutral studio shadows are removable without classifying them as product detail', () => {
  const {
    estimateBorderBackgroundBrightness,
    isBorderBackgroundCandidate,
    isStrongForegroundPixel
  } = __muralTransparentImageInternals;
  const width = 5;
  const height = 5;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(250);
  for (let index = 0; index < width * height; index += 1) pixels[index * 4 + 3] = 255;

  const threshold = estimateBorderBackgroundBrightness(pixels, width, height);
  assert.equal(threshold, 212);
  assert.equal(isBorderBackgroundCandidate(220, 218, 219, 255, threshold), true);
  assert.equal(isStrongForegroundPixel(210, 210, 210, 255), false);
  assert.equal(isStrongForegroundPixel(150, 35, 65, 255), true);
  assert.equal(isStrongForegroundPixel(30, 30, 30, 255), true);
});

test('official tassel treatment preserves disconnected opaque components', () => {
  const { buildOpaqueMask } = __muralTransparentImageInternals;
  const pixels = new Uint8ClampedArray(4 * 2 * 4);
  pixels[3] = 255;
  pixels[(7 * 4) + 3] = 255;
  assert.deepEqual([...buildOpaqueMask(pixels, 4, 2)], [1, 0, 0, 0, 0, 0, 0, 1]);

  const utility = read('src/mural-transparent-image.js');
  assert.match(utility, /requestedOfficialVariant === 'withTassel'[\s\S]*buildOpaqueMask/);
  assert.doesNotMatch(utility, /if \(official\) \{[\s\S]{0,500}applyPlannerStructureMask/);
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

test('contour v9 requeues generated derivatives but preserves approved manual PNGs', () => {
  const d1 = read('migrations/0023_mural_product_images_contour_v9.sql');
  const supabase = read('supabase/migrations/20261002093000_requeue_product_treatment_contour_v9.sql');
  for (const migration of [d1, supabase]) {
    assert.match(migration, /status = 'pending'/);
    assert.match(migration, /processor = 'admin-upload'/);
    assert.match(migration, /reviewed_by = 'admin'/);
  }
});

test('admin starts a background queue that persists safe treated PNGs', () => {
  const main = read('src/main.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');

  assert.ok(main.includes('ProductImageTreatmentWorker'));
  assert.ok(worker.includes('/api/admin/product-image-treatment/pending'));
  assert.ok(worker.includes('treatedProductImageBlob'));
  assert.ok(worker.includes('tasselCode:item.tassel_code'));
  assert.ok(worker.includes("LOCK_KEY = 'nisti_product_image_treatment_lock_v8'"));
  assert.ok(worker.includes("cache:'no-store'"));
  assert.ok(worker.includes("form.append('image'"));
  assert.ok(worker.includes('/failed'));
});

test('Mural admin shows live treatment totals and the current SKU', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');
  const css = read('src/mural-admin.css');
  const core = read('src/core-router.js');

  assert.ok(admin.includes("nisti:product-image-treatment-progress"));
  assert.ok(admin.includes("/api/admin/product-image-treatment/summary"));
  assert.ok(admin.includes('role="progressbar"'));
  assert.ok(admin.includes('Tratando agora:'));
  assert.ok(admin.includes('const onChangedRef=useRef(onChanged)'));
  assert.ok(admin.includes("if(['processed','failed'].includes(detail.phase))"));
  assert.ok(admin.includes('Promise.resolve(onChangedRef.current?.())'));
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
  assert.ok(core.includes("PRODUCT_IMAGE_PROCESSOR_VERSION = '9'"));
  assert.ok(core.includes("OR mpi.status IN ('pending','stale')"));
  assert.ok(core.includes("COALESCE(mpi.processor_version,'')<>?"));
  assert.equal(core.includes("mpi.status IN ('pending','review','stale')"), false);
  assert.ok(core.includes('p.id,p.sku,p.nome,p.image_key,p.tassel_code'));
  assert.ok(publicImages.includes("const PRODUCT_IMAGE_PROCESSOR_VERSION = '9'"));
  assert.ok(publicImages.includes("row.status === 'approved'"));
  assert.equal(publicImages.includes("row.processor === 'admin-upload'"), false);
  assert.ok(publicImages.includes("row.reviewed_by === 'admin'"));
  assert.ok(core.includes("product.treated_image_reviewed_by === 'admin'"));
});

test('treatment queue cannot be blocked forever by one failed or oversized image', () => {
  const worker = read('src/product-image-treatment-worker.jsx');
  const utility = read('src/mural-transparent-image.js');
  const core = read('src/core-router.js');

  assert.ok(utility.includes('const MAX_RENDER_DIMENSION = 1280'));
  assert.ok(utility.includes("URL.revokeObjectURL(cutoutSrc)"));
  assert.ok(worker.includes('MAX_TRANSIENT_ATTEMPTS = 3'));
  assert.ok(worker.includes('attempts >= MAX_TRANSIENT_ATTEMPTS'));
  assert.equal(core.includes('OR mpi.processed_image_key IS NULL\n              OR mpi.status'), false);
});

test('treatment supports pause, review, approval and explicit precise redo', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');
  const utility = read('src/mural-transparent-image.js');
  const core = read('src/core-router.js');

  assert.ok(worker.includes('TREATMENT_PAUSE_KEY'));
  assert.ok(worker.includes("status:'review'"));
  assert.ok(worker.includes('forceOutline:Boolean(item.force_outline)'));
  assert.ok(admin.includes('>Iniciar tratamento</button>'));
  assert.ok(admin.includes('>Pausar tratamentos</button>'));
  assert.ok(admin.includes('Aguardando aprovação'));
  assert.ok(admin.includes('>Para revisar</button>'));
  assert.ok(admin.includes('>Revisados</button>'));
  assert.ok(admin.includes('?products.filter(item=>item.mural_image_ready)'));
  assert.ok(admin.includes('!justApprovedIds.has(Number(item.id))'));
  assert.ok(admin.includes('setJustApprovedIds(current=>new Set(current).add(Number(product.id)))'));
  assert.ok(admin.includes("cache: 'no-store'"));
  assert.ok(admin.includes('Aprovada e salva'));
  assert.ok(admin.includes('/approve'));
  assert.ok(admin.includes('/redo'));
  assert.ok(core.includes("status='review'"));
  assert.ok(core.includes("status='approved',reviewed_by='admin'"));
  assert.ok(core.includes("processor='system-precise-redo'"));
  assert.ok(core.includes("force_outline:row.processor === 'system-precise-redo'"));
  assert.ok(utility.includes("cache:options.forceOutline ? 'no-store' : 'default'"));
  assert.ok(utility.includes('options.forceOutline ? 5 / 1024 : 8 / 1024'));
  assert.ok(utility.includes('sourceAlreadyCutOut && !options.forceOutline'));
  assert.ok(utility.includes('requestedOfficialVariant && !options.forceOutline'));
  assert.ok(utility.includes('buildPlannerStructureProtection(data, width, height, options.forceOutline)'));
  assert.ok(utility.includes('const fitScale = Math.min(width * .995 / boxWidth, height * .995 / boxHeight)'));
  assert.ok(utility.includes('fillMaskInteriorHoles(dilateMask(mask, width, height, radius))'));
  assert.ok(utility.includes("requestedOfficialVariant === 'withTassel'\n    ? buildOpaqueMask"));
  assert.ok(utility.includes('if (requestedOfficialVariant && !options.forceOutline) {\n    const official = await buildOfficialProductMask'));
  assert.ok(utility.includes("requestedOfficialVariant === 'withTassel'"));
  assert.ok(utility.includes('estimateBorderBackgroundBrightness(data, width, height)'));
  assert.ok(utility.includes('if (validOfficialCut)'));
  assert.ok(utility.includes('data.set(originalPixels)'));
  assert.equal((utility.match(/if \(requestedOfficialVariant && !options\.forceOutline\)/g) || []).length, 1);
});

test('Mural review opens a large preview and exposes approve and precise-redo actions', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const css = read('src/mural-admin.css');
  assert.match(admin, /mural-product-image-lightbox/);
  assert.match(admin, /createPortal/);
  assert.match(admin, /mural-product-image-lightbox-dialog/);
  assert.match(admin, /Não foi possível abrir a imagem tratada/);
  assert.match(admin, /closeOnEscape/);
  assert.match(admin, /Aprovar e mover para Revisados/);
  assert.match(admin, /Refazer com corte preciso/);
  assert.match(admin, /setJustApprovedIds/);
  assert.match(css, /\.mural-product-image-lightbox-canvas/);
  assert.match(css, /\.mural-product-image-lightbox-dialog/);
  assert.match(css, /\.mural-product-image-lightbox-error/);
  assert.match(css, /max-height:70vh/);
});


test('automatic image treatment does not poll D1 aggressively while idle', () => {
  const worker = read('src/product-image-treatment-worker.jsx');
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const core = read('src/core-router.js');

  assert.ok(worker.includes('IDLE_POLL_MS = 15 * 60 * 1000'));
  assert.ok(worker.includes('TREATMENT_WAKE_EVENT'));
  assert.equal(worker.includes('window.setTimeout(run, 30000)'), false);
  assert.equal(admin.includes('window.setInterval(refreshProgress,1500)'), false);
  assert.ok(admin.includes('/api/admin/product-image-treatment/summary'));
  assert.ok(core.includes("url.pathname === '/api/admin/product-image-treatment/summary'"));
  assert.equal(core.includes('summary:await productTreatmentSummary(env),\n          items:'), false);
});

test('image treatment retries after another admin tab owns the processing lock', () => {
  const worker = read('src/product-image-treatment-worker.jsx');
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const adminCss = read('src/mural-admin.css');

  assert.match(worker, /const LOCK_RETRY_MS = 5 \* 1000/);
  assert.match(worker, /if \(!acquireLock\(owner\)\) \{[\s\S]*phase:'waiting'[\s\S]*setTimeout\(run, LOCK_RETRY_MS\)/);
  assert.match(admin, /A fila está sendo processada em outra aba/);
  assert.match(admin, /state==='failed'\?'Tentar novamente':'Refazer'/);
  assert.match(adminCss, /\.mural-product-treatment-progress\.waiting/);
});
