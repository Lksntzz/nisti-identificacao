import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __muralTransparentImageInternals } from '../src/mural-transparent-image.js';

const source = fs.readFileSync(new URL('../src/mural-transparent-image.js', import.meta.url), 'utf8');

test('MKP masks discard gray PSD matte while preserving the near-white silhouette', () => {
  const { normalizeMkpMaskValue } = __muralTransparentImageInternals;
  assert.equal(normalizeMkpMaskValue(0), 0);
  assert.equal(normalizeMkpMaskValue(184), 0);
  assert.equal(normalizeMkpMaskValue(216), 0);
  assert.equal(normalizeMkpMaskValue(235), 0);
  assert.ok(normalizeMkpMaskValue(245) > 150);
  assert.equal(normalizeMkpMaskValue(250), 255);
  assert.equal(normalizeMkpMaskValue(255), 255);
});

test('automatic treatment uses MKP body masks plus source wire-o recovery for registered square planners', () => {
  assert.match(source, /const MKP_PRODUCT_MASKS/);
  assert.match(source, /wire_branco_com_tassel\.png/);
  assert.match(source, /wire_branco_sem_tassel\.png/);
  assert.match(source, /wire_preto_sem_tassel\.png/);
  assert.match(source, /wire_gold_com_tassel\.png/);
  assert.match(source, /function buildMkpProductAlpha/);
  assert.match(source, /applyMkpProductAlpha\(data, mkpAlpha\)/);
  assert.match(source, /function removeConnectedStudioBackground/);
});

test('background removal protects white and off-white covers with a physical-edge barrier', () => {
  assert.match(source, /brightness >= minimumBrightness && chroma <= 26/);
  assert.match(source, /estimateBorderBackgroundBrightness/);
  assert.match(source, /function hasLocalProductEdge/);
  assert.match(source, /if \(delta >= 14\) return true/);
  assert.match(source, /if \(hasLocalProductEdge\(data, width, height, index\)\) return/);
  assert.match(source, /function protectedSubjectCoverage/);
  assert.match(source, /function isDeepProtectedSubjectPixel/);
  assert.match(source, /isDeepProtectedSubjectPixel\(isProtectedSubjectPixel, width, height, x, y\)/);
  assert.match(source, /if \(subjectCoverage < \.82\) return src/);
  assert.match(source, /productStats\.ratio < \.055/);
});

test('only images with real transparent borders skip background cleanup', () => {
  assert.match(source, /function hasExistingTransparency/);
  assert.match(source, /function hasUsableTransparentBorder/);
  assert.match(source, /transparent \/ sampled >= 0\.18/);
  assert.match(source, /const sourceAlreadyCutOut = hasExistingTransparency\(data, total\)[\s\S]*&& hasUsableTransparentBorder\(data, width, height\)/);
  assert.match(source, /if \(sourceAlreadyCutOut && !options\.forceOutline\) return src/);
});

test('light cover artwork is protected by a solid linear convex silhouette', () => {
  assert.match(source, /function buildSubjectProtection/);
  assert.match(source, /function buildDominantForegroundGrid/);
  assert.match(source, /function convexHull/);
  assert.match(source, /return brightness < 185 \|\| chroma > 24/);
  assert.match(source, /dominant\.labels/);
  assert.match(source, /const expandedHull = hull\.map/);
  assert.match(source, /protectedMin\[y\]/);
  assert.match(source, /protectedMax\[y\]/);
  assert.match(source, /const subjectEvidence = buildSubjectProtection/);
});

test('unsafe mostly-white products keep their original source instead of being damaged', () => {
  assert.match(source, /if \(hull\.length < 3\) return null/);
  assert.match(source, /if \(!subjectEvidence\) return src/);
});

test('white agenda body between wire-o and elastic stays protected', () => {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  const paint = (fromX, toX, fromY, toY, color) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };

  paint(18, 24, 15, 85, [20, 20, 20]); // wire-o side
  paint(80, 84, 14, 87, [25, 25, 25]); // elastic side
  paint(22, 80, 34, 72, [225, 80, 120]); // cover artwork connects both edges

  const protect = __muralTransparentImageInternals.buildSubjectProtection(data, width, height);
  assert.ok(protect);
  assert.equal(protect(50, 50), true);
  assert.equal(protect(30, 50), true);
  assert.equal(protect(74, 50), true);
  assert.equal(protect(6, 50), false);
});


