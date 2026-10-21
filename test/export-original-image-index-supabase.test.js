import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchOriginalImageIndex, writeOriginalImageIndex } from '../scripts/export-original-image-index-supabase.mjs';

const auth = {
  supabaseUrl: 'https://example.supabase.co',
  serviceKey: 'test-only-secret'
};
const product = id => ({ id, sku: 'SKU_' + id, image_key: 'products/' + id + '/original.jpg' });
function page(rows, count) {
  return new Response(JSON.stringify(rows), { status: 200, headers: {
    'content-type': 'application/json',
    'content-range': rows.length ? `0-${rows.length - 1}/${count}` : `*/${count}`
  } });
}

test('Supabase image index fetches all pages via stable ascending IDs and never exposes token in URL', async () => {
  const requested = [];
  const fetchImpl = async (url, options) => {
    const uri = new URL(url);
    requested.push(uri);
    assert.equal(uri.pathname, '/rest/v1/products');
    assert.equal(uri.searchParams.get('select'), 'id,sku,image_key');
    assert.equal(uri.searchParams.get('image_key'), 'not.is.null');
    assert.equal(uri.searchParams.get('order'), 'id.asc');
    assert.ok(!url.includes(auth.serviceKey));
    assert.equal(options.headers.apikey, auth.serviceKey);
    assert.equal(options.headers.Authorization, 'Bearer ' + auth.serviceKey);
    assert.equal(options.headers.Prefer, 'count=exact');
    if (requested.length === 1) return page([product(11), product(22)], 3);
    if (requested.length === 2) return page([product(33)], 1);
    throw Error('Unexpected extra page');
  };
  const rows = await fetchOriginalImageIndex({ ...auth, fetchImpl, pageSize: 2 });
  assert.deepEqual(rows, [product(11), product(22), product(33)]);
  assert.deepEqual(requested.map(url => url.searchParams.get('id')), ['gt.0', 'gt.22']);
});

test('Supabase index continues if API caps page below requested size', async () => {
  let call = 0;
  const result = await fetchOriginalImageIndex({ ...auth, pageSize: 5, fetchImpl: async () => {
    call++;
    return page([product(call)], 4 - call);
  } });
  assert.equal(result.length, 3);
  assert.equal(call, 3);
});

test('Supabase exporter fails closed for missing secrets, invalid responses and empty catalog', async () => {
  await assert.rejects(() => fetchOriginalImageIndex({ ...auth, serviceKey: '' }), /SECRET_ROLE|SUPABASE_SERVICE_ROLE_KEY/);
  await assert.rejects(() => fetchOriginalImageIndex({ ...auth, supabaseUrl: 'http://example.supabase.co' }), /HTTPS/);
  await assert.rejects(() => fetchOriginalImageIndex({ ...auth, fetchImpl: async () => new Response('{}', { status: 401 }) }), /HTTP 401/);
  await assert.rejects(() => fetchOriginalImageIndex({ ...auth, fetchImpl: async () => new Response('[]') }), /não informou o total/);
  await assert.rejects(() => fetchOriginalImageIndex({ ...auth, fetchImpl: async () => page([], 0) }), /Nenhuma imagem/);
  await assert.rejects(() => fetchOriginalImageIndex({ ...auth, fetchImpl: async () => page([{ ...product(1), image_key:'' }],1) }), /inválido/);
});

test('Index writer retains prior D1-result-shaped contract used by R2 downloader, with data from Supabase', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nisti-original-index-'));
  const dest = path.join(folder,'export','products.json');
  try {
    const count = await writeOriginalImageIndex({
      ...auth, outputPath:dest, fetchImpl:async () => page([product(91)],1)
    });
    assert.equal(count, 1);
    const raw = JSON.parse(await readFile(dest, 'utf8'));
    assert.deepEqual(raw, [{ results: [product(91)] }]);
    await assert.rejects(() => writeOriginalImageIndex({
      ...auth, outputPath:dest, fetchImpl:async () => page([product(91)],1)
    }), /EEXIST/);
  } finally {
    await rm(folder, { recursive:true, force:true });
  }
});

test('R2 original exporter is manual-only and no longer reads D1 index', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/export-original-product-images.yml', import.meta.url), 'utf8');
  const downloader = fs.readFileSync(new URL('../scripts/export-original-product-images.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.doesNotMatch(workflow, /wrangler d1|Read original image index from D1/);
  assert.match(workflow, /Read original image index from Supabase/);
  assert.match(workflow, /secrets\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /scripts\/export-original-image-index-supabase\.mjs/);
  assert.match(downloader, /Array\.isArray\(batch\?\.results\)/);
});
