import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const topbar = fs.readFileSync(new URL('../src/admin/AdminTopbar.jsx', import.meta.url), 'utf8');

test('main app uses the standalone topbar with the existing state callbacks', () => {
  assert.ok(main.includes("import AdminTopbar from './admin/AdminTopbar.jsx';"));
  assert.ok(main.includes('<AdminTopbar'));
  assert.ok(main.includes('onToggleSidebar={() => setSidebarOpen(prev => !prev)}'));
  assert.ok(main.includes('onOpenNotifications={() => setNotificationsOpen(true)}'));
  assert.ok(main.includes('onToggleDesktopPreview={toggleDesktopPreview}'));
  assert.equal(main.includes('function AdminTopbar('), false);
  assert.ok(topbar.includes('export default function AdminTopbar('));
});

test('topbar retains route titles, active section titles and responsive controls', () => {
  for (const title of ['Produtos NISTI', 'Mural NISTI', 'Painel Comercial', 'Pendências', 'Gerador de Barras', 'Histórico de Bipagens', 'Saúde & Logs']) {
    assert.ok(topbar.includes(title), title);
  }
  assert.ok(topbar.includes('activeCommerceSection'));
  assert.ok(topbar.includes('className="admin-topbar-header"'));
  assert.ok(topbar.includes('className="hamburger-btn"'));
  assert.ok(topbar.includes('onClick={onToggleSidebar}'));
  assert.ok(topbar.includes('aria-pressed={desktopPreview}'));
  assert.ok(topbar.includes('onClick={onToggleDesktopPreview}'));
});

test('topbar retains unread notification control, accessible labels and logout', () => {
  assert.ok(topbar.includes('onClick={onOpenNotifications}'));
  assert.ok(topbar.includes('unreadCount > 99'));
  assert.ok(topbar.includes('topbar-bell-badge'));
  assert.ok(topbar.includes('aria-label={`Atividades do sistema (${unreadCount} não lidas)`}'));
  assert.ok(topbar.includes('action="/admin-logout"'));
  assert.ok(topbar.includes('method="POST"'));
});