test('outline keeps the product and nearby detached wire-o while filling internal holes', () => {
  assert.match(source, /function buildProductComponentsMask/);
  assert.match(source, /const closeToMainProduct/);
  assert.match(source, /const anotherLargeProduct/);
  assert.match(source, /function fillMaskInteriorHoles/);
  assert.match(source, /if \(!mask\[index\] && !outside\[index\]\) solid\[index\] = 1/);
});

test('outline is only the external white ring and rejects background-sized masks', () => {
  assert.match(source, /function dilateMask/);
  assert.match(source, /function maskStats/);
  assert.match(source, /if \(stats\.ratio > \.82 \|\| stats\.touches >= 3\) return ''/);
  assert.match(source, /const radius = clamp\(Math\.round\(Math\.max\(width, height\) \* \(5 \/ 1024\)\), 4, 7\)/);
  assert.match(source, /const outlineMask = buildExternalOutlineRing\(mainMask, width, height, radius\)/);
  assert.match(source, /if \(!outlineMask\[index\]\) continue/);
  assert.match(source, /outlineData\.data\[offset\] = 255/);
  assert.match(source, /export function useTransparentProductOutline/);
});

test('external outline leaves closed wire-o gaps transparent', () => {
  const width = 15;
  const height = 15;
  const mask = new Uint8Array(width * height);
  for (let x = 4; x <= 10; x += 1) {
    mask[4 * width + x] = 1;
    mask[10 * width + x] = 1;
  }
  for (let y = 4; y <= 10; y += 1) {
    mask[y * width + 4] = 1;
    mask[y * width + 10] = 1;
  }

  const outline = __muralTransparentImageInternals.buildExternalOutlineRing(mask, width, height, 2);
  assert.equal(outline[7 * width + 7], 0, 'wire-o interior remains transparent');
  assert.equal(outline[2 * width + 7], 1, 'external edge receives the white ring');
  assert.equal(outline[4 * width + 7], 0, 'product pixels are never painted over');
});

test('outline follows detached wire-o details but ignores an isolated corner logo', () => {
  const width = 120;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (fromX, toX, fromY, toY) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }
  };

  paint(35, 94, 12, 91); // agenda body
  paint(29, 32, 24, 28); // detached wire-o near the agenda
  paint(29, 32, 42, 46);
  paint(4, 14, 4, 10); // detached logo in the corner

  const mask = __muralTransparentImageInternals.buildProductComponentsMask(data, width, height);
  assert.ok(mask);
  assert.equal(mask[50 * width + 60], 1);
  assert.equal(mask[26 * width + 30], 1);
  assert.equal(mask[7 * width + 8], 0);
});

test('detached corner logo cannot stretch the dominant agenda silhouette', () => {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  const paint = (fromX, toX, fromY, toY, color) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };

  paint(28, 76, 14, 88, [220, 80, 120]);
  paint(4, 10, 4, 10, [20, 20, 20]);
  const protect = __muralTransparentImageInternals.buildSubjectProtection(data, width, height);
  assert.ok(protect);
  assert.equal(protect(50, 50), true);
  assert.equal(protect(7, 7), false);

  __muralTransparentImageInternals.clearOutsideSubject(data, width, height, protect);
  assert.equal(data[(50 * width + 50) * 4 + 3], 255);
  assert.equal(data[(7 * width + 7) * 4 + 3], 0);
});


test('global treated product image bakes the approved thicker white outline into transparent PNG', () => {
  assert.match(source, /async function buildTreatedProductImage/);
  assert.match(source, /outlineScale:5 \/ 1024/);
  assert.match(source, /preciseOutlineScale:5 \/ 1024/);
  assert.match(source, /MKP_OUTLINE_SCALE = 5 \/ 1024/);
  assert.match(source, /MKP_PRECISE_OUTLINE_SCALE = 5 \/ 1024/);
  assert.match(source, /clamp\(Math\.round\(Math\.max\(width, height\) \* outlineScale\), 4, 7\)/);
  assert.match(source, /const padding = outlineRadius \+ 2/);
  assert.match(source, /if \(!outlineMask\[sourceIndex\]\) continue/);
  assert.match(source, /outputContext\.drawImage\(sourceCanvas, padding, padding\)/);
  assert.match(source, /export function useTreatedProductImage/);
});

