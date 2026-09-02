const DEFAULTS = Object.freeze({
  maxFeatures: 650,
  fastThreshold: 18,
  briefBytes: 32,
  patchRadius: 15,
  ratioThreshold: 0.78,
  maxHamming: 92,
  ransacIterations: 700,
  reprojectionThreshold: 5.5,
  minGoodMatches: 10,
  minInliers: 7,
  minInlierRatio: 0.28,
  minCoverage: 0.025,
});

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sq(v) { return v * v; }

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const POPCOUNT = (() => {
  const table = new Uint8Array(256);
  for (let i = 1; i < 256; i++) table[i] = table[i >> 1] + (i & 1);
  return table;
})();

function buildBriefPattern(bytes = DEFAULTS.briefBytes, radius = 12) {
  const rand = lcg(0x4e495354);
  const out = new Int8Array(bytes * 8 * 4);
  for (let i = 0; i < bytes * 8; i++) {
    for (let p = 0; p < 2; p++) {
      let x, y;
      do {
        x = Math.round((rand() * 2 - 1) * radius);
        y = Math.round((rand() * 2 - 1) * radius);
      } while (x * x + y * y > radius * radius || (x === 0 && y === 0));
      const o = i * 4 + p * 2;
      out[o] = x;
      out[o + 1] = y;
    }
  }
  return out;
}

const BRIEF_PATTERN = buildBriefPattern();

export function rgbaToGray(rgba, width, height) {
  const total = width * height;
  if (!rgba || rgba.length < total * 4) throw new Error('rgba buffer too small');
  const gray = new Uint8Array(total);
  for (let i = 0, p = 0; i < total; i++, p += 4) {
    gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return gray;
}

export function resizeGrayBilinear(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return new Uint8Array(src);
  const dst = new Uint8Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = (y + 0.5) * sy - 0.5;
    const y0 = clamp(Math.floor(fy), 0, sh - 1);
    const y1 = clamp(y0 + 1, 0, sh - 1);
    const wy = fy - Math.floor(fy);
    for (let x = 0; x < dw; x++) {
      const fx = (x + 0.5) * sx - 0.5;
      const x0 = clamp(Math.floor(fx), 0, sw - 1);
      const x1 = clamp(x0 + 1, 0, sw - 1);
      const wx = fx - Math.floor(fx);
      const a = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const b = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      dst[y * dw + x] = Math.round(a * (1 - wy) + b * wy);
    }
  }
  return dst;
}

function circleOffsets(width) {
  const pts = [
    [0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],
    [0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]
  ];
  return pts.map(([x,y]) => y * width + x);
}

function hasFastArc(gray, centerIdx, offsets, threshold) {
  const c = gray[centerIdx];
  let bright = 0, dark = 0;
  for (let i = 0; i < 24; i++) {
    const v = gray[centerIdx + offsets[i & 15]];
    if (v >= c + threshold) bright++; else bright = 0;
    if (v <= c - threshold) dark++; else dark = 0;
    if (bright >= 9 || dark >= 9) return true;
  }
  return false;
}

function cornerScore(gray, centerIdx, offsets) {
  const c = gray[centerIdx];
  let score = 0;
  for (let i = 0; i < 16; i++) score += Math.abs(gray[centerIdx + offsets[i]] - c);
  return score;
}

export function detectFastCorners(gray, width, height, options = {}) {
  const threshold = options.fastThreshold ?? DEFAULTS.fastThreshold;
  const maxFeatures = options.maxFeatures ?? DEFAULTS.maxFeatures;
  const border = Math.max(16, options.border ?? DEFAULTS.patchRadius + 2);
  const offsets = circleOffsets(width);
  const scoreMap = new Float32Array(width * height);
  const raw = [];

  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      const idx = y * width + x;
      if (!hasFastArc(gray, idx, offsets, threshold)) continue;
      const score = cornerScore(gray, idx, offsets);
      scoreMap[idx] = score;
      raw.push({ x, y, score });
    }
  }

  const nms = [];
  for (const kp of raw) {
    const idx = kp.y * width + kp.x;
    let keep = true;
    for (let dy = -1; dy <= 1 && keep; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (scoreMap[idx + dy * width + dx] > kp.score) { keep = false; break; }
      }
    }
    if (keep) nms.push(kp);
  }

  nms.sort((a,b) => b.score - a.score);
  return nms.slice(0, maxFeatures);
}

function orientation(gray, width, x, y, radius = 8) {
  let m10 = 0, m01 = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const v = gray[(y + dy) * width + (x + dx)];
      m10 += dx * v;
      m01 += dy * v;
    }
  }
  return Math.atan2(m01, m10);
}

