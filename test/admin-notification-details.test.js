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
