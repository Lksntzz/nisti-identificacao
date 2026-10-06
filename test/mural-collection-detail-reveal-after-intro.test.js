import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');

test('collection detail reveal starts only after cinematic intro has mounted the card',()=>{
  assert.ok(mural.includes("if (!introComplete || !root || !state.data?.products?.length) return undefined;"));
  assert.ok(mural.includes("nodes[0].classList.add('is-visible')"));
  assert.ok(mural.includes('nodes.slice(1).forEach(node => observer.observe(node))'));
  assert.ok(mural.includes('}, [state.data, introComplete]);'));
});

test('principal cover cannot remain hidden after intro handoff',()=>{
  assert.ok(mural.includes('// The principal cover must never remain hidden after the cinematic intro.'));
  assert.ok(mural.includes("threshold: .12, rootMargin:'0px 0px 8% 0px'"));
});
