import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../src/mural-nisti.css',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');

test('phase 4 uses cursor pagination without replacing existing feed',()=>{
  assert.ok(router.includes('next_cursor'));
  assert.ok(ui.includes('&cursor='));
  assert.ok(ui.includes('Carregar mais'));
  assert.ok(ui.includes('const merged = [...previous'));
});

test('phase 4 keeps last session response visible on refresh failure',()=>{
  assert.ok(ui.includes('sessionCache = useRef(new Map())'));
  assert.ok(ui.includes('sessionCache.current.get(tab)'));
  assert.ok(ui.includes('Não foi possível atualizar o Mural.'));
  assert.ok(ui.includes('Tentar novamente'));
});

test('phase 4 keeps skeleton and empty states required by PDP',()=>{
  assert.ok(ui.includes('mural-skeleton-hero'));
  assert.equal((ui.match(/mural-skeleton-card/g)||[]).length>=1,true);
  assert.ok(ui.includes('Nenhuma novidade por aqui agora.'));
  assert.ok(ui.includes('Ainda não há produtos publicados nessa coleção.'));
});

test('phase 4 accessibility covers focus dialog alt and reduced motion',()=>{
  assert.ok(ui.includes('role="dialog"'));
  assert.ok(ui.includes('aria-modal="true"'));
  assert.ok(ui.includes('closeRef.current?.focus()'));
  assert.ok(ui.includes("event.key === 'Escape'"));
  assert.ok(css.includes(':focus-visible'));
  assert.ok(css.includes('prefers-reduced-motion: reduce'));
  assert.ok(css.includes('min-height: 44px'));
});

test('phase 4 retains mobile width contracts and safe areas',()=>{
  assert.ok(css.includes('@media (max-width: 360px)'));
  assert.ok(css.includes('@media (max-width: 390px)'));
  assert.ok(css.includes('@media (min-width: 431px)'));
  assert.ok(css.includes('env(safe-area-inset-bottom)'));
});
