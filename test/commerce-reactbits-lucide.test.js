import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const styles=fs.readFileSync('src/commerce-reactbits-lucide.css','utf8');
const lucide=fs.readFileSync('src/vendor/CommercialIcon.jsx','utf8');
const glare=fs.readFileSync('src/vendor/react-bits/GlareHover.jsx','utf8');
const notices=fs.readFileSync('src/vendor/THIRD_PARTY_NOTICES.txt','utf8');

test('React Bits GlareHover é integrado sem substituir botões e dados',()=>{
  assert.match(manager,/import GlareHover from '\.\/vendor\/react-bits\/GlareHover\.jsx'/);
  assert.match(manager,/const child=<GlareHover/);
  assert.match(manager,/aria-pressed=\{Boolean\(selected\)\}/);
  assert.match(manager,/label="Anúncios ativos"/);
  assert.match(manager,/label="Em queda"/);
  assert.match(manager,/value=\{trendAvailable\?num\(trendCounts\.falling\):'—'\}/);
  assert.match(glare,/prefers-reduced-motion: reduce/);
  assert.match(glare,/ResizeObserver/);
  assert.match(notices,/MIT \+ Commons Clause/);
});

test('ícones são vetores Lucide oficiais, sem dependências externas',()=>{
  assert.match(lucide,/Lucide Icons & Contributors/);
  for(const icon of ['megaphone','shopping-cart','circle-alert','trending-up','trending-down','refresh-cw','upload','calendar-days','notebook-tabs'])
    assert.ok(lucide.includes('"'+icon+'"'),icon);
  assert.match(manager,/<CommercialIcon name="refresh-cw"/);
  assert.match(evolution,/CommerceEvolutionProductThumbnail/);
  assert.match(fs.readFileSync('src/commerce-evolution-product-thumbnail.jsx','utf8'),/<CommercialIcon name="notebook-tabs"/);
  assert.match(evolution,/<CommercialIcon name="trending-down"/);
  assert.match(notices,/ISC License/);
});

test('nomes legíveis em duas linhas e layout compatível com telas menores',()=>{
  assert.match(styles,/-webkit-line-clamp:2/);
  assert.match(styles,/font-size:12\.5px/);
  assert.match(styles,/@media\(max-width:1050px\)/);
  assert.match(styles,/@media\(max-width:700px\)/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(evolution,/<summary className="nim-evolution-product-head"/);
  assert.match(evolution,/item\.listing_id/);
  assert.doesNotMatch(evolution,/src="https:\/\//);
});
