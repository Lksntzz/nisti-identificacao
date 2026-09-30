import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('motion part 1 stages the Mural title and filters on entry', () => {
  assert.ok(mural.includes('mural-title-block mural-intro mural-intro-title'));
  assert.ok(mural.includes('mural-tabs mural-intro mural-intro-tabs'));
  assert.ok(mural.includes("shell.classList.add('motion-ready')"));
  assert.ok(mural.includes("shell.classList.add('motion-entered')"));
  assert.ok(css.includes('.mural-shell.motion-ready.motion-entered .mural-intro'));
});

test('motion part 1 gives the hero a one-shot entrance instead of continuous accent motion', () => {
  assert.ok(mural.includes('mural-hero mural-hero-enter'));
  assert.ok(css.includes('@keyframes mural-hero-enter'));
  assert.ok(css.includes('@keyframes mural-hero-copy-enter'));
  assert.ok(css.includes('@keyframes mural-accent-enter'));
  assert.equal(css.includes('mural-accent-float'), false);
  const accentRule = css.match(/\\.mural-hero-accent i\\{([\\s\\S]*?)\\n\\}/)?.[1] || '';
  assert.equal(accentRule.includes('infinite'), false);
});

test('motion part 1 keeps hero parallax subtle and avoids scroll work for reduced motion', () => {
  assert.ok(mural.includes('if (reducedMotionRef.current) return;'));
  assert.ok(mural.includes('Math.max(-18, Math.min(0, node.scrollTop * -0.055))'));
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
  assert.ok(css.includes('.mural-hero-enter,'));
  assert.ok(mural.indexOf("const feed =") < mural.indexOf("[tab, feed.length, loading]"));
});

test('motion part 1 centralizes timing tokens for the Mural', () => {
  assert.ok(css.includes('--mural-motion-fast: 160ms'));
  assert.ok(css.includes('--mural-motion-ui: 220ms'));
  assert.ok(css.includes('--mural-motion-enter: 520ms'));
  assert.ok(css.includes('--mural-ease-out: cubic-bezier(.16,1,.3,1)'));
});
