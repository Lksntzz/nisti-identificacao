import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('published collections open with a product-only cinematic reveal before the card', () => {
  assert.ok(mural.includes('function CollectionRevealIntro'));
  assert.ok(mural.includes('products={products}'));
  assert.ok(mural.includes('mural-collection-reveal-white-arc'));
  assert.ok(mural.includes('mural-collection-reveal-product'));
  assert.ok(mural.includes('CollectionProductImage product={product}'));
  assert.ok(mural.includes('const showIntro = Boolean(collection && products.length && !introComplete)'));
});

test('intro shows only transparent product imagery over a white arc and dark screen', () => {
  assert.ok(mural.includes('const mainProduct = products[0]'));
  assert.ok(mural.includes('const secondaryProducts = products.slice(1)'));
  assert.ok(css.includes('background:rgba(0,0,0,.96)'));
  assert.ok(css.includes('.mural-collection-reveal-white-arc'));
  assert.ok(css.includes('background:transparent'));
  assert.equal(mural.includes('mural-collection-arc-caption'), false);
});

test('arc rises before main cover and every later cover finishes above the previous one', () => {
  assert.ok(css.includes('transform:translate3d(-50%,64vh,0) rotate(0) scale(.62)'));
  assert.ok(css.includes('transition-delay:520ms'));
  assert.equal(css.includes('@keyframes mural-collection-main-float'), false);
  assert.ok(css.includes('@keyframes mural-collection-cover-arrive'));
  assert.ok(mural.includes("side: side < 0 ? 'left' : 'right'"));
  assert.ok(mural.includes('layer: String(6 + index)'));
  assert.ok(mural.includes("'--reveal-product-delay': `${secondaryStart + secondaryIndex * secondaryStep}ms`"));
  assert.ok(mural.includes("'--reveal-final-layer': position.layer"));
  assert.ok(css.includes('z-index:6'));
  assert.ok(css.includes('z-index:2'));
  assert.ok(css.includes('z-index:var(--reveal-final-layer)'));
  assert.ok(css.includes('var(--reveal-peek-x)'));
  assert.equal(mural.includes('products.slice(0, 5)'), false);
});

test('collection variants wait 1.5 seconds before the next cover and title closes the intro', () => {
  assert.ok(mural.includes('const secondaryStart = 2100'));
  assert.ok(mural.includes('const secondaryStep = 1500'));
  assert.ok(mural.includes('const secondaryDuration = 1250'));
  assert.ok(mural.includes('const titleDuration = 2400'));
  assert.ok(mural.includes("event.animationName !== 'mural-collection-title-rise'"));
  assert.ok(mural.includes('setLeaving(true)'));
  assert.ok(mural.includes('onTransitionEnd={handleIntroTransitionEnd}'));
  assert.ok(mural.includes('onAnimationEnd={handleTitleAnimationEnd}'));
  assert.ok(css.includes('animation:mural-collection-cover-arrive 1250ms'));
  assert.ok(mural.includes('{!showIntro && ('));
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
});


test('white arc and product reveal use smooth GPU-friendly transforms without layer jumps', () => {
  assert.ok(css.includes('box-shadow:none'));
  assert.ok(css.includes('filter:none'));
  assert.ok(css.includes('backface-visibility:hidden'));
  assert.ok(css.includes('z-index:var(--reveal-final-layer,2)'));
  assert.equal(css.includes('55%{\n    z-index:2'), false);
  assert.equal(css.includes('56%{\n    z-index:var(--reveal-final-layer)'), false);
  assert.ok(css.includes('32%{\n    opacity:.72'));
  assert.ok(css.includes('68%{\n    opacity:1'));
});


test('collection intro enlarges products and raises the collection name between fan layers', () => {
  assert.ok(css.includes('width:clamp(176px,52vw,285px)'));
  assert.ok(css.includes('height:clamp(266px,78vw,430px)'));
  assert.ok(mural.includes('className="mural-collection-reveal-title"'));
  assert.ok(mural.includes('<strong>{title}</strong>'));
  assert.ok(css.includes('@keyframes mural-collection-title-rise'));
  assert.ok(css.includes('z-index:6'));
  assert.ok(css.includes('backdrop-filter:none'));
});


test('collection title stays above the product fan', () => {
  assert.ok(css.includes('top:24%'));
  assert.ok(css.includes('.mural-collection-reveal-title{top:26%;width:90vw}'));
});


test('collection reveal has dedicated compositions for two three and four covers', () => {
  assert.ok(mural.includes('2: ['));
  assert.ok(mural.includes('3: ['));
  assert.ok(mural.includes('4: ['));
  assert.ok(mural.includes('collectionRevealPosition(index, products.length)'));
  assert.ok(mural.includes('fan-${Math.min(products.length,4)}'));
  assert.ok(css.includes('.mural-collection-reveal-fan.fan-2'));
  assert.ok(css.includes('.mural-collection-reveal-fan.fan-3'));
  assert.ok(css.includes('.mural-collection-reveal-fan.fan-4'));
});


test('collection intro closes automatically on real animation end and mounts the information card', () => {
  assert.ok(mural.includes("event.propertyName !== 'opacity'"));
  assert.ok(mural.includes('finishIntro()'));
  assert.ok(mural.includes('const [introComplete, setIntroComplete] = useState(false)'));
  assert.ok(mural.includes('onComplete={() => setIntroComplete(true)}'));
  assert.ok(mural.includes('{!showIntro && ('));
  assert.ok(css.includes('transition:opacity 220ms ease'));
});


test('collection reveal waits for eager product images before starting, with a short fallback', () => {
  assert.ok(mural.includes('const [assetsReady, setAssetsReady]'));
  assert.ok(mural.includes('readyAssetsRef'));
  assert.ok(mural.includes('window.setTimeout(() => setAssetsReady(true), 900)'));
  assert.ok(mural.includes('if (!assetsReady) return undefined'));
  assert.ok(mural.includes('onReady={() => markProductReady'));
});
