import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCanvaImageBridgeRequest, imageIndexForField } from '../src/canva-image-router.js';

test('Canva artwork keeps numbered image fields in their intended order', () => {
  assert.equal(imageIndexForField('IMAGEM DO ITEM 1', 1), 0);
  assert.equal(imageIndexForField('IMAGEM DO ITEM 2', 0), 1);
  assert.equal(imageIndexForField('Capa 6', 0), 5);
  assert.equal(imageIndexForField('Imagem principal', 3), 0);
});

test('Canva bridge reports missing Worker secrets without exposing credentials', async () => {
  const response = await handleCanvaImageBridgeRequest(
    new Request('https://nisti.example/api/admin/canva/status'),
    {}
  );
  assert.equal(response.status,200);
  const payload = await response.json();
  assert.equal(payload.configured,false);
  assert.equal(payload.connected,false);
  assert.deepEqual(
    payload.missing.sort(),
    ['CANVA_CLIENT_ID','CANVA_CLIENT_SECRET','CANVA_TOKEN_ENCRYPTION_KEY'].sort()
  );
  assert.equal(payload.redirect_uri,'https://nisti.example/canva-oauth/callback');
  assert.deepEqual(payload.required_scopes,['asset:read','asset:write','design:content:read','design:content:write','design:meta:read','brandtemplate:meta:read','brandtemplate:content:read','profile:read']);
});

test('Canva connect refuses to start when backend secrets are absent', async () => {
  const response = await handleCanvaImageBridgeRequest(
    new Request('https://nisti.example/api/admin/canva/connect',{method:'POST'}),
    {}
  );
  assert.equal(response.status,503);
  const payload = await response.json();
  assert.equal(payload.code,'canva_not_configured');
});

test('Canva bridge ignores unrelated routes', async () => {
  const response = await handleCanvaImageBridgeRequest(
    new Request('https://nisti.example/api/health'),
    {}
  );
  assert.equal(response,null);
});
