import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainSource = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const start = mainSource.indexOf('function CreateProductModal');
const end = mainSource.indexOf('\nfunction ', start + 20);
const createProductModal = mainSource.slice(start, end);

test('product registration detects meaningful unsaved draft data', () => {
  assert.match(createProductModal, /const hasUnsavedDraft = !result/);
  assert.match(createProductModal, /nome\.trim\(\) !== ''/);
  assert.match(createProductModal, /variants\.length > 1/);
  assert.match(createProductModal, /Boolean\(variant\.file\)/);
});

test('closing an unsaved registration asks whether to continue instead of discarding it', () => {
  assert.match(createProductModal, /const requestClose = \(\) =>/);
  assert.match(createProductModal, /setConfirmCloseOpen\(true\)/);
  assert.match(createProductModal, /Continuar cadastrando/);
  assert.match(createProductModal, /Descartar cadastro/);
  assert.match(createProductModal, /onClick=\{requestClose\}/);
  assert.match(createProductModal, /e\.target === e\.currentTarget && requestClose\(\)/);
});

test('product registration protects browser/tab exit while draft is unsaved', () => {
  assert.match(createProductModal, /window\.addEventListener\('beforeunload', protectUnsavedRegistration\)/);
  assert.match(createProductModal, /event\.preventDefault\(\)/);
  assert.match(createProductModal, /event\.returnValue = ''/);
  assert.match(createProductModal, /window\.removeEventListener\('beforeunload', protectUnsavedRegistration\)/);
});

test('unsaved registration confirmation is visually above the product modal', () => {
  assert.match(styles, /\.unsaved-registration-backdrop \{[\s\S]*?z-index: 140;/);
  assert.match(styles, /\.unsaved-registration-dialog \{/);
  assert.match(styles, /\.unsaved-registration-actions \{/);
});
