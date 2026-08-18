import jsfeatImport from 'jsfeat';

const jsfeat = jsfeatImport?.default || jsfeatImport;

const FAST_SIDE = 460;
const DETAIL_SIDE = 620;
const FAST_FEATURES = 500;
const DETAIL_FEATURES = 760;
const MAX_CANDIDATES = 8;
const FAST_CANDIDATES = 3;
const REFERENCE_CACHE_LIMIT = 12;

const MIN_GOOD_MATCHES = 18;
const MIN_INLIERS = 12;
const MIN_INLIER_RATIO = 0.50;
const MAX_MEDIAN_DISTANCE = 62;
const STRONG_INLIERS = 26;
const STRONG_INLIER_RATIO = 0.64;
const STRONG_MEDIAN_DISTANCE = 48;
const WINNER_SCORE_MARGIN = 1.14;
const WINNER_INLIER_MARGIN = 4;

const FAST_HAMMING_LIMIT = 68;
const DETAIL_HAMMING_LIMIT = 76;
const FAST_RATIO_TEST = 0.80;
const DETAIL_RATIO_TEST = 0.84;
const U_MAX = new Int32Array([15,15,15,15,14,14,14,13,13,12,11,10,9,8,6,3,0]);
const referenceFeatureCache = new Map();

function now() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

export function warmLocalVision() {}

async function bitmapFromBlob(blob) {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return createImageBitmap(blob);
  }
}

