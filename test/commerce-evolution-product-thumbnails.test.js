import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const sql=fs.readFileSync('supabase/migrations/20261020190000_commerce_evolution_product_images_v1.sql','utf8');
const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
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

test('UI reuses SQL image and keeps original product sales untouched',()=>{
  assert.match(evolution,/url=\{item\.image_url\}/);
  assert.match(evolution,/source=\{item\.image_source\}/);
  assert.match(evolution,/item\.current_units/);
  assert.match(evolution,/item\.previous_units/);
  assert.match(evolution,/listingIds\.join\(' · '\)/);
  assert.match(css,/object-fit:contain/);
  assert.match(css,/nim-evolution-thumb-image\.is-ready/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});

test('Vite renders safe product covers and reliable fallback without remote scripts',async()=>{
  const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
  try{
    const component=await server.ssrLoadModule('/src/commerce-evolution-product-thumbnail.jsx');
    const {safeEvolutionImageUrl,default:Thumbnail}=component;
    assert.equal(safeEvolutionImageUrl('/api/images/42'),'/api/images/42');
    assert.equal(safeEvolutionImageUrl('https://example.org/img.webp'),'https://example.org/img.webp');
    for(const value of ['javascript:alert(1)','data:image/png;base64,AAAA','//site.test/a.png','/api/admin/secret','http://example.org/image.png','/api/images/0','/api/images/1?q=x']){
      assert.equal(safeEvolutionImageUrl(value),null,value);
    }
    const withImage=renderToStaticMarkup(React.createElement(Thumbnail,{url:'/api/images/42',title:'Agenda'}));
    assert.match(withImage,/src="\/api\/images\/42"/);
    assert.match(withImage,/loading="lazy"/);
    assert.match(withImage,/referrerPolicy="no-referrer"/i);
    const empty=renderToStaticMarkup(React.createElement(Thumbnail,{url:null,title:'Agenda'}));
    assert.doesNotMatch(empty,/<img /);
    assert.match(empty,/nim-evolution-thumbnail/);
    assert.match(empty,/<svg /);
  }finally{await server.close();}
});