function briefDescriptor(gray, width, height, kp, pattern = BRIEF_PATTERN) {
  const bytes = pattern.length / 32;
  const desc = new Uint8Array(bytes);
  const a = orientation(gray, width, kp.x, kp.y);
  const ca = Math.cos(a), sa = Math.sin(a);
  for (let bit = 0; bit < bytes * 8; bit++) {
    const o = bit * 4;
    const ax = pattern[o], ay = pattern[o + 1], bx = pattern[o + 2], by = pattern[o + 3];
    const x1 = clamp(Math.round(kp.x + ax * ca - ay * sa), 0, width - 1);
    const y1 = clamp(Math.round(kp.y + ax * sa + ay * ca), 0, height - 1);
    const x2 = clamp(Math.round(kp.x + bx * ca - by * sa), 0, width - 1);
    const y2 = clamp(Math.round(kp.y + bx * sa + by * ca), 0, height - 1);
    if (gray[y1 * width + x1] < gray[y2 * width + x2]) desc[bit >> 3] |= 1 << (bit & 7);
  }
  return desc;
}

export function extractOrbLikeFeatures(gray, width, height, options = {}) {
  const scales = options.scales || [1, 0.75, 0.55];
  const maxFeatures = options.maxFeatures ?? DEFAULTS.maxFeatures;
  const perLevel = Math.max(80, Math.ceil(maxFeatures / scales.length));
  const features = [];

  for (let level = 0; level < scales.length; level++) {
    const scale = scales[level];
    const lw = Math.max(40, Math.round(width * scale));
    const lh = Math.max(40, Math.round(height * scale));
    const img = scale === 1 ? gray : resizeGrayBilinear(gray, width, height, lw, lh);
    const corners = detectFastCorners(img, lw, lh, { ...options, maxFeatures: perLevel });
    for (const kp of corners) {
      features.push({
        x: kp.x / scale,
        y: kp.y / scale,
        score: kp.score,
        level,
        scale,
        descriptor: briefDescriptor(img, lw, lh, kp)
      });
    }
  }

  features.sort((a,b) => b.score - a.score);
  return features.slice(0, maxFeatures);
}

export function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[a[i] ^ b[i]];
  return d;
}

export function matchFeatures(query, train, options = {}) {
  const ratioThreshold = options.ratioThreshold ?? DEFAULTS.ratioThreshold;
  const maxHamming = options.maxHamming ?? DEFAULTS.maxHamming;
  if (!query.length || train.length < 2) return [];

  const forward = [];
  for (let qi = 0; qi < query.length; qi++) {
    let best = Infinity, second = Infinity, bestTi = -1;
    for (let ti = 0; ti < train.length; ti++) {
      const d = hammingDistance(query[qi].descriptor, train[ti].descriptor);
      if (d < best) { second = best; best = d; bestTi = ti; }
      else if (d < second) second = d;
    }
    if (bestTi >= 0 && best <= maxHamming && best < second * ratioThreshold) {
      forward.push({ query_idx: qi, train_idx: bestTi, distance: best });
    }
  }

  const reverseBest = new Int32Array(train.length);
  reverseBest.fill(-1);
  for (let ti = 0; ti < train.length; ti++) {
    let best = Infinity, bestQi = -1;
    for (let qi = 0; qi < query.length; qi++) {
      const d = hammingDistance(train[ti].descriptor, query[qi].descriptor);
      if (d < best) { best = d; bestQi = qi; }
    }
    reverseBest[ti] = bestQi;
  }

  return forward.filter(m => reverseBest[m.train_idx] === m.query_idx);
}

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = Array.from({ length: n }, (_, r) => {
    const row = new Float64Array(n + 1);
    for (let c = 0; c < n; c++) row[c] = A[r][c];
    row[n] = b[r];
    return row;
  });

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    if (pivot !== col) [M[pivot], M[col]] = [M[col], M[pivot]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (Math.abs(f) < 1e-14) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return Float64Array.from(M, row => row[n]);
}

export function estimateHomography(pairs) {
  if (!pairs || pairs.length < 4) return null;
  const ATA = Array.from({ length: 8 }, () => new Float64Array(8));
  const ATb = new Float64Array(8);

  for (const p of pairs) {
    const x = p.from.x, y = p.from.y, u = p.to.x, v = p.to.y;
    const r1 = [x, y, 1, 0, 0, 0, -u * x, -u * y];
    const r2 = [0, 0, 0, x, y, 1, -v * x, -v * y];
    for (let i = 0; i < 8; i++) {
      ATb[i] += r1[i] * u + r2[i] * v;
      for (let j = 0; j < 8; j++) ATA[i][j] += r1[i] * r1[j] + r2[i] * r2[j];
    }
  }

  const h = solveLinearSystem(ATA, ATb);
  if (!h) return null;
  return Float64Array.from([h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]);
}

