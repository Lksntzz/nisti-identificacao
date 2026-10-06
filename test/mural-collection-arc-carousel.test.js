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
  assert.ok(css.includes('z-index:var(--reveal-final-layer,2)'));
  assert.equal(css.includes('var(--reveal-peek-x)'), false);
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


test('white arc and product reveal use one continuous motion with smooth fade-in', () => {
  const motionStart=css.indexOf('.mural-collection-reveal-product.is-main{');
  const motionEnd=css.indexOf('.mural-collection-reveal-title{');
  const motion=css.slice(motionStart,motionEnd);
  assert.ok(css.includes('box-shadow:none'));
  assert.ok(css.includes('filter:none'));
  assert.ok(css.includes('backface-visibility:hidden'));
  assert.ok(motion.includes('z-index:var(--reveal-final-layer,2)'));
  assert.ok(motion.includes('opacity:0'));
  assert.ok(motion.includes('opacity:1'));
  assert.ok(motion.includes('opacity 520ms ease-out'));
  assert.ok(motion.includes('var(--reveal-product-delay) forwards'));
  assert.equal(motion.includes('32%{'), false);
  assert.equal(motion.includes('68%{'), false);
  assert.equal(motion.includes('opacity:.72'), false);
  assert.equal(motion.includes('--reveal-mid-x'), false);
  assert.equal(motion.includes('--reveal-peek-x'), false);
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


test('animated collection products fade only while following a single transform path', () => {
  const mainStart=css.indexOf('.mural-collection-reveal-product.is-main{');
  const titleStart=css.indexOf('.mural-collection-reveal-title{');
  const productMotion=css.slice(mainStart,titleStart);
  assert.ok(productMotion.includes('opacity:0'));
  assert.ok(productMotion.includes('opacity:1'));
  assert.ok(productMotion.includes('transform 1250ms'));
  assert.ok(productMotion.includes('@keyframes mural-collection-cover-arrive'));
  assert.equal(productMotion.includes('32%{'), false);
  assert.equal(productMotion.includes('68%{'), false);
});


test('operator can tap or click the cinematic intro to open the information card immediately', () => {
  assert.ok(mural.includes('role="button"'));
  assert.ok(mural.includes('tabIndex={0}'));
  assert.ok(mural.includes('onClick={finishIntro}'));
  assert.ok(mural.includes("event.key !== 'Enter' && event.key !== ' '"));
  assert.ok(mural.includes('finishIntro();'));
  assert.ok(css.includes('cursor:pointer'));
  assert.ok(css.includes('touch-action:manipulation'));
});


test('collection cinematic intro runs lightweight confetti and sparkle effects until it closes', () => {
  assert.ok(mural.includes('mural-collection-party-effects'));
  assert.ok(mural.includes('Array.from({ length: 28 }'));
  assert.ok(mural.includes('mural-collection-party-particle'));
  assert.ok(mural.includes("is-sparkle"));
  assert.ok(css.includes('@keyframes mural-collection-party-fall'));
  assert.ok(css.includes('animation:mural-collection-party-fall'));
  assert.ok(css.includes('pointer-events:none'));
  assert.ok(css.includes('will-change:transform,opacity'));
});

test('party effects stop automatically when intro unmounts and are disabled for reduced motion', () => {
  assert.ok(mural.includes('onClick={finishIntro}'));
  assert.ok(css.includes('.mural-collection-party-effects{'));
  assert.ok(css.includes('display:none!important'));
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
});
