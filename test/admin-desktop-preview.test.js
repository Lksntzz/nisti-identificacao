import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const desktopBootstrap = fs.readFileSync(new URL('../public/desktop-mode.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

test('admin mobile desktop preview is activated before the app renders', () => {
  assert.ok(html.includes('id="nisti-viewport"'));
  assert.ok(html.includes('<script src="/desktop-mode.js"></script>'));
  assert.ok(desktopBootstrap.includes("params.get('desktop') !== '1'"));
  assert.ok(desktopBootstrap.includes('width=1440'));
  assert.ok(desktopBootstrap.includes('user-scalable=yes'));
  assert.ok(desktopBootstrap.includes("document.documentElement.dataset.nistiDesktopPreview = '1'"));
});

test('admin topbar exposes a reversible Modo PC control', () => {
  assert.ok(source.includes('topbar-desktop-preview-btn'));
  assert.ok(source.includes("url.searchParams.set('desktop', '1')"));
  assert.ok(source.includes("url.searchParams.delete('desktop')"));
  assert.ok(source.includes("desktopPreview ? 'Modo celular' : 'Modo PC'"));
  assert.ok(source.includes("desktopPreview ? 'admin-desktop-preview' : ''"));
});

test('Modo PC control is mobile-first but stays visible while desktop preview is active', () => {
  assert.ok(css.includes('.topbar-desktop-preview-btn {'));
  assert.ok(css.includes('.admin-desktop-preview .topbar-desktop-preview-btn'));
  assert.ok(css.includes('@media (max-width: 860px)'));
  assert.ok(css.includes('.topbar-desktop-preview-btn span'));
});
