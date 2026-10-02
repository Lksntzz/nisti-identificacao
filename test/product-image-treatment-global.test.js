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
  assert.ok(utility.includes('outlineScale:5 / 1024'));
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

test('tassel treatment keeps strong detached details and removes neutral artifacts', () => {
  const { buildProductComponentsMask } = __muralTransparentImageInternals;
  const width = 40;
  const height = 30;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const paint = (x0,y0,x1,y1,[r,g,b]) => {
    for (let y=y0;y<=y1;y+=1) {
      for (let x=x0;x<=x1;x+=1) {
        const offset=(y*width+x)*4;
        pixels[offset]=r;
        pixels[offset+1]=g;
        pixels[offset+2]=b;
        pixels[offset+3]=255;
      }
    }
  };

  // Main planner body.
  paint(10,5,24,24,[190,170,150]);
  // Detached green tassel close to the binding: strong chromatic evidence.
  paint(5,10,7,17,[90,190,120]);
  // Equally sized neutral export/background fragment on the other side.
  paint(27,10,29,17,[242,242,242]);

  const mask=buildProductComponentsMask(pixels,width,height);
  assert.ok(mask);
  assert.equal(mask[12*width+6],1,'colored tassel must be preserved');
  assert.equal(mask[12*width+28],0,'neutral detached artifact must be removed');

  const utility = read('src/mural-transparent-image.js');
  assert.ok(utility.includes('genericDetailStrongRatio:.30'));
  assert.doesNotMatch(utility, /requestedOfficialVariant === 'withTassel'[\s\S]{0,120}buildOpaqueMask/);
});

test('mask calibration preserves pale nearby accessory evidence but rejects neutral debris', () => {
  const { buildProductComponentsMask } = __muralTransparentImageInternals;
  const width=50;
  const height=36;
  const pixels=new Uint8ClampedArray(width*height*4);
  const paint=(x0,y0,x1,y1,r,g,b)=>{
    for(let y=y0;y<=y1;y+=1) for(let x=x0;x<=x1;x+=1){
      const o=(y*width+x)*4; pixels[o]=r; pixels[o+1]=g; pixels[o+2]=b; pixels[o+3]=255;
    }
  };
  paint(14,5,34,30,195,175,155);
  // Pale tassel: one chromatic strip connected to mostly light fibres => 20% strong evidence.
  paint(8,13,12,22,236,236,236);
  paint(8,13,8,22,170,205,180);
  // Neutral artifact with the same dimensions on the opposite side.
  paint(36,13,40,22,240,240,240);
  const plannerBounds={minX:14,maxX:34,minY:5,maxY:30,width:20,height:25};
  const mask=buildProductComponentsMask(pixels,width,height,{plannerBounds});
  assert.ok(mask);
  assert.equal(mask[17*width+9],1,'pale nearby tassel fibres must survive');
  assert.equal(mask[17*width+38],0,'neutral detached residue must be rejected');
});