test('automatic cutout no longer hard-clips pixels to the convex hull plate', () => {
  const buildStart = source.indexOf('async function buildTransparentProductImage');
  const buildEnd = source.indexOf('export async function transparentProductImageUrl');
  const buildSource = source.slice(buildStart, buildEnd);
  assert.equal(buildSource.includes('clearOutsideSubject(data, width, height'), false);
  assert.match(buildSource, /const keepMask = dilateMask\(productMask, width, height, 1\)/);
});


test('local edge barrier blocks a near-white background flood at a white product edge', () => {
  const width = 9;
  const height = 9;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }

  // Simulate the subtle physical edge of a white agenda.
  for (let y = 1; y < 8; y += 1) {
    const offset = (y * width + 3) * 4;
    data[offset] = 232;
    data[offset + 1] = 232;
    data[offset + 2] = 232;
  }

  assert.equal(__muralTransparentImageInternals.hasLocalProductEdge(data, width, height, 2 * width + 2), true);
  assert.equal(__muralTransparentImageInternals.hasLocalProductEdge(data, width, height, 0), false);
});

test('coverage guard detects when a light product body was accidentally removed', () => {
  const width = 10;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data[index * 4 + 3] = 255;
  const protectedArea = (x, y) => x >= 2 && x <= 7 && y >= 2 && y <= 7;

  assert.equal(__muralTransparentImageInternals.protectedSubjectCoverage(data, width, height, protectedArea), 1);

  for (let y = 2; y <= 7; y += 1) {
    for (let x = 2; x <= 6; x += 1) data[(y * width + x) * 4 + 3] = 0;
  }

  assert.ok(__muralTransparentImageInternals.protectedSubjectCoverage(data, width, height, protectedArea) < .72);
});


test('deep product core is protected even when its pixels are pure white', () => {
  const width = 100;
  const height = 100;
  const subject = (x, y) => x >= 20 && x <= 80 && y >= 15 && y <= 85;

  assert.equal(__muralTransparentImageInternals.isDeepProtectedSubjectPixel(subject, width, height, 50, 50), true);
  assert.equal(__muralTransparentImageInternals.isDeepProtectedSubjectPixel(subject, width, height, 21, 50), false);
  assert.equal(__muralTransparentImageInternals.isDeepProtectedSubjectPixel(subject, width, height, 50, 16), false);
});


