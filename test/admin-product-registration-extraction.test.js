import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const registration = fs.readFileSync(new URL('../src/admin/ProductRegistrationModal.jsx', import.meta.url), 'utf8');

test('admin shell imports standalone registration without keeping duplicate components', () => {
  assert.match(main, /import CreateProductModal, \{ RegistrationBarcodeResult \} from '\.\/admin\/ProductRegistrationModal\.jsx'/);
  assert.doesNotMatch(main, /function (CreateProductModal|RegistrationBarcodeResult)\(/);
  assert.match(main, /<CreateProductModal[\s\S]*?api=\{api\}[\s\S]*?compressAdminImage=\{compressAdminImage\}/);
  assert.match(main, /\bRegistrationBarcodeResult\b[\s\S]*?export default AdminApp/);
});

test('extracted component retains product/variation registration and image upload', () => {
  assert.match(registration, /export default function CreateProductModal\(/);
  assert.match(registration, /export function RegistrationBarcodeResult\(/);
  assert.match(registration, /api\('\/api\/products', \{/);
  assert.match(registration, /api\(\`\/api\/products\/\$\{productId\}\/image\`/);
  assert.match(registration, /await compressAdminImage\(v\.file\)/);
  assert.match(registration, /setResult\(\{ items: registered, errors: failures \}\)/);
  assert.match(registration, /await onCreated\?\.\(/);
  assert.match(registration, /if \(!isOpen\) return null/);
});

test('barcode results and unsaved-draft confirmation remain available', () => {
  assert.match(registration, /downloadBarcodeZip\(barcodeItems/);
  assert.match(registration, /downloadBarcodePng\(item\)/);
  assert.match(registration, /createEan13Svg\(item\)/);
  assert.match(registration, /window\.addEventListener\('beforeunload', protectUnsavedRegistration\)/);
  assert.match(registration, /Descartar cadastro/);
  assert.match(registration, /Continuar cadastrando/);
  assert.match(registration, /CommerceSyncBadge sync=\{item\.commerce_sync\}/);
});