test('calibrated planner geometry rejects implausible wide cutouts', () => {
  const { plannerMaskGeometryIsSafe } = __muralTransparentImageInternals;
  const width=100;
  const height=100;
  const valid=new Uint8Array(width*height);
  for(let y=5;y<95;y+=1) for(let x=18;x<84;x+=1) valid[y*width+x]=1;
  assert.equal(plannerMaskGeometryIsSafe(valid,width,height),true);
  const tooWide=new Uint8Array(width*height);
  for(let y=20;y<70;y+=1) for(let x=5;x<95;x+=1) tooWide[y*width+x]=1;
  assert.equal(plannerMaskGeometryIsSafe(tooWide,width,height),false);
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

test('admin mounts the treatment worker but processing only starts by explicit control', () => {
  const main = read('src/main.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');

  assert.ok(main.includes('ProductImageTreatmentWorker'));
  assert.equal(main.includes('TREATMENT_WAKE_EVENT'), false);
  assert.ok(worker.includes('/api/admin/product-image-treatment/pending'));
  assert.ok(worker.includes("Deliberately do not run on mount"));
  assert.equal(worker.includes('const timer = window.setTimeout(run, 900)'), false);
  assert.ok(worker.includes('productImageTreatmentArtifactsBlob'));
  assert.ok(worker.includes('tasselCode:item.tassel_code'));
  assert.ok(worker.includes('wireoCode:item.wireo_code'));
  assert.equal(worker.includes('requireMkpMask'), false);
  assert.equal(worker.includes('/ai'), false);
  assert.ok(worker.includes('nisti_product_image_treatment_lock_v${PRODUCT_IMAGE_PROCESSOR_VERSION}'));
  assert.ok(worker.includes("cache:'no-store'"));
  assert.ok(worker.includes("form.append('image'"));
  assert.ok(worker.includes("form.append('mask'"));
  assert.ok(worker.includes('/api/admin/product-image-mask/pending'));
  assert.ok(worker.includes('processMaskItem'));
  assert.ok(worker.includes('/failed'));
});

test('stale browser clients cannot persist or approve a pre-v18 cutout', () => {
  const worker = read('src/product-image-treatment-worker.jsx');
  const core = read('src/core-router.js');
  const version = read('src/product-image-processor-version.js');
  assert.ok(version.includes("PRODUCT_IMAGE_PROCESSOR_VERSION = '18'"));
  assert.ok(worker.includes("import { PRODUCT_IMAGE_PROCESSOR_VERSION } from './product-image-processor-version.js'"));
  assert.equal((worker.match(/form\.append\('processor_version', PRODUCT_IMAGE_PROCESSOR_VERSION\)/g) || []).length, 2);
  assert.equal((core.match(/code:'stale_image_processor'/g) || []).length, 2);
  assert.ok(core.includes('clientProcessorVersion !== PRODUCT_IMAGE_PROCESSOR_VERSION'));
});

test('original product image upload is independent from the Mural processor version', () => {
  const main = read('src/main.jsx');
  const core = read('src/core-router.js');
  const start = core.indexOf("const imageUpload = url.pathname.match(/^\\/api\\/products\\/(\\d+)\\/image$/);");
  const end = core.indexOf("const imageGet = url.pathname.match", start);
  const originalUpload = core.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(originalUpload.includes("const file = form.get('image')"));
  assert.equal(originalUpload.includes('clientProcessorVersion'), false);
  assert.equal(originalUpload.includes('stale_image_processor'), false);
  assert.equal(main.includes("fd.append('processor_version', PRODUCT_IMAGE_PROCESSOR_VERSION)"), false);
  assert.equal(main.includes("import { PRODUCT_IMAGE_PROCESSOR_VERSION }"), false);
});

test('each product treatment persists an individual auditable mask', () => {
  const utility = read('src/mural-transparent-image.js');
  const worker = read('src/product-image-treatment-worker.jsx');
  const core = read('src/core-router.js');
  const migration = read('supabase/migrations/20261002162500_persistent_product_masks_v1.sql');

  assert.ok(utility.includes('productMaskPngBlob'));
  assert.ok(utility.includes('productImageTreatmentArtifactsBlob'));
  assert.ok(utility.includes('productImageMaskBlob'));
  assert.ok(utility.includes("maskOnly:true"));
  assert.ok(worker.includes("form.append('mask'"));
  assert.ok(core.includes('masks/products/'));
  assert.ok(core.includes('nisti_set_product_treatment_v2'));
  assert.ok(core.includes('nisti_set_product_mask_v1'));
  assert.ok(core.includes('/api/admin/product-image-treatment/'));
  assert.ok(core.includes('/mask'));
  assert.match(migration,/ADD COLUMN IF NOT EXISTS mask_image_key text/);
  assert.match(migration,/mask_processor_version text/);
  assert.match(migration,/nisti_product_mask_queue_v1/);
  assert.match(migration,/old_mask_image_key/);
});

test('mask backfill is visible and cannot destroy treatment review state', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');
  const core = read('src/core-router.js');

  assert.ok(core.includes('mask_ready:Math.max(0,withImage-maskPending)'));
  assert.ok(core.includes('mask_pending:maskPending'));
  assert.ok(admin.includes('Máscaras individuais:'));
  assert.ok(admin.includes('máscaras salvas'));
  assert.match(worker,/if \(!maskBackfill\) \{[\s\S]*await markFailed\(item\.id, error\.message\)/);
});

test('Mural admin shows live treatment totals and the current SKU', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');
  const css = read('src/mural-admin.css');
  const core = read('src/core-router.js');
  const summarySql = read('supabase/migrations/20261001223000_product_treatment_admin_reads_v1.sql');

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
  assert.ok(core.includes('supabaseProductTreatmentSummary'));
  assert.ok(summarySql.includes("'failed', COUNT(*) FILTER (WHERE is_failed)"));
});


test('display endpoint is server-authoritative and only serves current approved derivatives', () => {
  const publicImages = read('src/public-image-router.js');
  const utility = read('src/mural-transparent-image.js');
  const core = read('src/core-router.js');
  const queueSql = read('supabase/migrations/20261002173000_mkp_treatment_queue_wireo_v1.sql');

  assert.ok(publicImages.includes("'x-nisti-image-source':'treated'"));
  assert.ok(publicImages.includes("'x-nisti-image-source':'original'"));
  const hook = utility.slice(utility.indexOf('export function useTreatedProductImage'), utility.indexOf('export const __muralTransparentImageInternals'));
  assert.ok(hook.includes('Display is server-authoritative'));
  assert.equal(hook.includes('treatedProductImageUrl('), false);
  const version = read('src/product-image-processor-version.js');
  assert.ok(version.includes("PRODUCT_IMAGE_PROCESSOR_VERSION = '18'"));
  assert.ok(core.includes("import { PRODUCT_IMAGE_PROCESSOR_VERSION } from './product-image-processor-version.js'"));
  assert.ok(core.includes('supabaseProductTreatmentQueue'));
  assert.ok(core.includes("wireo_code:row.wireo_code || ''"));
  assert.ok(queueSql.includes("queue_status IN ('pending','stale')"));
  assert.ok(queueSql.includes("COALESCE(mpi.processor_version,'')<>(SELECT current_version FROM params)"));
  assert.equal(queueSql.includes("queue_status IN ('pending','review','stale')"), false);
  assert.ok(queueSql.includes('p.wireo_code'));
  assert.ok(queueSql.includes("'wireo_code',COALESCE(wireo_code,''"));
  assert.ok(publicImages.includes("import { PRODUCT_IMAGE_PROCESSOR_VERSION } from './product-image-processor-version.js'"));
  assert.equal(publicImages.includes("const PRODUCT_IMAGE_PROCESSOR_VERSION = '18'"), false);
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
  assert.ok(worker.includes('preciseOutline:Boolean(item.force_outline)'));
  assert.ok(admin.includes('>Iniciar tratamento</button>'));
  assert.ok(admin.includes('>Pausar tratamento</button>'));
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
  assert.ok(core.includes("p_action:'review'"));
  assert.ok(core.includes("p_action:'approve'"));
  assert.ok(core.includes("p_action:'redo'"));
  assert.ok(core.includes("force_outline:row.processor === 'system-precise-redo'"));
  assert.ok(utility.includes("cache:options.forceOutline ? 'no-store' : 'default'"));
  assert.ok(utility.includes('outlineScale:5 / 1024'));
  assert.ok(utility.includes('preciseOutlineScale:5 / 1024'));
  assert.ok(utility.includes('bboxAspectMedian:.737'));
  assert.ok(utility.includes('bboxAspectObservedMin:.682'));
  assert.ok(utility.includes('bboxAspectObservedMax:.766'));
  assert.ok(utility.includes('plannerMaskGeometryIsSafe'));
  assert.ok(utility.includes('nearbyDetailStrongRatio:.18'));
  assert.ok(utility.includes('genericDetailStrongRatio:.30'))
  assert.ok(utility.includes('sourceAlreadyCutOut && !options.forceOutline'));
  assert.ok(utility.includes('buildGeometryProtection('));
  assert.ok(utility.includes('const fitScale = Math.min(width * .995 / boxWidth, height * .995 / boxHeight)'));
  assert.ok(utility.includes('genericDetailStrongRatio:.30'));
  assert.ok(utility.includes('estimateBorderBackgroundBrightness(data, width, height)'));
  assert.ok(utility.includes('removeConnectedStudioBackground(data, width, height, structureProtection)'));
  assert.equal(utility.includes('applyOfficialProductMask'), false);
});


test('Mural review opens a large preview and exposes approve and precise-redo actions', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const css = read('src/mural-admin.css');
  assert.match(admin, /mural-product-image-lightbox/);
  assert.match(admin, /Aprovar e mover para Revisados/);
  assert.match(admin, /Refazer com corte preciso/);
  assert.match(admin, /setJustApprovedIds/);
  assert.match(css, /\.mural-product-image-lightbox-canvas/);
  assert.match(css, /max-height:70vh/);
});


test('manual image treatment stays idle until the admin explicitly starts it', () => {
  const worker = read('src/product-image-treatment-worker.jsx');
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const main = read('src/main.jsx');
  const core = read('src/core-router.js');

  assert.equal(worker.includes('IDLE_POLL_MS'), false);
  assert.equal(worker.includes('TREATMENT_WAKE_EVENT'), false);
  assert.equal(main.includes('TREATMENT_WAKE_EVENT'), false);
  assert.ok(worker.includes("return localStorage.getItem(TREATMENT_PAUSE_KEY) !== '0'"));
  assert.ok(worker.includes("window.addEventListener(TREATMENT_CONTROL_EVENT, onControl)"));
  assert.ok(worker.includes("emitTreatmentProgress({ phase:'paused', manual:true })"));
  assert.equal(admin.includes('window.setInterval(refreshProgress,1500)'), false);
  assert.ok(admin.includes('Tratamento manual'));
  assert.ok(admin.includes('Aguardando início manual'));
  assert.ok(core.includes("url.pathname === '/api/admin/product-image-treatment/summary'"));
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
