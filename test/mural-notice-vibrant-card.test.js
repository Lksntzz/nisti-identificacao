import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const jsx = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('Mural notice card uses isolated purple-and-gold megaphone emblem', () => {
  const start = jsx.indexOf('export function MuralCard(');
  const end = jsx.indexOf('export function ', start + 20);
  const card = jsx.slice(start, end < 0 ? undefined : end);
  assert.match(card, /isNotice \? \(/);
  assert.match(card, /mural-notice-visual-vibrant/);
  assert.match(card, /mural-notice-icon-emblem/);
  assert.match(card, /MuralIcon name="megaphone" size=\{40\}/);
  assert.match(card, /mural-notice-accent-star/);
  assert.match(card, /\{isNotice \? 'NOVIDADE' : 'NOVO'\}/);
  assert.match(card, /mural-card-notice-pill/);
  assert.match(card, /onClick=\{\(\) => onOpen\?\.\(item\)\}/);
  assert.match(card, /<MuralImage item=\{item\} eager=\{eager\} className="mural-card-image"/);
});

test('Notice-only CSS preserves editorial contrast and separate important-alert severity', () => {
  assert.match(css, /\.mural-card-reference \.mural-card-media\.mural-notice-visual-vibrant/);
  assert.match(css, /#4b279a/);
  assert.match(css, /#ffe28c/);
  assert.match(css, /\.mural-notice-icon-emblem svg/);
  assert.match(css, /\.mural-card-reference\.mural-card-notice \.mural-card-new-pill/);
  assert.match(css, /\.mural-card-reference\.mural-card-notice \.mural-card-notice-pill:not\(\.is-important\)/);
  assert.match(css, /\.mural-card-notice-pill\.is-important/);
  assert.match(css, /@media \(max-width:390px\)/);
});

test('Notice changes never change the operator Mural release gate', () => {
  const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
  assert.match(router, /const MURAL_PUBLIC_RELEASED = true;/);
});