export function projectPoint(H, p) {
  const den = H[6] * p.x + H[7] * p.y + H[8];
  if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return null;
  const x = (H[0] * p.x + H[1] * p.y + H[2]) / den;
  const y = (H[3] * p.x + H[4] * p.y + H[5]) / den;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function sample4(rand, n) {
  const s = new Set();
  while (s.size < 4) s.add(Math.floor(rand() * n));
  return [...s];
}

function pointSetArea(points) {
  if (points.length < 3) return 0;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const p of points) { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y); maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); }
  return Math.max(0, (maxX-minX)*(maxY-minY));
}

export function ransacHomography(pairs, options = {}) {
  if (!pairs || pairs.length < 4) return { valid:false, H:null, inlierIndices:[], inliers:0, inlierRatio:0 };
  const iterations = options.ransacIterations ?? DEFAULTS.ransacIterations;
  const threshold = options.reprojectionThreshold ?? DEFAULTS.reprojectionThreshold;
  const threshold2 = threshold * threshold;
  const rand = lcg((0x9e3779b9 ^ pairs.length ^ Math.round(pairs[0].from.x * 31 + pairs[0].to.y * 17)) >>> 0);
  let best = [];
  let bestError = Infinity;
  let bestH = null;

  for (let iter = 0; iter < iterations; iter++) {
    const idx = sample4(rand, pairs.length);
    const seedPairs = idx.map(i => pairs[i]);
    if (pointSetArea(seedPairs.map(p => p.from)) < 80 || pointSetArea(seedPairs.map(p => p.to)) < 80) continue;
    const H = estimateHomography(seedPairs);
    if (!H) continue;
    const inliers = [];
    let err = 0;
    for (let i = 0; i < pairs.length; i++) {
      const q = projectPoint(H, pairs[i].from);
      if (!q) continue;
      const e2 = sq(q.x - pairs[i].to.x) + sq(q.y - pairs[i].to.y);
      if (e2 <= threshold2) { inliers.push(i); err += e2; }
    }
    if (inliers.length > best.length || (inliers.length === best.length && err < bestError)) {
      best = inliers; bestError = err; bestH = H;
      if (best.length / pairs.length > 0.82 && best.length >= 18) break;
    }
  }

  if (best.length >= 4) {
    const refined = estimateHomography(best.map(i => pairs[i]));
    if (refined) bestH = refined;
  }
  return {
    valid: !!bestH && best.length >= 4,
    H: bestH,
    inlierIndices: best,
    inliers: best.length,
    inlierRatio: pairs.length ? best.length / pairs.length : 0,
    meanSquaredError: best.length ? bestError / best.length : null
  };
}

function coverageRatio(pairs, inlierIndices, referenceWidth, referenceHeight) {
  if (!inlierIndices?.length || !referenceWidth || !referenceHeight) return 0;
  const pts = inlierIndices.map(i => pairs[i].from);
  return clamp(pointSetArea(pts) / (referenceWidth * referenceHeight), 0, 1);
}

export function verifyGeometricMatch(photoFeatures, refFeatures, dims, options = {}) {
  const matches = matchFeatures(refFeatures, photoFeatures, options);
  const pairs = matches.map(m => ({
    from: { x: refFeatures[m.query_idx].x, y: refFeatures[m.query_idx].y },
    to: { x: photoFeatures[m.train_idx].x, y: photoFeatures[m.train_idx].y },
    distance: m.distance
  }));
  const model = ransacHomography(pairs, options);
  const coverage = coverageRatio(pairs, model.inlierIndices, dims.referenceWidth, dims.referenceHeight);
  const good = matches.length;
  const inliers = model.inliers;
  const ratio = model.inlierRatio;
  const valid = model.valid &&
    good >= (options.minGoodMatches ?? DEFAULTS.minGoodMatches) &&
    inliers >= (options.minInliers ?? DEFAULTS.minInliers) &&
    ratio >= (options.minInlierRatio ?? DEFAULTS.minInlierRatio) &&
    coverage >= (options.minCoverage ?? DEFAULTS.minCoverage);

  const score = valid
    ? inliers * ratio * (0.55 + 0.45 * Math.sqrt(coverage))
    : inliers * ratio * 0.15;

  return {
    valid,
    score,
    good_matches: good,
    inliers,
    inlier_ratio: ratio,
    reference_coverage: coverage,
    mean_squared_error: model.meanSquaredError,
    homography: model.H ? Array.from(model.H) : null
  };
}

export function rankGeometricCandidates(photoFeatures, candidates, options = {}) {
  return candidates.map(candidate => {
    const metrics = verifyGeometricMatch(
      photoFeatures,
      candidate.features,
      { referenceWidth: candidate.width, referenceHeight: candidate.height },
      options
    );
    return { ...candidate, ...metrics };
  }).sort((a,b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    if (b.inliers !== a.inliers) return b.inliers - a.inliers;
    return (a.vector_rank ?? 999) - (b.vector_rank ?? 999);
  });
}

export const GEOMETRIC_DEFAULTS = DEFAULTS;
