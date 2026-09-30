import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('motion part 2 slides one shared indicator across the four filters', () => {
  assert.ok(mural.includes("const activeTabIndex = Math.max(0, TABS.findIndex"));
  assert.ok(mural.includes("style={{ '--mural-tab-index': activeTabIndex }}"));
  assert.ok(mural.includes('mural-tabs-indicator'));
  assert.ok(css.includes('translateX(calc(var(--mural-tab-index, 0) * (100% + var(--mural-tab-gap))))'));
  assert.ok(css.includes('transition: transform 320ms var(--mural-ease-out)'));
});

test('motion part 2 adds one-shot microinteractions to filter icons', () => {
  assert.ok(mural.includes('mural-tab-icon mural-tab-icon-${value}'));
  for (const value of ['all', 'products', 'collections', 'notices']) {
    assert.ok(css.includes(`.mural-tab-icon-${value}`));
  }
  assert.ok(css.includes('@keyframes mural-tab-spark'));
  assert.ok(css.includes('@keyframes mural-tab-product'));
  assert.ok(css.includes('@keyframes mural-tab-collection'));
  assert.ok(css.includes('@keyframes mural-tab-notice'));
});

test('motion part 2 respects reduced motion for tabs', () => {
  assert.ok(css.includes('.mural-tabs-indicator,'));
  assert.ok(css.includes('.mural-tab-icon,'));
  assert.ok(css.includes('.mural-tab-icon{transform:none!important}'));
});
