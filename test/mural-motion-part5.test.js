import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const experience = fs.readFileSync(new URL('../src/mural-product-experience.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');

test('motion part 5 keeps one WebGL context while narrative steps change', () => {
  assert.ok(experience.includes('const activeStepRef = useRef(activeStep)'));
  assert.ok(experience.includes('activeStepRef.current = activeStep'));
  assert.ok(experience.includes('const step = activeStepRef.current'));
  assert.ok(experience.includes('}, [imageUrl]);'));
  assert.equal(experience.includes('}, [imageUrl, activeStep]);'), false);
});

test('motion part 5 returns manual drag toward the story-driven orientation', () => {
  assert.ok(experience.includes('if (!drag.active)'));
  assert.ok(experience.includes('drag.rx *= 0.94'));
  assert.ok(experience.includes('drag.ry *= 0.94'));
});

test('motion part 5 adds visible and semantic story progression', () => {
  assert.ok(experience.includes('mural-product-story-progress'));
  assert.ok(experience.includes("className={index === activeStep ? 'active' : index < activeStep ? 'complete' : ''}"));
  assert.ok(experience.includes("aria-current={activeStep === index ? 'step' : undefined}"));
  assert.ok(css.includes('.mural-product-story-progress span.active'));
  assert.ok(css.includes('.mural-product-story-step[aria-current="step"]>span'));
});

test('motion part 5 uses precise WebGL wording and respects reduced motion', () => {
  assert.ok(experience.includes('Visualização interativa em perspectiva de'));
  assert.equal(experience.includes('Visualização 3D interativa de'), false);
  assert.ok(css.includes('.mural-product-story-progress span,'));
  assert.ok(css.includes('transition:none!important'));
});

test('motion part 5 preserves the public Em breve gate', () => {
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
