import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeAdminSystemActivity } from '../src/system-notifications.js';

const modal = readFileSync(new URL('../src/admin/AdminNotificationsModal.jsx', import.meta.url), 'utf8');

test('login event carries device, place and ip only on security events', () => {
  const ev = describeAdminSystemActivity({ pathname: '/admin-login', method: 'POST', status: 200, data: {}, actorName: 'Admin', context: { ip: '1.2.3.4', device: 'iPhone', place: 'São Paulo' } });
  assert.equal(ev.details.ip, '1.2.3.4');
  assert.equal(ev.details.device, 'iPhone');
});

test('modal expands details with explanation and keeps fallbacks', () => {
  assert.ok(modal.includes('NotificationDetail'));
  assert.ok(modal.includes('O que significa'));
  assert.ok(modal.includes('explanationFor'));
  assert.ok(modal.includes('Atividade registrada pelo sistema'));
});

test('abrir a página de login (GET) não gera aviso de sessão iniciada', async () => {
  const { recordAdminActivityFromResponse } = await import('../src/system-notifications.js');
  const out = await recordAdminActivityFromResponse(new Request('https://x.test/admin-login', { method: 'GET' }), new Response('ok', { status: 200 }), {});
  assert.equal(out, null);
});

test('login recusado de fora do Brasil é destacado', () => {
  const ev = describeAdminSystemActivity({ pathname: '/admin-login', method: 'POST', status: 401, data: {}, actorName: null, context: { ip: '1.2.3.4', device: 'Chrome no Windows', place: 'Tallinn, Harjumaa, EE' } });
  assert.match(ev.title, /fora do Brasil/);
  const br = describeAdminSystemActivity({ pathname: '/admin-login', method: 'POST', status: 401, data: {}, actorName: null, context: { ip: '1.2.3.4', device: 'Chrome', place: 'São Paulo, São Paulo, BR' } });
  assert.equal(br.title, 'Tentativa de acesso recusada');
});
