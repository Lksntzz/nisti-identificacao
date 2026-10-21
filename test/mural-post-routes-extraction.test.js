import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMuralPostHandlers } from '../src/mural-post-routes.js';

const router = fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const posts = fs.readFileSync(new URL('../src/mural-post-routes.js',import.meta.url),'utf8');
const json = (body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

function handlers({ push=async()=>{}, validate=(input)=>input }={}) {
  return createMuralPostHandlers({
    ADMIN_KINDS:new Set(['product','collection','notice']),
    ADMIN_STATUSES:new Set(['draft','published','archived']),
    json,
    readJson:request=>request.json(),
    validatePostPayload:validate,
    normalizeDate:val=>val,
    finishLabels:()=>({wireo:null,tassel:null,elastico:null}),
    notifyMuralAfterPublication:push
  });
}

test('Mural routing delegates post endpoints while preserving the shared session gate',()=>{
  assert.match(router,/import \{ createMuralPostHandlers \} from '\.\/mural-post-routes\.js'/);
  assert.match(router,/createMuralPostHandlers\(\{/);
  assert.match(router,/export async function handleMuralRequest/);
  for(const name of ['adminListPosts','adminGetPost','adminCreatePost','adminUpdatePost','adminPublishPost','adminArchivePost','adminDuplicatePost','adminDeletePost']){
    assert.match(router,new RegExp(`\\b${name}\\b`));
    assert.match(posts,new RegExp(`async function ${name}\\(`));
    assert.doesNotMatch(router,new RegExp(`async function ${name}\\(`));
  }
  assert.doesNotMatch(posts,/\bfetch\s*\(/);
});

test('list of posts rejects invalid status before accessing storage',async()=>{
  let queries=0;
  const env={SUPABASE_WRITE_MODE:'off',DB:{prepare(){queries++;throw Error('unexpected query');}}};
  const url=new URL('https://nisti.local/api/admin/mural/posts?status=invalid');
  const res=await handlers().adminListPosts(url,env);
  assert.equal(res.status,400);
  assert.deepEqual(await res.json(),{error:'Status inválido.'});
  assert.equal(queries,0);
});

test('publishing a nonexistent post cannot send push',async()=>{
  let sent=0;
  const env={SUPABASE_WRITE_MODE:'off',DB:{prepare(){return {bind(){return {first:async()=>null}}};}}};
  const req=new Request('https://nisti.local/api/admin/mural/posts/5/publish',{method:'POST'});
  const res=await handlers({push:async()=>{sent++;}}).adminPublishPost(5,req,env);
  assert.equal(res.status,404);
  assert.equal(sent,0);
  assert.deepEqual(await res.json(),{error:'Publicação não encontrada.'});
});

test('removing a nonexistent post never deletes an image',async()=>{
  let deleted=0;
  const env={SUPABASE_WRITE_MODE:'off',
    DB:{prepare(){return {bind(){return {first:async()=>null}}};}},
    PRODUCT_IMAGES:{delete:async()=>{deleted++;}}
  };
  const res=await handlers().adminDeletePost(123,env);
  assert.equal(res.status,404);
  assert.equal(deleted,0);
});

test('post duplication retains draft status, unscheduled dates and source content',async()=>{
  let saved;
  const env={SUPABASE_WRITE_MODE:'off',
    DB:{prepare(sql){
      if(sql.includes('SELECT * FROM mural_posts'))return {bind(){return {first:async()=>({
        kind:'notice',title:'Comunicado',subtitle:'Nota',body:'Mensagem',badge:'AVISO',badge_tone:'info',image_key:null,
        product_id:null,collection_id:null,notice_level:'info',featured:0,priority:0
      })}}};
      if(sql.includes('INSERT INTO mural_posts'))return {bind(...values){saved=values;return {run:async()=>({meta:{last_row_id:45}})};}};
      throw Error('Unexpected DB query');
    }}
  };
  const res=await handlers().adminDuplicatePost(2,env);
  assert.equal(res.status,201);
  assert.deepEqual(await res.json(),{id:45,status:'draft'});
  assert.equal(saved[1],'Comunicado (cópia)');
  assert.deepEqual(saved.slice(-3),[null,null,'admin']);
});
