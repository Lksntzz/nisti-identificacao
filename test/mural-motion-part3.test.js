import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');

test('motion part 3 progressively reveals loaded Mural images', () => {
  assert.ok(mural.includes('const [loaded, setLoaded] = useState(false)'));
  assert.ok(mural.includes('onLoad={() => setLoaded(true)}'));
  assert.ok(mural.includes("mural-image-media${shouldRemoveBackground ? ' mural-product-transparent' : ''}${loaded ? ' is-loaded' : ''}"));
  assert.ok(css.includes('.mural-image-media.is-loaded'));
  assert.ok(css.includes('opacity:1'));
});

test('motion part 3 animates NOVO and editorial badges only when cards become visible', () => {
  assert.ok(mural.includes('mural-new-badge mural-badge-motion'));
  assert.ok(mural.includes('mural-editorial-badge mural-badge-motion'));
  assert.ok(mural.includes('mural-notice-label mural-badge-motion'));
  assert.ok(css.includes('.mural-reveal.is-visible .mural-new-badge'));
  assert.ok(css.includes('@keyframes mural-new-badge-pop'));
  assert.ok(css.includes('@keyframes mural-badge-settle'));
});

test('motion part 3 adds one-shot unread emphasis and premium hover without looping effects', () => {
  assert.ok(css.includes('.mural-card.unread.is-visible::before'));
  assert.ok(css.includes('@keyframes mural-unread-accent'));
  assert.ok(css.includes('.mural-card:hover .mural-card-content'));
  assert.ok(css.includes('.mural-card-collection:hover .mural-collection-card-copy'));
  const part3 = css.slice(css.indexOf('/* Motion Part 3:'));
  assert.equal(part3.includes('infinite'), false);
});

test('motion part 3 preserves reduced-motion and the public Em breve gate', () => {
  assert.ok(css.includes('.mural-reveal.is-visible .mural-badge-motion'));
  assert.ok(css.includes('animation:none!important'));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
