import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mod = readFileSync('src/mural-ean-announcement.js', 'utf8');
const sql = readFileSync('supabase/migrations/20261027170000_mural_ean_announcement_draft_v1.sql', 'utf8');
const core = readFileSync('src/core-router.js', 'utf8');
const gtin = readFileSync('src/gtin-router.js', 'utf8');

test('SQL: rascunho de comunicacao, nunca publicado, uma vez por produto', () => {
  assert.match(sql, /values \('notice','draft'/);
  assert.doesNotMatch(sql, /'published'/);
  assert.match(sql, /product_id bigint primary key/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /\^\[0-9\]\{13\}\$/);
  assert.match(sql, /status='approved'/);
  assert.match(sql, /service_role/);
  assert.match(sql, /revoke all on function public\.nisti_mural_ean_draft_v1\(bigint,int\) from public,anon,authenticated/);
});

test('Worker: copia a imagem tratada (nunca reutiliza a chave do produto) e respeita 5 MB', () => {
  assert.match(mod, /crypto\.randomUUID\(\)/);
  assert.match(mod, /mural\/posts\/\$\{postId\}\//);
  assert.match(mod, /5 \* 1024 \* 1024/);
  assert.doesNotMatch(mod, /p_image_key:\s*draft\.processed_image_key/);
  assert.match(mod, /nisti_admin_mural_editorial_image_v1/);
});

test('Ganchos nao bloqueiam a resposta (waitUntil) nas rotas de aprovacao e vinculo de EAN', () => {
  assert.match(core, /scheduleEanAnnouncementDraft\(ctx,env,productId\);\s*return json\(\{ok:true,product_id:productId,status:'approved'\}\)/);
  assert.match(gtin, /scheduleEanAnnouncementDraft\(ctx, env, productId\);/);
  assert.match(mod, /ctx\.waitUntil\(task\)/);
});

test('createEanAnnouncementDraft: cria rascunho, copia imagem e ignora status diferentes de created', async () => {
  const { createEanAnnouncementDraft } = await import('../src/mural-ean-announcement.js');
  const puts = [];
  const bucket = {
    get: async key => key === 'processed/products/1/a.png' ? { arrayBuffer: async () => new ArrayBuffer(10) } : null,
    put: async (key, bytes) => { puts.push(key); },
    delete: async () => {}
  };
  const calls = [];
  const env = { PRODUCT_IMAGES: bucket };
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body });
    const name = String(url).split('/rpc/')[1];
    if (name === 'nisti_mural_ean_draft_v1') {
      return new Response(JSON.stringify({ status: 'created', post_id: 7, processed_image_key: 'processed/products/1/a.png' }), { headers: { 'content-type': 'application/json' } });
    }
    if (name === 'nisti_admin_mural_editorial_image_v1') {
      return new Response(JSON.stringify({ status: 'ok' }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(1), { headers: { 'content-type': 'application/json' } });
  };
  try {
    env.SUPABASE_URL = 'https://x.supabase.co';
    env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    env.SUPABASE_WRITE_MODE = 'primary';
    const r = await createEanAnnouncementDraft(env, 1);
    assert.equal(r.status, 'created');
    assert.equal(r.post_id, 7);
    assert.equal(puts.length, 1);
    assert.match(puts[0], /^mural\/posts\/7\//);
    assert.notEqual(puts[0], 'processed/products/1/a.png');
    assert.equal(await createEanAnnouncementDraft({}, 1).then(x => x.status), 'skipped');
  } finally { globalThis.fetch = real; }
});