async function bitmapFromUrl(url) {
  const response = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Referência visual indisponível (${response.status}).`);
  return bitmapFromBlob(await response.blob());
}

function detectReferenceCrop(bitmap) {
  const probeSide = 220;
  const scale = Math.min(1, probeSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;

  let minX = width, minY = height, maxX = -1, maxY = -1, foreground = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (!(r < 246 || g < 246 || b < 246 || spread > 10)) continue;
      foreground += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  canvas.width = 1;
  canvas.height = 1;

  if (!foreground || maxX <= minX || maxY <= minY) {
    return { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  }

  const areaRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / Math.max(1, width * height);
  if (areaRatio > 0.96 || areaRatio < 0.08) {
    return { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  }

  const margin = 6;
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(width - 1, maxX + margin);
  maxY = Math.min(height - 1, maxY + margin);

  const sx = Math.round((minX / width) * bitmap.width);
  const sy = Math.round((minY / height) * bitmap.height);
  const ex = Math.round(((maxX + 1) / width) * bitmap.width);
  const ey = Math.round(((maxY + 1) / height) * bitmap.height);

  return {
    sx: Math.max(0, sx),
    sy: Math.max(0, sy),
    sw: Math.max(1, Math.min(bitmap.width - sx, ex - sx)),
    sh: Math.max(1, Math.min(bitmap.height - sy, ey - sy))
  };
}

function canvasFromBitmap(bitmap, { reference = false, maxSide = FAST_SIDE } = {}) {
  const crop = reference ? detectReferenceCrop(bitmap) : { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  const scale = Math.min(1, maxSide / Math.max(crop.sw, crop.sh));
  const width = Math.max(1, Math.round(crop.sw * scale));
  const height = Math.max(1, Math.round(crop.sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d', { alpha: false, willReadFrequently: true })
    .drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  return canvas;
}

function dominantAngle(img, px, py) {
  const half = 15;
  const src = img.data;
  const step = img.cols;
  const center = (py * step + px) | 0;
  let m01 = 0, m10 = 0;
  for (let u = -half; u <= half; u += 1) m10 += u * src[center + u];
  for (let v = 1; v <= half; v += 1) {
    let vSum = 0;
    const d = U_MAX[v];
    for (let u = -d; u <= d; u += 1) {
      const plus = src[center + u + v * step];
      const minus = src[center + u - v * step];
      vSum += plus - minus;
      m10 += u * (plus + minus);
    }
    m01 += v * vSum;
  }
  return Math.atan2(m01, m10);
}

function extractFeatures(canvas, { maxFeatures, detail = false } = {}) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  const smooth = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  jsfeat.imgproc.grayscale(imageData.data, width, height, gray, jsfeat.COLOR_RGBA2GRAY);
  jsfeat.imgproc.gaussian_blur(gray, smooth, detail ? 3 : 5, 0);

  jsfeat.yape06.laplacian_threshold = detail ? 16 : 24;
  jsfeat.yape06.min_eigen_value_threshold = detail ? 10 : 18;

  // YAPE precisa de um pool grande durante a detecção. O bug anterior guardava
  // esse pool inteiro no cache (centenas de milhares de objetos por imagem),
  // o que fazia Safari/iOS matar e recarregar a página por pressão de memória.
  const pool = new Array(width * height);
  for (let i = 0; i < pool.length; i += 1) pool[i] = new jsfeat.keypoint_t(0, 0, 0, 0, -1);
  let count = jsfeat.yape06.detect(smooth, pool, 17);
  const limit = maxFeatures || FAST_FEATURES;
  if (count > limit) {
    jsfeat.math.qsort(pool, 0, count - 1, (a, b) => b.score < a.score);
    count = limit;
  }

  // Retém SOMENTE os keypoints usados. O pool gigante fica elegível para GC
  // ao sair desta função e nunca é colocado no cache.
  const corners = pool.slice(0, count);
  for (let i = 0; i < count; i += 1) {
    corners[i].angle = dominantAngle(smooth, corners[i].x, corners[i].y);
  }

  const descriptors = new jsfeat.matrix_t(32, Math.max(1, count), jsfeat.U8_t | jsfeat.C1_t);
  if (count > 0) jsfeat.orb.describe(smooth, corners, count, descriptors);

  canvas.width = 1;
  canvas.height = 1;
  return { corners, descriptors, count, width, height };
}

function popcnt32(value) {
  let n = value | 0;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function descriptorMatches(reference, photo, detail = false) {
  if (reference.count < 8 || photo.count < 8) return [];
  const query = photo.descriptors.buffer.i32;
  const train = reference.descriptors.buffer.i32;
  const hammingLimit = detail ? DETAIL_HAMMING_LIMIT : FAST_HAMMING_LIMIT;
  const ratioTest = detail ? DETAIL_RATIO_TEST : FAST_RATIO_TEST;
  const found = [];

  for (let qi = 0; qi < photo.count; qi += 1) {
    const qOff = qi * 8;
    let bestDistance = 257, secondDistance = 257, bestIndex = -1;
    for (let ti = 0; ti < reference.count; ti += 1) {
      const tOff = ti * 8;
      let distance = 0;
      for (let k = 0; k < 8; k += 1) distance += popcnt32(query[qOff + k] ^ train[tOff + k]);
      if (distance < bestDistance) {
        secondDistance = bestDistance;
        bestDistance = distance;
        bestIndex = ti;
      } else if (distance < secondDistance) {
        secondDistance = distance;
      }
    }
    if (bestIndex < 0 || bestDistance > hammingLimit) continue;
    if (secondDistance < 257 && bestDistance >= secondDistance * ratioTest) continue;
    found.push({ queryIdx: qi, trainIdx: bestIndex, distance: bestDistance });
  }

  found.sort((a, b) => a.distance - b.distance);
  const usedTrain = new Set();
  const unique = [];
  for (const match of found) {
    if (usedTrain.has(match.trainIdx)) continue;
    usedTrain.add(match.trainIdx);
    unique.push(match);
    if (unique.length >= 150) break;
  }
  return unique;
}

function median(values) {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function projectCorners(matrix, width, height, photoWidth, photoHeight) {
  const m = matrix.data;
  const source = [[0, 0], [width, 0], [width, height], [0, height]];
  const points = [];
  for (const [x, y] of source) {
    const z = m[6] * x + m[7] * y + m[8];
    if (!Number.isFinite(z) || Math.abs(z) < 1e-8) return { ratio: 0, sane: false };
    const px = (m[0] * x + m[1] * y + m[2]) / z;
    const py = (m[3] * x + m[4] * y + m[5]) / z;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return { ratio: 0, sane: false };
    points.push([px, py]);
  }

  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    twiceArea += x1 * y2 - y1 * x2;
  }
  const area = Math.abs(twiceArea) / 2;
  const ratio = area / Math.max(1, photoWidth * photoHeight);
  const bounds = points.filter(([x, y]) =>
    x > -photoWidth * 0.45 && x < photoWidth * 1.45 &&
    y > -photoHeight * 0.45 && y < photoHeight * 1.45
  ).length;
  return { ratio, sane: ratio > 0.028 && ratio < 1.9 && bounds >= 3 };
}

function matchFeatureSets(reference, photo, detail = false) {
  const matches = descriptorMatches(reference, photo, detail);
  const goodMatches = matches.length;
  if (goodMatches < 8) {
    return { accepted: false, strong: false, good_matches: goodMatches, inliers: 0, inlier_ratio: 0, median_distance: median(matches.map(m => m.distance)), geometric_score: 0, geometry_sane: false };
  }

  const referencePoints = matches.map(m => ({ x: reference.corners[m.trainIdx].x, y: reference.corners[m.trainIdx].y }));
  const photoPoints = matches.map(m => ({ x: photo.corners[m.queryIdx].x, y: photo.corners[m.queryIdx].y }));
  const homography = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);
  const mask = new jsfeat.matrix_t(goodMatches, 1, jsfeat.U8_t | jsfeat.C1_t);
  const kernel = new jsfeat.motion_model.homography2d();
  const params = new jsfeat.ransac_params_t(4, detail ? 4.5 : 4, 0.5, 0.995);
  const ok = jsfeat.motion_estimator.ransac(params, kernel, referencePoints, photoPoints, goodMatches, homography, mask, detail ? 650 : 420);
  if (!ok) {
    return { accepted: false, strong: false, good_matches: goodMatches, inliers: 0, inlier_ratio: 0, median_distance: median(matches.map(m => m.distance)), geometric_score: 0, geometry_sane: false };
  }

  const inlierReference = [], inlierPhoto = [], inlierDistances = [];
  for (let i = 0; i < goodMatches; i += 1) {
    if (!mask.data[i]) continue;
    inlierReference.push(referencePoints[i]);
    inlierPhoto.push(photoPoints[i]);
    inlierDistances.push(matches[i].distance);
  }
  const inliers = inlierReference.length;
  if (inliers >= 4) kernel.run(inlierReference, inlierPhoto, homography, inliers);

  const inlierRatio = inliers / Math.max(1, goodMatches);
  const medianDistance = median(inlierDistances.length ? inlierDistances : matches.map(m => m.distance));
  const geometry = projectCorners(homography, reference.width, reference.height, photo.width, photo.height);
  const distanceQuality = Math.max(0, 1 - Math.min(1, medianDistance / 90));
  const geometricScore = inliers * inlierRatio * (0.65 + distanceQuality * 0.35);
  const accepted = goodMatches >= MIN_GOOD_MATCHES && inliers >= MIN_INLIERS && inlierRatio >= MIN_INLIER_RATIO && medianDistance <= MAX_MEDIAN_DISTANCE && geometry.sane;
  const strong = accepted && inliers >= STRONG_INLIERS && inlierRatio >= STRONG_INLIER_RATIO && medianDistance <= STRONG_MEDIAN_DISTANCE;

  return { accepted, strong, good_matches: goodMatches, inliers, inlier_ratio: inlierRatio, median_distance: medianDistance, geometric_score: geometricScore, projected_area_ratio: geometry.ratio, geometry_sane: geometry.sane };
}

function confidenceFromMatch(match) {
  if (!match?.accepted) return 0;
  const ratioPart = Math.min(1, Math.max(0, (match.inlier_ratio - 0.45) / 0.4));
  const inlierPart = Math.min(1, match.inliers / 42);
  const distancePart = Math.min(1, Math.max(0, (70 - match.median_distance) / 35));
  return Math.min(0.999, 0.78 + ratioPart * 0.10 + inlierPart * 0.07 + distancePart * 0.04);
}

function chooseResult(tested) {
  const valid = tested.filter(item => item.accepted).sort((a, b) => b.geometric_score - a.geometric_score);
  const best = valid[0] || null;
  const second = valid[1] || null;
  let unambiguous = Boolean(best);
  if (best && second) {
    unambiguous = best.geometric_score >= second.geometric_score * WINNER_SCORE_MARGIN || best.inliers >= second.inliers + WINNER_INLIER_MARGIN;
  }
  return { accepted: unambiguous ? best : null, best, second, ambiguous: Boolean(best && second && !unambiguous) };
}

function cacheSet(key, value) {
  if (referenceFeatureCache.has(key)) referenceFeatureCache.delete(key);
  referenceFeatureCache.set(key, value);
  while (referenceFeatureCache.size > REFERENCE_CACHE_LIMIT) {
    const oldest = referenceFeatureCache.keys().next().value;
    referenceFeatureCache.delete(oldest);
  }
}

async function referenceFeatures(candidate, mode) {
  const detail = mode === 'detail';
  const key = `${candidate.image_url}|${mode}`;
  if (referenceFeatureCache.has(key)) {
    const cached = referenceFeatureCache.get(key);
    referenceFeatureCache.delete(key);
    referenceFeatureCache.set(key, cached);
    return cached;
  }

  const bitmap = await bitmapFromUrl(candidate.image_url);
  try {
    const canvas = canvasFromBitmap(bitmap, { reference: true, maxSide: detail ? DETAIL_SIDE : FAST_SIDE });
    const features = extractFeatures(canvas, { maxFeatures: detail ? DETAIL_FEATURES : FAST_FEATURES, detail });
    cacheSet(key, features);
    return features;
  } finally {
    bitmap.close?.();
  }
}

function resultFromTested(tested, started, runtimeError = null, pass = 'fast') {
  const { accepted, best, second, ambiguous } = chooseResult(tested);
  const bestObserved = best || [...tested].sort((a, b) => (b.geometric_score || 0) - (a.geometric_score || 0))[0] || null;
  return {
    matched: Boolean(accepted),
    capa_code: accepted?.capa_code || '',
    candidates_tested: tested.length,
    local_cv_ms: Math.round(now() - started),
    good_matches: accepted?.good_matches ?? bestObserved?.good_matches ?? 0,
    inliers: accepted?.inliers ?? bestObserved?.inliers ?? 0,
    inlier_ratio: accepted?.inlier_ratio ?? bestObserved?.inlier_ratio ?? 0,
    median_distance: Number.isFinite(accepted?.median_distance ?? bestObserved?.median_distance) ? (accepted?.median_distance ?? bestObserved?.median_distance) : null,
    geometric_score: accepted?.geometric_score ?? bestObserved?.geometric_score ?? 0,
    projected_area_ratio: accepted?.projected_area_ratio ?? bestObserved?.projected_area_ratio ?? null,
    confidence: confidenceFromMatch(accepted),
    ambiguous,
    runner: `jsfeat-orb-ransac-v3-${pass}`,
    local_error: runtimeError ? String(runtimeError).slice(0, 220) : null,
    debug_candidates: tested.map(item => ({
      capa_code: item.capa_code,
      retrieval_score: item.retrieval_score,
      pass: item.pass,
      accepted: Boolean(item.accepted),
      good_matches: item.good_matches || 0,
      inliers: item.inliers || 0,
      inlier_ratio: item.inlier_ratio || 0,
      median_distance: Number.isFinite(item.median_distance) ? item.median_distance : null,
      geometric_score: item.geometric_score || 0
    }))
  };
}

async function runPass(photo, candidates, mode, tested) {
  const detail = mode === 'detail';
  for (const candidate of candidates) {
    try {
      const reference = await referenceFeatures(candidate, mode);
      const metrics = matchFeatureSets(reference, photo, detail);
      tested.push({ ...candidate, ...metrics, pass: mode });
      if (metrics.strong) return true;
    } catch (error) {
      tested.push({ ...candidate, accepted: false, pass: mode, error: error?.message || 'Falha ao comparar referência' });
    }
    // Entrega o controle ao navegador entre candidatas para evitar watchdog/jank no Safari.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return false;
}

export async function matchLocalCandidates(photoFile, candidates) {
  const started = now();
  const allCandidates = (candidates || []).slice(0, MAX_CANDIDATES);
  const tested = [];
  let photoBitmap;

  try {
    photoBitmap = await bitmapFromBlob(photoFile);

    const fastCanvas = canvasFromBitmap(photoBitmap, { maxSide: FAST_SIDE });
    const fastPhoto = extractFeatures(fastCanvas, { maxFeatures: FAST_FEATURES, detail: false });
    const strongFast = await runPass(fastPhoto, allCandidates.slice(0, FAST_CANDIDATES), 'fast', tested);
    if (strongFast) return resultFromTested(tested, started, null, 'fast');

    const fastChoice = chooseResult(tested);
    if (fastChoice.accepted && !fastChoice.ambiguous) {
      return resultFromTested(tested, started, null, 'fast');
    }

    const detailCanvas = canvasFromBitmap(photoBitmap, { maxSide: DETAIL_SIDE });
    const detailPhoto = extractFeatures(detailCanvas, { maxFeatures: DETAIL_FEATURES, detail: true });
    const detailTested = [];
    await runPass(detailPhoto, allCandidates, 'detail', detailTested);

    if (detailTested.some(item => item.accepted)) {
      return resultFromTested(detailTested, started, null, 'detail');
    }

    tested.push(...detailTested);
    return resultFromTested(tested, started, null, 'exhausted');
  } catch (error) {
    return resultFromTested(tested, started, error?.message || 'Falha no verificador local', 'error');
  } finally {
    photoBitmap?.close?.();
  }
}
