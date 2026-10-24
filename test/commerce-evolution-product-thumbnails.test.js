import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const sql=fs.readFileSync('supabase/migrations/20261020190000_commerce_evolution_product_images_v1.sql','utf8');
const css=fs.readFileSync('src/commerce-reactbits-lucide.css','utf8');

test('image resolution is page-scoped and limited to unique exact SKU matches',()=>{
  assert.match(sql,/images_for_page as \(/i);
  assert.match(sql,/from paged p\s+left join lateral/i);
  assert.match(sql,/from images_for_page p/);
  assert.match(sql,/public\.commerce_nisti_sku_norm_v1\(np\.sku\)/);
  assert.match(sql,/count\(\*\)=1 and max\(nullif\(btrim\(np\.image_key\)/);
  assert.match(sql,/count\(distinct cp\.id\)=1/);
  assert.match(sql,/commerce_image_years_compatible\(ps\.sku,cp\.reference_image_sku,cp\.name\)/);
  assert.match(sql,/count\(distinct lp\.product_id\)=1/);
  assert.match(sql,/l\.listing_status='ACTIVE'/);
  assert.match(sql,/p\.source='SHOPEE'/);
  assert.match(sql,/coalesce\(scanner\.image_url, master\.image_url, listing_image\.image_url\)/);
  assert.match(sql,/end image_source/);
  assert.doesNotMatch(sql,/similarity\(|levenshtein\(|to_tsvector\(|\binsert into public\.|\bupdate public\.|\bdelete from public\./i);
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/grant execute on function public\.commerce_sales_evolution_v1/);
});
