import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');

test('motion part 4 keeps dialogs mounted long enough to animate their exit', () => {
  assert.ok(mural.includes('function useAnimatedDialogClose(onClose, duration = 180)'));
  assert.ok(mural.includes('setClosing(true)'));
  assert.ok(mural.includes('window.setTimeout(onClose, duration)'));
  assert.ok(mural.includes("mural-modal-backdrop${closing ? ' is-closing' : ''}"));
  assert.ok(mural.includes('disabled={closing}'));
});

test('motion part 4 animates backdrop, sheet and content on entry and exit', () => {
  assert.ok(css.includes('@keyframes mural-modal-backdrop-in'));
  assert.ok(css.includes('@keyframes mural-modal-backdrop-out'));
  assert.ok(css.includes('@keyframes mural-detail-sheet-in'));
  assert.ok(css.includes('@keyframes mural-detail-sheet-out'));
  assert.ok(css.includes('@keyframes mural-detail-content-in'));
  assert.ok(css.includes('.mural-modal-backdrop.is-closing .mural-detail'));
});

test('motion part 4 closes consistently from escape, backdrop and close button', () => {
  assert.ok(mural.includes("event.key === 'Escape') requestClose()"));
  assert.ok(mural.includes('event.target === event.currentTarget && requestClose()'));
  assert.ok(mural.includes('onClick={requestClose}'));
});

test('motion part 4 respects reduced motion and preserves the public Em breve gate', () => {
  assert.ok(css.includes('.mural-modal-backdrop.is-closing,'));
  assert.ok(css.includes('animation:none!important'));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
