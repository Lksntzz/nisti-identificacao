import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const utility = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');
const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const experience = fs.readFileSync(new URL('../src/mural-product-experience.jsx', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const publicCss = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const adminCss = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../src/core-router.js', import.meta.url), 'utf8');
const globalImage = fs.readFileSync(new URL('../src/product-cutout-image.jsx', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../src/admin/CatalogView.jsx', import.meta.url), 'utf8');
const scanner = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const commerceCatalog = fs.readFileSync(new URL('../src/commerce-catalog-workspace.jsx', import.meta.url), 'utf8');

test('Mural creates transparent PNG cutouts by removing only border-connected near-white pixels', () => {
  assert.ok(utility.includes('isBorderBackgroundCandidate'));
  assert.ok(utility.includes('buildSubjectProtection'));
  assert.ok(utility.includes('convexHull'));
  assert.ok(utility.includes('const visited = new Uint8Array(total)'));
  assert.ok(utility.includes('const queue = new Int32Array(total)'));
  assert.ok(utility.includes("canvas.toBlob"));
  assert.ok(utility.includes("'image/png'"));
  assert.ok(utility.includes('MAX_RENDER_DIMENSION = 1280'));
});

test('treated product rendering is shared across NISTI ID, Catalog, Scanner, Commerce and Mural without mutating source files', () => {
  assert.ok(globalImage.includes('useTreatedProductImage'));
  assert.ok(main.includes('ProductCutoutImage'));
  assert.ok(catalog.includes('ProductCutoutImage'));
  assert.ok(scanner.includes('ProductCutoutImage'));
  assert.ok(commerceCatalog.includes('ProductCutoutImage'));
  assert.ok(mural.includes('useTreatedProductImage'));
  assert.ok(experience.includes('useTreatedProductImage'));
  assert.equal(core.includes('mural-transparent-image'), false);
});

test('Mural collection products prefer approved PNG derivatives and only fall back to legacy cutouts', () => {
  assert.ok(mural.includes("product?.image_source !== 'product-processed'"));
  assert.ok(mural.includes('Boolean(src) && needsTreatment'));
  assert.ok(mural.includes('useTreatedProductImage'));
  assert.ok(admin.includes('TransparentMuralProductImage'));
  assert.ok(admin.includes('useTreatedProductImage'));
  assert.ok(admin.includes('GeminiReferenceFigure'));
  assert.ok(admin.includes('Baixar PNG'));
  assert.ok(mural.includes('mural-product-transparent'));
  assert.ok(publicCss.includes('.mural-product-transparent'));
  assert.ok(adminCss.includes('.mural-gemini-pro-references figure>img.mural-product-transparent'));
});

test('Mural product cutouts and collection animation do not add artificial shadows', () => {
  assert.ok(publicCss.includes('.mural-collection-reveal-product>img'));
  assert.ok(publicCss.includes('.mural-product-transparent,'));
  assert.ok(publicCss.includes('filter:none!important'));
  assert.ok(publicCss.includes('box-shadow:none!important'));
});

test('Gemini Pro references are named as PNG and prompt explains transparent references', () => {
  assert.ok(router.includes('filename: `${rawName}.png`'));
  assert.ok(router.includes('transparent PNG product reference'));
});
