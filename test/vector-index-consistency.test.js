import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('src/core-router.js','utf8');
const reindex=fs.readFileSync('src/reference-reindex-router.js','utf8');

test('product reference embedding is committed only after Vectorize upsert succeeds',()=>{
  const start=core.indexOf('async function storeReferenceEmbedding');
  const end=core.indexOf('async function cleanupStaleProductReferences',start);
  const block=core.slice(start,end);
  const vector=block.indexOf('await env.COVER_VECTORS.upsert(vectors)');
  const database=block.indexOf("nisti_store_reference_embedding_v1");
  assert.ok(vector>=0 && database>vector);
  assert.match(block,/Binding COVER_VECTORS não configurado/);
  assert.match(block,/Nenhum namespace de plataforma disponível/);
  assert.match(block,/stored\.value\?\.status !== 'ok'/);
});

test('primary product image replacement removes stale Vectorize ids after DB cleanup',()=>{
  const start=core.indexOf('async function storeReferenceEmbedding');
  const end=core.indexOf('async function cleanupStaleProductReferences',start);
  const block=core.slice(start,end);
  assert.match(block,/removedReferences\.length/);
  assert.match(block,/supportedPlatforms\(\)/);
  assert.match(block,/env\.COVER_VECTORS\.deleteByIds\(staleVectorIds\)/);
});

test('scheduled reindex keeps vector failures pending for automatic retry',()=>{
  const start=reindex.indexOf('export async function runReferenceReindex');
  const end=reindex.indexOf('async function reindexPending',start);
  const block=reindex.slice(start,end);
  const vector=block.indexOf('await env.COVER_VECTORS.upsert(scopedVectors)');
  const database=block.indexOf("nisti_upsert_reference_embedding_v1");
  assert.ok(vector>=0 && database>vector);
  assert.match(block,/errors\.push/);
  assert.match(block,/pending = await countPending/);
});

test('reference platform fallback prevents an embedding with zero Vectorize namespaces',()=>{
  const start=reindex.indexOf('async function vectorsFromReference');
  const end=reindex.indexOf('async function pendingReferences',start);
  const block=reindex.slice(start,end);
  assert.match(block,/if \(!platforms\.length\) platforms = supportedPlatforms\(\)/);
});