function plannerFixture(width = 160, height = 220) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  const paint = (fromX, toX, fromY, toY, color) => {
    for (let y = fromY; y <= toY; y += 1) {
      for (let x = fromX; x <= toX; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };

  paint(19, 25, 40, 180, [25, 25, 25]); // real wire-o/details on the left
  paint(48, 112, 45, 175, [220, 92, 120]); // cover artwork
  paint(126, 132, 25, 198, [70, 170, 185]); // elastic/page edge anchor
  return { data, width, height };
}

test('approved planner reference aligns from real image anchors instead of a convex-hull rectangle', () => {
  const fixture = plannerFixture();
  const bounds = __muralTransparentImageInternals.buildPlannerReferenceBounds(
    fixture.data,
    fixture.width,
    fixture.height
  );
  const template = __muralTransparentImageInternals.buildPlannerStructureProtection(
    fixture.data,
    fixture.width,
    fixture.height
  );

  assert.ok(bounds);
  assert.ok(template);
  assert.equal(template(82, 110), true, 'white cover body must stay protected');
  assert.equal(template(82, 110), true, 'central white cover core must stay protected');
  assert.equal(template(3, 110), false, 'outside background must remain removable');
});

test('planner template is not applied to unrelated wide products', () => {
  const width = 220;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  for (let y = 35; y <= 65; y += 1) {
    for (let x = 10; x <= 210; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 20;
      data[offset + 1] = 20;
      data[offset + 2] = 20;
    }
  }

  assert.equal(
    __muralTransparentImageInternals.buildPlannerStructureProtection(data, width, height),
    null
  );
});

test('planner cutout removes only border-connected studio background', () => {
  const fixture = plannerFixture();
  const template = __muralTransparentImageInternals.buildPlannerStructureProtection(
    fixture.data, fixture.width, fixture.height
  );
  assert.ok(template);
  const result = __muralTransparentImageInternals.removeConnectedStudioBackground(
    fixture.data, fixture.width, fixture.height, template
  );
  assert.ok(result.removed > 0);
  assert.equal(fixture.data[(110 * fixture.width + 82) * 4 + 3], 255);
  assert.equal(fixture.data[(110 * fixture.width + 3) * 4 + 3], 0);
  assert.equal(fixture.data[(100 * fixture.width + 22) * 4 + 3], 255);
});

test('geometry-aware cutout protects the body but traces the real source pixels', () => {
  const buildStart = source.indexOf('async function buildTransparentProductImage');
  const buildEnd = source.indexOf('async function buildTreatedProductImage');
  const buildSource = source.slice(buildStart, buildEnd);
  assert.match(buildSource, /const geometry = classifyProductGeometry/);
  assert.match(buildSource, /const structureProtection = buildGeometryProtection/);
  assert.match(buildSource, /removeConnectedStudioBackground\(data, width, height, structureProtection\)/);
  assert.match(buildSource, /buildProductComponentsMask\(data, width, height/);
  assert.match(buildSource, /preserveAccessory/);
  assert.equal(buildSource.includes('applyOfficialProductMask'), false);
  assert.equal(buildSource.includes('applyPlannerStructureMask'), false);
});


test('registered wire-o is recovered from the original source instead of being clipped by a fixed MKP mask', () => {
  const width = 160;
  const height = 220;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }

  // Planner body starts at x=48. The fixed mask deliberately contains only
  // the body, reproducing the failure where the real binding was erased.
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 25; y <= 198; y += 1) {
    for (let x = 48; x <= 132; x += 1) alpha[y * width + x] = 255;
  }

  // Repeated dark reflections of a white/silver wire-o. The pale parts around
  // them are intentionally the same white as the studio background.
  for (const y of [42, 64, 86, 108, 130, 152, 174]) {
    for (let yy = y; yy <= y + 3; yy += 1) {
      for (let x = 35; x <= 41; x += 1) {
        const offset = (yy * width + x) * 4;
        data[offset] = 45;
        data[offset + 1] = 45;
        data[offset + 2] = 45;
      }
    }
  }

  const bounds = { minX:32, maxX:136, minY:20, maxY:202, width:104, height:182 };
  const recovery = __muralTransparentImageInternals.buildWireoRecoveryMask(
    data, width, height, bounds
  );
  assert.ok(recovery);
  assert.equal(recovery[65 * width + 38], 1, 'wire-o evidence is recovered');
  assert.equal(recovery[110 * width + 10], 0, 'far background is never recovered');

  const merged = data.slice();
  assert.equal(
    __muralTransparentImageInternals.mergeMkpAlphaWithWireo(merged, alpha, recovery),
    true
  );
  assert.equal(merged[(65 * width + 38) * 4 + 3], 255, 'wire-o survives MKP alpha');
  assert.equal(merged[(110 * width + 10) * 4 + 3], 0, 'background remains transparent');
});

test('wire-o metadata activates accessory preservation even without a tassel', () => {
  const { hasRegisteredWireo } = __muralTransparentImageInternals;
  assert.equal(hasRegisteredWireo({ wireoCode:'B', tasselCode:'X' }), true);
  assert.equal(hasRegisteredWireo({ wireoCode:'P', tasselCode:'X' }), true);
  assert.equal(hasRegisteredWireo({ wireoCode:'R', tasselCode:'X' }), true);
  assert.equal(hasRegisteredWireo({ wireoCode:'', tasselCode:'X' }), false);
  assert.match(source, /const wireoRecoveryMask = plannerBounds/);
  assert.match(source, /applyMkpProductAlpha\(data, mkpAlpha, wireoRecoveryMask\)/);
  assert.match(source, /\|\| hasRegisteredWireo\(options\)/);
});
