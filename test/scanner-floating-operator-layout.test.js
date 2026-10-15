import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const jsx=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/app.css',import.meta.url),'utf8');
const muralCss=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');

test('scanner moves operator identity below, retaining profile editing and top notification bell',()=>{
  const header=jsx.slice(jsx.indexOf('function BrandHeader('),jsx.indexOf('function PublicIdentificationApp()'));
  assert.doesNotMatch(header,/operator-profile-pill/);
  assert.match(header,/<BellIcon unreadCount={unreadCount} onClick={onOpenNotifications}/);
  assert.match(jsx,/operator-floating-dock/);
  assert.match(jsx,/operator-floating-profile/);
  assert.match(jsx,/onClick=\{\(\) => setOperatorModalOpen\(true\)\}/);
  assert.match(css,/\.app\.general \.operator-floating-dock/);
  assert.match(css,/position:fixed;right:/);
  assert.match(css,/\.app\.general \.operator-floating-dock\{right:auto;left:/);
  assert.doesNotMatch(jsx,/className="operator-floating-name"/);
});

test('Mural teaser stays separate from notification count and unauthorized preview',()=>{
  assert.match(jsx,/mural-nav-label/);
  assert.match(jsx,/Novidades/);
  assert.match(jsx,/muralReleased \? '' : ' is-coming-soon'/);
  assert.match(jsx,/mural-coming-soon/);
  assert.match(muralCss,/\.mural-nav-btn\.mural-nav-btn-spotlight/);
  assert.match(muralCss,/\.mural-nav-label/);
});
