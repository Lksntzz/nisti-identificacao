import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMuralImageHandlers } from '../src/mural-image-routes.js';

const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const images=fs.readFileSync(new URL('../src/mural-image-routes.js',import.meta.url),'utf8');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const handlers=createMuralImageHandlers({json});

test('Mural routes continue using authenticated dispatcher with unchanged R2 image handlers',()=>{
  assert.match(router,/import \{ createMuralImageHandlers \} from '\.\/mural-image-routes\.js'/);
  assert.match(router,/createMuralImageHandlers\(\{ json \}\)/);
  assert.match(router,/export async function handleMuralRequest/);
  for(const name of ['uploadEditorialImage','serveEditorialImage','removeEditorialImage','uploadMuralProductImage','removeMuralProductImage']){
    assert.match(router,new RegExp(`\\b${name}\\b`));
    assert.match(images,new RegExp(`async function ${name}\\(`));
    assert.doesNotMatch(router,new RegExp(`async function ${name}\\(`));
  }
  assert.match(images,/content-type-options','nosniff/);
  assert.match(images,/MAX_EDITORIAL_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(images,/MAX_MURAL_PRODUCT_IMAGE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(images,/\[4,6\]\.includes\(colorType\)/);
  assert.match(images,/status:'review'/);
});

test('image reads return 404 when the image is absent without mutating R2',async()=>{
  let written=0;
  const env={PRODUCT_IMAGES:{
    get:async()=>null,
    put:async()=>{written++},
    delete:async()=>{written++}
  }};
  const found=await handlers.serveEditorialImage('mural/posts/8/missing',env);
  const empty=await handlers.serveEditorialImage(null,env);
  assert.equal(found.status,404);
  assert.equal(empty.status,404);
  assert.equal(written,0);
});

test('private preview image sends no-store and nosniff without altering the stored object',async()=>{
  let deleted=0;
  const bytes=new Uint8Array([1,2,3]);
  const env={PRODUCT_IMAGES:{
    get:async()=>({
      body:bytes,
      httpEtag:'etag1',
      writeHttpMetadata(headers){headers.set('content-type','image/png')}
    }),
    delete:async()=>{deleted++}
  }};
  const res=await handlers.serveEditorialImage('mural/posts/8/image',env,{isPublic:false});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  assert.equal(res.headers.get('content-type'),'image/png');
  assert.equal(deleted,0);
});

test('removing an absent editorial record never deletes an image',async()=>{
  let deleted=0;
  const env={SUPABASE_WRITE_MODE:'off',
    PRODUCT_IMAGES:{delete:async()=>{deleted++}},
    DB:{prepare(){return {bind(){return {first:async()=>null}}};}}
  };
  const res=await handlers.removeEditorialImage(env,'posts',5);
  assert.equal(res.status,404);
  assert.equal(deleted,0);
});

test('manual PNG upload requires an existing catalog original before reading file or writing R2',async()=>{
  let writes=0;
  const env={SUPABASE_WRITE_MODE:'off',
    PRODUCT_IMAGES:{put:async()=>{writes++},delete:async()=>{writes++}},
    DB:{prepare(){return {bind(){return {first:async()=>({id:3,image_key:null})}}};}}
  };
  const req=new Request('https://nisti.local/api/admin/mural/products/3/image',{method:'POST'});
  const res=await handlers.uploadMuralProductImage(3,req,env);
  assert.equal(res.status,422);
  assert.match((await res.json()).error,/imagem original/);
  assert.equal(writes,0);
});
