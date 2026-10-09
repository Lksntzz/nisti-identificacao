import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/app.css',import.meta.url),'utf8');

test('admin notifications render one stable icon without keyed SVG copies',()=>{
  const adminStart=source.indexOf('function AdminTopbar(');
  const bellStart=source.indexOf('className={`topbar-bell-btn',adminStart);
  const bellEnd=source.indexOf('</button>',bellStart);
  assert.ok(adminStart>=0&&bellStart>adminStart&&bellEnd>bellStart);
  const bell=source.slice(bellStart,bellEnd);
  assert.doesNotMatch(bell,/<svg|<path|key={unreadCount/);
  assert.match(bell,/onClick={onOpenNotifications}/);
  assert.match(bell,/topbar-bell-badge/);
  assert.match(bell,/unreadCount > 99 \? '99\+' : unreadCount/);
});

test('the bell is drawn once via a nonrepeating static background without SVG animations',()=>{
  assert.match(css,/\.topbar-bell-btn::before\s*\{[\s\S]*?background-image: url\("data:image\/svg\+xml,/);
  assert.match(css,/\.topbar-bell-btn::before\s*\{[\s\S]*?background-repeat: no-repeat;/);
  assert.doesNotMatch(css,/\.topbar-bell-btn\.has-unread > svg/);
  assert.doesNotMatch(css,/@keyframes nisti-bell-ring/);
});
