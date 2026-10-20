import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {COMMERCE_IMPORT_OPTIONS} from '../src/commerce-import-options.js';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const center=fs.readFileSync('src/commerce-import-center.jsx','utf8');
const modal=fs.readFileSync('src/commerce-import-modal.jsx','utf8');
const modalCss=fs.readFileSync('src/commerce-import-modal.css','utf8');
const managerCss=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const icon=fs.readFileSync('src/vendor/CommercialIcon.jsx','utf8');

test('Importar arquivo is a dropdown; legacy four-card inline block is removed',()=>{
  assert.match(manager,/setImportMenuOpen\(open=>!open\)/);
  assert.match(manager,/aria-haspopup="menu"/);
  assert.match(manager,/aria-expanded=\{importMenuOpen\}/);
  assert.match(manager,/role="menu" aria-label="Escolher tipo de relatório"/);
  assert.match(manager,/role="menuitem"/);
  assert.match(manager,/COMMERCE_IMPORT_OPTIONS\.map/);
  assert.match(manager,/openImportType\(option\.mode\)/);
  assert.doesNotMatch(manager,/nim-import-panel|importOpen|<CommerceImportCenter embedded/);
  assert.match(managerCss,/\.nim-import-options\{position:absolute;/);
  assert.match(managerCss,/\.nim-import-option-copy/);
});

test('all four report types use the same import window, not different implementations',()=>{
  assert.deepEqual(COMMERCE_IMPORT_OPTIONS.map(x=>x.mode),
    ['catalog','sales','ads','aftercare']);
  assert.match(manager,/selectedImportMode&&<CommerceImportModal mode=\{selectedImportMode\}/);
  assert.match(modal,/CommerceImportCenter key=\{mode\} embedded initialMode=\{mode\} hideModeSelector/);
  assert.match(center,/IMPORT_MODES\.includes\(initialMode\)/);
  assert.match(center,/!\s*hideModeSelector && <div className="import-center-mode-grid"/);
  assert.match(modal,/role="dialog" aria-modal="true"/);
  assert.match(modal,/createPortal\(/);
  assert.match(modal,/onChooseAnother/);
  assert.match(modal,/onSalesChanged=\{onSalesChanged\} onCatalogChanged=\{onCatalogChanged\}/);
});

test('import flows still use real readers and existing client actions',()=>{
  assert.match(center,/readCommerceXlsx\(file, catalogPlatform/);
  assert.match(center,/readCommerceSalesXlsx\(file, salesPlatform, salesMonth\)/);
  assert.match(center,/mode==='ads'&&<CommerceShopeeAdsImport/);
  assert.match(center,/mode==='aftercare'&&<CommerceShopeeAftercareImport/);
  assert.match(center,/onCatalogChanged\?\.\(\)/);
  assert.match(center,/onSalesChanged\?\.\(\)/);
  assert.match(center,/CATALOG_PLATFORMS\.map/);
  assert.match(center,/SALES_PLATFORMS\.map/);
});

test('portal remains keyboard-accessible and supports narrow phone viewports',()=>{
  assert.match(modal,/document\.body\.style\.overflow='hidden'/);
  assert.match(modal,/event\.key==='Escape'/);
  assert.match(modal,/event\.key!=='Tab'/);
  assert.match(modal,/aria-labelledby="nim-import-dialog-title"/);
  assert.match(modal,/onClick=\{onClose\}/);
  assert.match(modal,/onCloseRef\.current\(\)/);
  assert.match(modalCss,/overflow:auto;overscroll-behavior:contain/);
  assert.match(modalCss,/@media\(max-width:780px\)/);
  assert.match(modalCss,/height:100dvh/);
  for(const option of COMMERCE_IMPORT_OPTIONS)
    assert.ok(icon.includes('"'+option.icon+'":'),option.icon+' must be a supported icon');
});
