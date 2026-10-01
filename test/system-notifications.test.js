import test from 'node:test';
import assert from 'node:assert/strict';

import { describeAdminSystemActivity } from '../src/system-notifications.js';

test('descreve cadastro de produto para o painel administrativo', () => {
  const event = describeAdminSystemActivity({
    pathname: '/api/products',
    method: 'POST',
    status: 201,
    data: { id: 42, sku: 'ABC123', created: true },
    actorName: null
  });

  assert.equal(event.event_type, 'product_created');
  assert.equal(event.source, 'catalog');
  assert.equal(event.entity_id, 42);
  assert.match(event.message, /ABC123/);
});

test('descreve leitura EAN do operador sem misturar com cadastro de item', () => {
  const event = describeAdminSystemActivity({
    pathname: '/api/gtin/7891234567895',
    method: 'GET',
    status: 200,
    data: { product: { id: 8, sku: 'AGENDA-8' } },
    actorName: 'Maria'
  });

  assert.equal(event.event_type, 'gtin_identified');
  assert.equal(event.source, 'scanner');
  assert.match(event.message, /Maria/);
  assert.match(event.message, /AGENDA-8/);
});

test('classifica falha de tratamento como alerta administrativo', () => {
  const event = describeAdminSystemActivity({
    pathname: '/api/admin/product-image-treatment/17/failed',
    method: 'POST',
    status: 200,
    data: { ok: true, product_id: 17, status: 'failed' },
    actorName: null
  });

  assert.equal(event.event_type, 'image_treatment_failed');
  assert.equal(event.source, 'images');
  assert.equal(event.severity, 'warning');
  assert.equal(event.entity_id, '17');
});

test('classifica tentativa de login recusada como evento de segurança', () => {
  const event = describeAdminSystemActivity({
    pathname: '/admin-login',
    method: 'POST',
    status: 401,
    data: null,
    actorName: null
  });

  assert.equal(event.event_type, 'admin_login_failed');
  assert.equal(event.source, 'security');
  assert.equal(event.severity, 'warning');
});
