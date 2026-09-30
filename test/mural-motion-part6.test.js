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
  assert.ok(mural.includes('onError={() => {'));
  assert.ok(mural.includes('setCoverFailed(true)'));
  assert.ok(mural.includes('alt=""'));
  assert.ok(css.includes('.mural-collection-detail.no-cover .mural-collection-body'));
});

test('motion part 6 adds collection scroll progress and lighter parallax', () => {
  assert.ok(mural.includes("node.style.setProperty('--collection-progress', String(progress))"));
  assert.ok(mural.includes("const offset = Math.max(-18, node.scrollTop * -0.045)"));
  assert.ok(mural.includes('mural-collection-progress'));
  assert.ok(css.includes('transform:scaleX(var(--collection-progress))'));
});

test('motion part 6 staggers collection products from alternating directions', () => {
  assert.ok(mural.includes("'--collection-item-delay': `${Math.min(index, 8) * 45}ms`"));
  assert.ok(mural.includes("'--collection-item-shift': index % 2 === 0 ? '-8px' : '8px'"));
  assert.ok(css.includes('translate:var(--collection-item-shift,0) 14px'));
  assert.ok(css.includes('var(--collection-item-delay,0ms)'));
  assert.ok(css.includes('.mural-collection-product[data-collection-reveal].is-visible img'));
});

test('motion part 6 respects reduced motion and keeps operators on Em breve', () => {
  assert.ok(mural.includes("if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return"));
  assert.ok(css.includes('.mural-collection-progress{'));
  assert.ok(css.includes('animation:none!important'));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
