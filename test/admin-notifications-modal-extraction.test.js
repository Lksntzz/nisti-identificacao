import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const modal = fs.readFileSync(new URL('../src/admin/AdminNotificationsModal.jsx', import.meta.url), 'utf8');

test('AdminApp imports and mounts one standalone notifications modal', () => {
  assert.ok(main.includes("import AdminNotificationsModal from './admin/AdminNotificationsModal.jsx';"));
  assert.ok(main.includes('<AdminNotificationsModal'));
  assert.ok(main.includes('api={api}'));
  assert.ok(main.includes('setUnreadCount={setUnreadCount}'));
  assert.ok(main.includes('onClose={() => setNotificationsOpen(false)}'));
  assert.ok(!main.includes('function AdminNotificationsModal('));
  assert.ok(modal.includes('export default function AdminNotificationsModal('));
});

test('notifications modal keeps existing loading, read-one, read-all API actions', () => {
  assert.ok(modal.includes("api('/api/admin/system-notifications?limit=100')"));
  assert.ok(modal.includes("api(`/api/admin/system-notifications/${id}/read`, { method: 'POST' })"));
  assert.ok(modal.includes("api('/api/admin/system-notifications/mark-all-read', { method: 'POST' })"));
  assert.ok(modal.includes('setUnreadCount(data.unread_count)'));
  assert.ok(modal.includes('setUnreadCount(0)'));
});

test('notifications modal preserves visibility, keyboard, mobile classes and aria', () => {
  assert.ok(modal.includes('if (!isOpen) return null;'));
  assert.ok(modal.includes("event.key === 'Escape'"));
  assert.ok(modal.includes('role="dialog" aria-modal="true"'));
  assert.ok(modal.includes('className="notifications-modal"'));
  assert.ok(modal.includes('className="notifications-body"'));
  assert.ok(modal.includes("if (!item.is_read) markOne(item.id)"));
  assert.ok(modal.includes('formatAdminNotificationDate(item.created_at)'));
  assert.ok(modal.includes('adminNotificationSourceLabel(item.source)'));
  assert.ok(modal.includes('adminNotificationIcon(item.source, item.severity)'));
});
