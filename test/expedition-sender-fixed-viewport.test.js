import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../src/expedition-dispatch-standalone.css',import.meta.url),'utf8');
const view=fs.readFileSync(new URL('../src/admin/NotificationDispatchView.jsx',import.meta.url),'utf8');
const standalone=fs.readFileSync(new URL('../src/expedition-dispatch-standalone.jsx',import.meta.url),'utf8');
const legacy=fs.readFileSync(new URL('../src/notification-dispatch.css',import.meta.url),'utf8');

test('expedition sender locks desktop to one browser viewport, not a growing document',()=>{
  assert.match(css,/@media\s*\(min-width:\s*1024px\)\s*and\s*\(min-height:\s*650px\)/);
  assert.match(css,/body:has\(\.nid-expedition-standalone\),\s*#root:has\(\.nid-expedition-standalone\)\s*\{[^}]*height:100%;[^}]*overflow:hidden/s);
  assert.match(css,/\.nid-expedition-standalone\s*\{[^}]*height:100dvh;[^}]*display:flex;[^}]*flex-direction:column;[^}]*overflow:hidden/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-expedition-main\s*\{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow:hidden/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-admin\.nid-admin-v5\s*\{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow:hidden/s);
});

test('ten marketplaces stay selectable while mode controls and send action remain accessible',()=>{
  assert.match(css,/\.nid-expedition-standalone \.nid-admin-v5 \.nid-platform-picker\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-send-panel\s*\{[^}]*grid-template-rows:auto auto minmax\(0,1fr\) auto;[^}]*overflow:hidden/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-selected-modes\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[^}]*overflow-y:auto/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-send-footer\s*\{/);
  assert.match(view,/\{tab==='send'&&<div className="nid-admin-grid nid-main-grid">/);
  assert.match(view,/type="submit" className="nid-send"/);
  assert.match(view,/\{PLATFORMS\.map\(name=><label/);
  assert.match(view,/\{selectedPlatforms\.length===0\?/);
});

test('preview and history scroll internally only when there are too many rows',()=>{
  assert.match(css,/\.nid-expedition-standalone \.nid-side-column\s*\{[^}]*grid-template-columns:minmax\(0,1fr\);[^}]*grid-template-rows:minmax\(0,1fr\) auto/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-preview-queue\s*\{[^}]*overflow-y:auto/s);
  assert.match(css,/\.nid-expedition-standalone \.nid-history-v5 \.nid-history-list\s*\{[^}]*overflow:auto/s);
  assert.match(css,/@media\s*\(min-width:1024px\) and \(min-height:650px\) and \(max-height:740px\)/);
  assert.ok(legacy.includes('.nid-admin-v5 .nid-main-grid'));
});

test('sender does not show a monitor configuration button with no settings access',()=>{
  assert.match(view,/!senderMode&&<button type="button" className="nid-secondary nid-pair-link"/);
  assert.match(view,/!senderMode&&tab==='settings'/);
  assert.match(standalone,/NotificationDispatchView senderMode/);
  assert.doesNotMatch(standalone,/href="\/admin"|href="\/monitor-notificacoes"/);
});
