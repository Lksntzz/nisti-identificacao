import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css=fs.readFileSync(new URL('../src/notification-dispatch.css',import.meta.url),'utf8');
const monitor=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');

test('expedition screen stays within notebook viewport without overflowing page',()=>{
  assert.match(css,/\.nid-monitor\.nid-monitor-v5\{[^}]*height:100dvh;min-height:0;display:grid;grid-template-rows:auto minmax\(0,1fr\) auto;overflow:hidden/);
  assert.match(css,/\.nid-monitor-v5 \.nid-live-v5\{min-height:0;/);
  assert.match(css,/\.nid-monitor-footer-v5\{min-height:0;/);
});

test('logos and messages scale with viewport height instead of only width',()=>{
  assert.match(css,/\.nid-monitor-v5 \.nid-channel-emblem\.amazon\{width:clamp\(62px,12dvh,130px\);height:clamp\(62px,12dvh,130px\)/);
  assert.match(css,/\.nid-message-main\{font-size:clamp\(24px,min\(5\.3vw,7dvh\),72px\)/);
  assert.match(css,/@media\(max-height:650px\)/);
  assert.match(css,/\.nid-monitor-v5 \.nid-message-main-long\{font-size:clamp\(19px,min\(3\.8vw,5\.2dvh\),56px\)/);
  assert.match(monitor,/details\.headline\.length>45\?' nid-message-main-long'/);
  assert.doesNotMatch(monitor,/style=\{\{fontSize:details\.headline\.length/);
});
