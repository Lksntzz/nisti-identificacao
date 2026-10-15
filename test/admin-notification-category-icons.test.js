import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const main=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/app.css',import.meta.url),'utf8');

test('admin activity notifications render contextual SVG icons instead of placeholder unicode symbols',()=>{
  const start=main.indexOf('function adminNotificationIcon(source, severity)');
  const end=main.indexOf('function formatAdminNotificationDate',start);
  assert.ok(start>=0 && end>start);
  const icons=main.slice(start,end);
  for(const type of ['images','admin','scanner','catalog','mural','commerce','operators','security','error','warning']){
    assert.match(icons,new RegExp("case '"+type+"'"));
  }
  assert.match(icons,/<svg \{\.\.\.attributes\}/);
  assert.doesNotMatch(icons,/return '•'|return '◫'|return '⚠'/);
  assert.match(main,/notification-thumb-\$\{/);
  assert.match(main,/adminNotificationIcon\(item\.source, item\.severity\)/);
});

test('visual hierarchy and severity palette are consistent across notification types',()=>{
  for(const type of ['images','admin','scanner','catalog','mural','commerce','operators','security','warning','error']){
    assert.match(css,new RegExp('\\.notification-thumb\\.notification-thumb-'+type));
  }
  assert.match(css,/\.notification-thumb svg \{display:block;width:30px;height:30px/);
});
