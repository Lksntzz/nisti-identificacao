import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createMuralCollectionHandlers } from '../src/mural-collection-routes.js';

const routerSource = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const collectionSource = fs.readFileSync(new URL('../src/mural-collection-routes.js', import.meta.url), 'utf8');

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' }
});

const nullableText = (value, max) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
};

const requiredText = (value, max, label) => {
  const text = nullableText(value, max);
  if (!text) throw new Error(`${label} é obrigatório.`);
  return text;
};

function collectionHandlers(onPublished = async () => {}) {
  return createMuralCollectionHandlers({
    json: response,
    readJson: request => request.json(),
    nullableText,
    requiredText,
    notifyMuralAfterPublication: onPublished
  });
}

test('Mural routes delegate collection CRUD and publication without exposing an independent auth gate', () => {
  assert.match(routerSource, /import \{ createMuralCollectionHandlers \} from '\.\/mural-collection-routes\.js'/);
  assert.match(routerSource, /createMuralCollectionHandlers\(\{ json, readJson, nullableText, requiredText, notifyMuralAfterPublication \}\)/);
  for (const name of ['adminListCollections', 'adminCreateCollection', 'adminUpdateCollection', 'adminSetCollectionProducts', 'adminPublishCollection']) {
    assert.match(routerSource, new RegExp(`\\b${name}\\b`));
    assert.match(collectionSource, new RegExp(`async function ${name}\\(`));
    assert.doesNotMatch(routerSource, new RegExp(`async function ${name}\\(`));
  }
  assert.match(routerSource, /export async function handleMuralRequest/);
  assert.match(routerSource, /if \(path\.startsWith\('\/api\/mural'\) && !MURAL_PUBLIC_RELEASED && !qaAuthorized\)/);
  assert.doesNotMatch(collectionSource, /\bfetch\s*\(/);
});

test('collection list preserves product membership order and API response shape', async () => {
  const sqlCalls = [];
  const env = { SUPABASE_WRITE_MODE: 'off', DB: {
    prepare(sql) {
      sqlCalls.push(sql);
      return { async all() {
        return { results: sql.includes('FROM mural_collection_products')
          ? [{ collection_id: 7, product_id: 13, sort_order: 0 }, { collection_id: 7, product_id: 22, sort_order: 1 }]
          : [{ id: 7, slug: 'catalogo', name: 'Catálogo', status: 'active' }] };
      } };
    }
  } };
  const result = await collectionHandlers().adminListCollections(env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.items.map(x => ({ id: x.id, product_ids: x.product_ids, product_count: x.product_count })), [
    { id: 7, product_ids: '13,22', product_count: 2 }
  ]);
  assert.ok(sqlCalls.some(sql => sql.includes('ORDER BY collection_id ASC,sort_order ASC,product_id ASC')));
});

test('collection create retains slug normalization and rejects unsupported visual direction before any database write', async () => {
  let writes = 0;
  const env = { SUPABASE_WRITE_MODE: 'off', DB: { prepare() {
    writes++;
    return { bind() { return { async run() { return { meta: { last_row_id: 11 } }; } }; } };
  } } };
  const handlers = collectionHandlers();
  await assert.rejects(handlers.adminCreateCollection(new Request('https://nisti.local', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Coleção Edição', visual_direction: 'untrusted' })
  }), env), /Direção visual da coleção inválida/);
  assert.equal(writes, 0);

  const result = await handlers.adminCreateCollection(new Request('https://nisti.local', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Coleção Edição', visual_direction: 'premium' })
  }), env);
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { id: 11, slug: 'colecao-edicao' });
  assert.equal(writes, 1);
});

test('collection publication refuses inactive collections without pushing notifications', async () => {
  let pushes = 0;
  const env = { SUPABASE_WRITE_MODE: 'off', DB: { prepare() {
    return { bind() { return { async first() {
      return { id: 4, status: 'archived' };
    } }; } };
  } } };
  const result = await collectionHandlers(async () => { pushes++; }).adminPublishCollection(4, env);
  assert.equal(result.status, 422);
  assert.match((await result.json()).error, /Ative a coleção antes de publicar/);
  assert.equal(pushes, 0);
});
