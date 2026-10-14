import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeCommerceImportRow} from '../src/commerce-import-normalizer.js';
test('ML bulk export ignores metadata and parent row but reads variation SKU and listing ID',()=>{
 const parent=['','MLB4028562870',null,null,'','Planner exemplo','-',0,19,37.6];
 const child=['','MLB4028562870','178695790630','178695790630','PLASHP RSA PXP',0,'CAPA 01',980,3,0];
 assert.equal(normalizeCommerceImportRow({marketplace:'MERCADO_LIVRE',sheetName:'Anúncios',row:parent,rowNumber:7}),null);
 const item=normalizeCommerceImportRow({marketplace:'MERCADO_LIVRE',sheetName:'Anúncios',row:child,rowNumber:8});
 assert.equal(item.normalized.external_listing_id,'MLB4028562870');
 assert.equal(item.normalized.sku_primary,'PLASHP RSA PXP');
 assert.equal(item.normalized.source_variation_id,'178695790630');
 assert.equal(item.status,'REVIEW');
 assert.ok(item.issues.includes('verify_listing_active'));
 assert.equal(normalizeCommerceImportRow({marketplace:'MERCADO_LIVRE',sheetName:'Ajuda',row:child,rowNumber:8}).status,'INVALID');
});