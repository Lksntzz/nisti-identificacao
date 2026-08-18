import jsfeatImport from 'jsfeat';

const jsfeat = jsfeatImport?.default || jsfeatImport;

const MAX_FEATURE_SIDE = 480;
const MAX_FEATURES = 520;
const MAX_CANDIDATES = 5;
const PREFETCH_CANDIDATES = 3;
const MIN_GOOD_MATCHES = 18;
const MIN_INLIERS = 12;
const MIN_INLIER_RATIO = 0.50;
const MAX_MEDIAN_DISTANCE = 62;
const STRONG_INLIERS = 24;
const STRONG_INLIER_RATIO = 0.62;
const STRONG_MEDIAN_DISTANCE = 48;
const WINNER_SCORE_MARGIN = 1.15;
const WINNER_INLIER_MARGIN = 4;
const HAMMING_LIMIT = 68;
const RATIO_TEST = 0.80;
const U_MAX = new Int32Array([15,15,15,15,14,14,14,13,13,12,11,10,9,8,6,3,0]);

function now() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}

export function warmLocalVision() {
  // JSFeat é JavaScript puro e entra no bundle principal; não existe WASM de 15 MB para inicializar.
}

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
  const maxProbe = 220;
  const scale = Math.min(1, maxProbe / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let foreground = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      const nonWhite = r < 242 || g < 242 || b < 242 || spread > 13;
      if (!nonWhite) continue;
      foreground += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!foreground || maxX <= minX || maxY <= minY) {
    return { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  }

  const probeAreaRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / Math.max(1, width * height);
  if (probeAreaRatio > 0.94 || probeAreaRatio < 0.10) {
    return { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  }

  const margin = 5;
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

function canvasFromBitmap(bitmap, reference = false) {
  const crop = reference
    ? detectReferenceCrop(bitmap)
    : { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  const scale = Math.min(1, MAX_FEATURE_SIDE / Math.max(crop.sw, crop.sh));
  const width = Math.max(1, Math.round(crop.sw * scale));
  const height = Math.max(1, Math.round(crop.sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  return canvas;
}

function dominantAngle(img, px, py) {
  const half = 15;
  const src = img.data;
  const step = img.cols;
  const center = (py * step + px) | 0;
  let m01 = 0;
  let m10 = 0;

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

function extractFeatures(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const imageData = canvas.getContext('2d', { alpha: false, willReadFrequently: true }).getImageData(0, 0, width, height);
  const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  const smooth = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  jsfeat.imgproc.grayscale(imageData.data, width, height, gray, jsfeat.COLOR_RGBA2GRAY);
  jsfeat.imgproc.gaussian_blur(gray, smooth, 5, 0);

  jsfeat.yape06.laplacian_threshold = 25;
  jsfeat.yape06.min_eigen_value_threshold = 20;
  const corners = new Array(width * height);
  for (let i = 0; i < corners.length; i += 1) corners[i] = new jsfeat.keypoint_t(0, 0, 0, 0, -1);
  let count = jsfeat.yape06.detect(smooth, corners, 17);
  if (count > MAX_FEATURES) {
    jsfeat.math.qsort(corners, 0, count - 1, (a, b) => b.score < a.score);
    count = MAX_FEATURES;
  }

  for (let i = 0; i < count; i += 1) {
    corners[i].angle = dominantAngle(smooth, corners[i].x, corners[i].y);
  }
  const descriptors = new jsfeat.matrix_t(32, Math.max(1, count), jsfeat.U8_t | jsfeat.C1_t);
  if (count > 0) jsfeat.orb.describe(smooth, corners, count, descriptors);

  return { corners, descriptors, count, width, height };
}

function popcnt32(value) {
  let n = value | 0;
  n -= (n >> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

function descriptorMatches(reference, photo) {
  if (reference.count < 8 || photo.count < 8) return [];
  const query = photo.descriptors.buffer.i32;
  const train = reference.descriptors.buffer.i32;
  const found = [];

  for (let qi = 0; qi < photo.count; qi += 1) {
    const qOff = qi * 8;
    let bestDistance = 257;
    let secondDistance = 257;
    let bestIndex = -1;

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

    if (bestIndex < 0 || bestDistance > HAMMING_LIMIT) continue;
    if (secondDistance < 257 && bestDistance >= secondDistance * RATIO_TEST) continue;
    found.push({ queryIdx: qi, trainIdx: bestIndex, distance: bestDistance });
  }

  found.sort((a, b) => a.distance - b.distance);
  const usedTrain = new Set();
  const unique = [];
  for (const match of found) {
    if (usedTrain.has(match.trainIdx)) continue;
    usedTrain.add(match.trainIdx);
    unique.push(match);
    if (unique.length >= 120) break;
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
  return { ratio, sane: ratio > 0.035 && ratio < 1.8 && bounds >= 3 };
}

function matchFeatureSets(reference, photo) {
  const matches = descriptorMatches(reference, photo);
  const goodMatches = matches.length;
  if (goodMatches < 8) {
    return { accepted: false, strong: false, good_matches: goodMatches, inliers: 0, inlier_ratio: 0, median_distance: median(matches.map(match => match.distance)), geometric_score: 0, geometry_sane: false };
  }

  const referencePoints = matches.map(match => ({
    x: reference.corners[match.trainIdx].x,
    y: reference.corners[match.trainIdx].y
  }));
  const photoPoints = matches.map(match => ({
    x: photo.corners[match.queryIdx].x,
    y: photo.corners[match.queryIdx].y
  }));

  const homography = new jsfeat.matrix_t(3, 3, jsfeat.F32_t | jsfeat.C1_t);
  const mask = new jsfeat.matrix_t(goodMatches, 1, jsfeat.U8_t | jsfeat.C1_t);
  const kernel = new jsfeat.motion_model.homography2d();
  const params = new jsfeat.ransac_params_t(4, 4, 0.5, 0.995);
  const ok = jsfeat.motion_estimator.ransac(params, kernel, referencePoints, photoPoints, goodMatches, homography, mask, 500);
  if (!ok) {
    return { accepted: false, strong: false, good_matches: goodMatches, inliers: 0, inlier_ratio: 0, median_distance: median(matches.map(match => match.distance)), geometric_score: 0, geometry_sane: false };
  }

  const inlierReference = [];
  const inlierPhoto = [];
  const inlierDistances = [];
  for (let i = 0; i < goodMatches; i += 1) {
    if (!mask.data[i]) continue;
    inlierReference.push(referencePoints[i]);
    inlierPhoto.push(photoPoints[i]);
    inlierDistances.push(matches[i].distance);
  }
  const inliers = inlierReference.length;
  if (inliers >= 4) kernel.run(inlierReference, inlierPhoto, homography, inliers);

  const inlierRatio = inliers / Math.max(1, goodMatches);
  const medianDistance = median(inlierDistances.length ? inlierDistances : matches.map(match => match.distance));
  const geometry = projectCorners(homography, reference.width, reference.height, photo.width, photo.height);
  const distanceQuality = Math.max(0, 1 - Math.min(1, medianDistance / 90));
  const geometricScore = inliers * inlierRatio * (0.65 + distanceQuality * 0.35);
  const accepted = goodMatches >= MIN_GOOD_MATCHES &&
    inliers >= MIN_INLIERS &&
    inlierRatio >= MIN_INLIER_RATIO &&
    medianDistance <= MAX_MEDIAN_DISTANCE &&
    geometry.sane;
  const strong = accepted &&
    inliers >= STRONG_INLIERS &&
    inlierRatio >= STRONG_INLIER_RATIO &&
    medianDistance <= STRONG_MEDIAN_DISTANCE;

  return {
    accepted,
    strong,
    good_matches: goodMatches,
    inliers,
    inlier_ratio: inlierRatio,
    median_distance: medianDistance,
    geometric_score: geometricScore,
    projected_area_ratio: geometry.ratio,
    geometry_sane: geometry.sane
  };
}

function confidenceFromMatch(match) {
  if (!match?.accepted) return 0;
  const ratioPart = Math.min(1, Math.max(0, (match.inlier_ratio - 0.45) / 0.4));
  const inlierPart = Math.min(1, match.inliers / 40);
  const distancePart = Math.min(1, Math.max(0, (70 - match.median_distance) / 35));
  return Math.min(0.999, 0.78 + ratioPart * 0.10 + inlierPart * 0.07 + distancePart * 0.04);
}

function resultFromTested(tested, started, runtimeError = null) {
  const valid = tested.filter(item => item.accepted).sort((a, b) => b.geometric_score - a.geometric_score);
  const best = valid[0] || null;
  const second = valid[1] || null;
  let unambiguous = Boolean(best);
  if (best && second) {
    unambiguous = best.geometric_score >= second.geometric_score * WINNER_SCORE_MARGIN ||
      best.inliers >= second.inliers + WINNER_INLIER_MARGIN;
  }
  const accepted = unambiguous ? best : null;
  const bestObserved = best || [...tested].sort((a, b) => (b.geometric_score || 0) - (a.geometric_score || 0))[0] || null;

  return {
    matched: Boolean(accepted),
    capa_code: accepted?.capa_code || '',
    candidates_tested: tested.length,
    local_cv_ms: Math.round(now() - started),
    good_matches: accepted?.good_matches ?? bestObserved?.good_matches ?? 0,
    inliers: accepted?.inliers ?? bestObserved?.inliers ?? 0,
    inlier_ratio: accepted?.inlier_ratio ?? bestObserved?.inlier_ratio ?? 0,
    median_distance: Number.isFinite(accepted?.median_distance ?? bestObserved?.median_distance)
      ? (accepted?.median_distance ?? bestObserved?.median_distance)
      : null,
    geometric_score: accepted?.geometric_score ?? bestObserved?.geometric_score ?? 0,
    projected_area_ratio: accepted?.projected_area_ratio ?? bestObserved?.projected_area_ratio ?? null,
    confidence: confidenceFromMatch(accepted),
    ambiguous: Boolean(best && second && !unambiguous),
    runner: 'jsfeat-orb-ransac-v1',
    local_error: runtimeError ? String(runtimeError).slice(0, 220) : null,
    debug_candidates: tested.map(item => ({
      capa_code: item.capa_code,
      retrieval_score: item.retrieval_score,
      accepted: Boolean(item.accepted),
      good_matches: item.good_matches || 0,
      inliers: item.inliers || 0,
      inlier_ratio: item.inlier_ratio || 0,
      median_distance: Number.isFinite(item.median_distance) ? item.median_distance : null,
      geometric_score: item.geometric_score || 0
    }))
  };
}

export async function matchLocalCandidates(photoFile, candidates, options = {}) {
  const started = now();
  const deadlineMs = Math.max(850, Number(options.deadlineMs) || 2200);
  const tested = [];
  let photoBitmap;

  try {
    photoBitmap = await bitmapFromBlob(photoFile);
    const photo = extractFeatures(canvasFromBitmap(photoBitmap, false));
    const entries = (candidates || []).slice(0, MAX_CANDIDATES).map((candidate, index) => ({
      candidate,
      bitmapPromise: index < PREFETCH_CANDIDATES ? bitmapFromUrl(candidate.image_url) : null
    }));

    for (const entry of entries) {
      if (now() - started >= deadlineMs) break;
      let bitmap;
      try {
        bitmap = await (entry.bitmapPromise || bitmapFromUrl(entry.candidate.image_url));
        const reference = extractFeatures(canvasFromBitmap(bitmap, true));
        const metrics = matchFeatureSets(reference, photo);
        tested.push({ ...entry.candidate, ...metrics });
        if (metrics.strong) break;
      } catch (error) {
        tested.push({ ...entry.candidate, accepted: false, error: error?.message || 'Falha ao comparar referência' });
      } finally {
        bitmap?.close?.();
      }
    }

    return resultFromTested(tested, started);
  } catch (error) {
    // Nunca cai para o antigo Gemini generativo por falha local: retorna rejeição segura
    // e deixa o servidor registrar o diagnóstico, sem esperar mais 5 segundos.
    return resultFromTested(tested, started, error?.message || 'Falha no verificador local');
  } finally {
    photoBitmap?.close?.();
  }
}
