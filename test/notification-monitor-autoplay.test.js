import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('monitor automatically tries to start audio without an operator click',()=>{
  const src=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');
  assert.match(src,/new Audio\(\)/);
  assert.match(src,/ctx\.resume\(\)\.then\(sync\)\.catch\(sync\)/);
  assert.match(src,/ctx\.state==='running'/);
  assert.match(src,/lastBeepId\.current===call\.id/);
  assert.match(src,/remainingSeconds\(call\.expires_at,offset\)>0/);
  assert.match(src,/\{!audioOn&&<button/);
  assert.match(src,/Som automático pronto/);
});
test('dedicated Windows launcher keeps monitor profile and enables autoplay',()=>{
  const bat=fs.readFileSync(new URL('../scripts/abrir-monitor-nisti.cmd',import.meta.url),'utf8');
  assert.match(bat,/no-user-gesture-required/);
  assert.match(bat,/user-data-dir/);
  assert.match(bat,/--app=/);
  assert.match(bat,/--start-fullscreen/);
  assert.match(bat,/lksntz1411\.workers\.dev\/monitor-notificacoes/);
});
