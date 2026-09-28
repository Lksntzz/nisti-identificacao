import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hammingDistance,
  estimateHomography,
  projectPoint,
  ransacHomography,
  extractOrbLikeFeatures,
  verifyGeometricMatch
} from '../public/geometric-core.js';

test('Geometric Core: Hamming distance counts descriptor bit differences', () => {
  assert.equal(
    hammingDistance(Uint8Array.from([0x00, 0xff]), Uint8Array.from([0xff, 0xff])),
    8
  );
});

test('Geometric Core: homography recovers a projective mapping', () => {
  const expected = [1.08, 0.07, 11, -0.03, 0.94, 9, 0.00035, -0.00022, 1];
  const points = [[0,0],[120,0],[120,90],[0,90],[35,18],[85,22],[28,70],[93,65]];
  const pairs = points.map(([x,y]) => ({ from: { x, y }, to: projectPoint(expected, { x, y }) }));
  const actual = estimateHomography(pairs);
  assert.ok(actual);
  for (const pair of pairs) {
    const projected = projectPoint(actual, pair.from);
    assert.ok(Math.hypot(projected.x - pair.to.x, projected.y - pair.to.y) < 1e-4);
  }
});

test('Geometric Core: RANSAC keeps projective inliers and rejects outliers', () => {
  const expected = [1.02, 0.04, 7, -0.02, 0.98, 6, 0.0002, -0.00015, 1];
  const points = [[0,0],[100,0],[100,80],[0,80],[20,20],[50,20],[80,20],[20,60],[50,60],[80,60]];
  const pairs = points.map(([x,y]) => ({ from:{x,y}, to:projectPoint(expected,{x,y}) }));
  pairs.push(
    { from:{x:10,y:10}, to:{x:240,y:180} },
    { from:{x:90,y:10}, to:{x:5,y:170} },
    { from:{x:50,y:40}, to:{x:260,y:10} }
  );
  const result = ransacHomography(pairs, { ransacIterations: 900, reprojectionThreshold: 2.5 });
  assert.equal(result.valid, true);
  assert.ok(result.inliers >= 10);
  assert.ok(result.inlierRatio >= 10 / 13);
});

test('Geometric Core: identical textured art produces a valid geometric match', () => {
  const width = 180;
  const height = 140;
  const gray = new Uint8Array(width * height);
  let state = 0x12345678;
  for (let i = 0; i < gray.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    gray[i] = state >>> 24;
  }
  const features = extractOrbLikeFeatures(gray, width, height, {
    fastThreshold: 12,
    maxFeatures: 260,
    scales: [1, 0.72]
  });
  assert.ok(features.length >= 100);
  const result = verifyGeometricMatch(features, features, {
    referenceWidth: width,
    referenceHeight: height
  }, {
    minGoodMatches: 8,
    minInliers: 6,
    minInlierRatio: 0.25,
    minCoverage: 0.01,
    ratioThreshold: 0.82,
    maxHamming: 96,
    ransacIterations: 300
  });
  assert.equal(result.valid, true);
  assert.ok(result.inliers >= 50);
});
