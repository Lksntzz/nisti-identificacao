import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');

test('motion part 6 removes a broken collection cover instead of reserving empty media space', () => {
  assert.ok(mural.includes('const [coverFailed, setCoverFailed] = useState(false)'));
  assert.ok(mural.includes('const hasCover = Boolean(collection?.image_url && !coverFailed)'));
  assert.ok(mural.includes("className={`mural-detail mural-collection-detail ${hasCover ? 'has-cover' : 'no-cover'}`}"));
  assert.ok(mural.includes('setCoverFailed(true)'));
  assert.ok(mural.includes('alt=""'));
});

test('collection detail keeps scroll progress after the editorial refactor', () => {
  assert.ok(mural.includes("node.style.setProperty('--collection-progress', String(progress))"));
  assert.ok(mural.includes('mural-collection-progress'));
  assert.ok(css.includes('transform:scaleX(var(--collection-progress))'));
});

test('collection products keep staggered reveal after part 7', () => {
  assert.ok(mural.includes("'--collection-item-delay': '45ms'"));
  assert.ok(mural.includes("'--collection-item-delay': `${Math.min(index + 1, 8) * 45}ms`"));
  assert.ok(mural.includes("'--collection-item-shift': index % 2 === 0 ? '-8px' : '8px'"));
  assert.ok(css.includes('var(--collection-item-delay,0ms)'));
  assert.ok(css.includes('.mural-collection-product[data-collection-reveal].is-visible'));
});

test('motion part 6 respects reduced motion and keeps operators on Em breve', () => {
  assert.ok(mural.includes("if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return"));
  assert.ok(css.includes('.mural-collection-progress{'));
  assert.ok(css.includes('animation:none!important'));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
