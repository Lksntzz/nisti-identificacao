let cvPromise = null;

const MAX_FEATURE_SIDE = 720;
const MAX_FEATURES = 1400;
const MIN_GOOD_MATCHES = 18;
const MIN_INLIERS = 12;
const MIN_INLIER_RATIO = 0.50;
const MAX_MEDIAN_DISTANCE = 62;
const STRONG_INLIERS = 24;
const STRONG_INLIER_RATIO = 0.62;
const STRONG_MEDIAN_DISTANCE = 48;
const WINNER_SCORE_MARGIN = 1.15;
const WINNER_INLIER_MARGIN = 4;

function now() {
  return performance?.now ? performance.now() : Date.now();
}

async function getOpenCv() {
  if (cvPromise) return cvPromise;
  cvPromise = (async () => {
    const imported = await import('@techstark/opencv-js');
    let cv = imported?.default || imported;
    if (cv instanceof Promise) cv = await cv;
    if (cv?.Mat) return cv;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OpenCV demorou para inicializar.')), 12000);
      cv.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    if (!cv?.Mat) throw new Error('OpenCV não inicializou corretamente.');
    return cv;
  })().catch(error => {
    cvPromise = null;
    throw error;
  });
  return cvPromise;
}

export function warmLocalVision() {
  if (typeof window === 'undefined') return;
  // Inicia o download/compilação WASM logo após o primeiro paint. Quando o operador
  // terminar de enquadrar a capa, o motor tende a já estar quente.
  setTimeout(() => getOpenCv().catch(() => {}), 0);
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

function canvasFromBitmap(bitmap, maxSide = MAX_FEATURE_SIDE) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function makeOrb(cv) {
  let orb;
  if (cv.ORB?.create) {
    orb = cv.ORB.create();
    orb.setMaxFeatures?.(MAX_FEATURES);
    orb.setFastThreshold?.(12);
    orb.setEdgeThreshold?.(19);
  } else {
    orb = new cv.ORB(MAX_FEATURES);
  }
  return orb;
}

function deleteIf(value) {
  try { value?.delete?.(); } catch {}
}

function extractFeatures(cv, canvas) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const mask = new cv.Mat();
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const orb = makeOrb(cv);
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.equalizeHist(gray, gray);
    orb.detectAndCompute(gray, mask, keypoints, descriptors);
    return {
      keypoints,
      descriptors,
      width: gray.cols,
      height: gray.rows,
      count: keypoints.size(),
      dispose() {
        deleteIf(keypoints);
        deleteIf(descriptors);
      }
    };
  } finally {
    deleteIf(src);
    deleteIf(gray);
    deleteIf(mask);
    deleteIf(orb);
  }
}

function median(values) {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function projectedArea(cv, homography, width, height, photoWidth, photoHeight) {
  const source = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  const target = new cv.Mat();
  try {
    cv.perspectiveTransform(source, target, homography);
    const p = target.data32F;
    if (!p || p.length < 8) return { ratio: 0, sane: false };
    const points = [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]], [p[6], p[7]]];
    let twiceArea = 0;
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      twiceArea += x1 * y2 - y1 * x2;
    }
    const area = Math.abs(twiceArea) / 2;
    const ratio = area / Math.max(1, photoWidth * photoHeight);
    const bounds = points.filter(([x, y]) => x > -photoWidth * 0.45 && x < photoWidth * 1.45 && y > -photoHeight * 0.45 && y < photoHeight * 1.45).length;
    return { ratio, sane: ratio > 0.025 && ratio < 2.2 && bounds >= 3 };
  } finally {
    deleteIf(source);
    deleteIf(target);
  }
}

function matchFeatureSets(cv, reference, photo) {
  if (!reference?.count || !photo?.count || reference.descriptors.rows < 8 || photo.descriptors.rows < 8) {
    return { accepted: false, good_matches: 0, inliers: 0, inlier_ratio: 0, median_distance: Infinity, geometric_score: 0, geometry_sane: false };
  }

  const matcher = cv.BFMatcher?.create
    ? cv.BFMatcher.create(cv.NORM_HAMMING, true)
    : new cv.BFMatcher(cv.NORM_HAMMING, true);
  const matches = new cv.DMatchVector();
  let sourcePoints;
  let targetPoints;
  let inlierMask;
  let homography;

  try {
    matcher.match(reference.descriptors, photo.descriptors, matches);
    const all = [];
    for (let i = 0; i < matches.size(); i += 1) {
      const item = matches.get(i);
      if (Number.isFinite(item?.distance)) all.push(item);
    }
    all.sort((a, b) => a.distance - b.distance);
    if (!all.length) return { accepted: false, good_matches: 0, inliers: 0, inlier_ratio: 0, median_distance: Infinity, geometric_score: 0, geometry_sane: false };

    const minDistance = Math.max(1, all[0].distance);
    const distanceLimit = Math.min(72, Math.max(38, minDistance * 2.4));
    const good = all.filter(match => match.distance <= distanceLimit).slice(0, 100);
    if (good.length < 8) {
      return { accepted: false, good_matches: good.length, inliers: 0, inlier_ratio: 0, median_distance: median(good.map(match => match.distance)), geometric_score: 0, geometry_sane: false };
    }

    const source = [];
    const target = [];
    const distances = [];
    for (const match of good) {
      const refPoint = reference.keypoints.get(match.queryIdx)?.pt;
      const photoPoint = photo.keypoints.get(match.trainIdx)?.pt;
      if (!refPoint || !photoPoint) continue;
      source.push(refPoint.x, refPoint.y);
      target.push(photoPoint.x, photoPoint.y);
      distances.push(match.distance);
    }
    if (source.length < 16) {
      return { accepted: false, good_matches: source.length / 2, inliers: 0, inlier_ratio: 0, median_distance: median(distances), geometric_score: 0, geometry_sane: false };
    }

    sourcePoints = cv.matFromArray(source.length / 2, 1, cv.CV_32FC2, source);
    targetPoints = cv.matFromArray(target.length / 2, 1, cv.CV_32FC2, target);
    inlierMask = new cv.Mat();
    homography = cv.findHomography(sourcePoints, targetPoints, cv.RANSAC, 4.0, inlierMask);
    if (!homography || homography.empty()) {
      return { accepted: false, good_matches: source.length / 2, inliers: 0, inlier_ratio: 0, median_distance: median(distances), geometric_score: 0, geometry_sane: false };
    }

    let inliers = 0;
    const maskData = inlierMask.data8U || inlierMask.data;
    for (let i = 0; i < maskData.length; i += 1) if (maskData[i]) inliers += 1;
    const goodMatches = source.length / 2;
    const inlierRatio = inliers / Math.max(1, goodMatches);
    const medianDistance = median(distances);
    const geometry = projectedArea(cv, homography, reference.width, reference.height, photo.width, photo.height);
    const distanceQuality = Math.max(0, 1 - Math.min(1, medianDistance / 90));
    const geometricScore = inliers * inlierRatio * (0.65 + distanceQuality * 0.35);
    const accepted = goodMatches >= MIN_GOOD_MATCHES &&
      inliers >= MIN_INLIERS &&
      inlierRatio >= MIN_INLIER_RATIO &&
      medianDistance <= MAX_MEDIAN_DISTANCE &&
      geometry.sane;
    const strong = accepted && inliers >= STRONG_INLIERS && inlierRatio >= STRONG_INLIER_RATIO && medianDistance <= STRONG_MEDIAN_DISTANCE;

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
  } finally {
    deleteIf(matcher);
    deleteIf(matches);
    deleteIf(sourcePoints);
    deleteIf(targetPoints);
    deleteIf(inlierMask);
    deleteIf(homography);
  }
}

function confidenceFromMatch(match) {
  if (!match?.accepted) return 0;
  const ratioPart = Math.min(1, Math.max(0, (match.inlier_ratio - 0.45) / 0.4));
  const inlierPart = Math.min(1, match.inliers / 40);
  const distancePart = Math.min(1, Math.max(0, (70 - match.median_distance) / 35));
  return Math.min(0.999, 0.78 + ratioPart * 0.10 + inlierPart * 0.07 + distancePart * 0.04);
}

export async function matchLocalCandidates(photoFile, candidates, options = {}) {
  const started = now();
  const deadlineMs = Math.max(900, Number(options.deadlineMs) || 2800);
  const cv = await getOpenCv();
  const photoBitmap = await bitmapFromBlob(photoFile);
  const photoCanvas = canvasFromBitmap(photoBitmap);
  photoBitmap.close?.();
  const photoFeatures = extractFeatures(cv, photoCanvas);
  const references = (candidates || []).slice(0, 8).map((candidate, index) => ({
    candidate,
    // Pré-carrega apenas as três mais prováveis. As demais só consomem banda se forem necessárias.
    bitmapPromise: index < 3 ? bitmapFromUrl(candidate.image_url) : null
  }));
  const tested = [];

  try {
    for (const entry of references) {
      if (now() - started > deadlineMs) break;
      let bitmap;
      try {
        bitmap = await (entry.bitmapPromise || bitmapFromUrl(entry.candidate.image_url));
        const canvas = canvasFromBitmap(bitmap);
        const reference = extractFeatures(cv, canvas);
        try {
          const metrics = matchFeatureSets(cv, reference, photoFeatures);
          tested.push({ ...entry.candidate, ...metrics });
          if (metrics.strong) break;
        } finally {
          reference.dispose();
        }
      } catch (error) {
        tested.push({ ...entry.candidate, accepted: false, error: error?.message || 'Falha ao comparar referência' });
      } finally {
        bitmap?.close?.();
      }
    }

    const valid = tested.filter(item => item.accepted).sort((a, b) => b.geometric_score - a.geometric_score);
    const best = valid[0] || null;
    const second = valid[1] || null;
    let unambiguous = Boolean(best);
    if (best && second) {
      unambiguous = best.geometric_score >= second.geometric_score * WINNER_SCORE_MARGIN ||
        best.inliers >= second.inliers + WINNER_INLIER_MARGIN;
    }
    const accepted = unambiguous ? best : null;
    const localCvMs = Math.round(now() - started);

    return {
      matched: Boolean(accepted),
      capa_code: accepted?.capa_code || '',
      candidates_tested: tested.length,
      local_cv_ms: localCvMs,
      good_matches: accepted?.good_matches ?? best?.good_matches ?? 0,
      inliers: accepted?.inliers ?? best?.inliers ?? 0,
      inlier_ratio: accepted?.inlier_ratio ?? best?.inlier_ratio ?? 0,
      median_distance: Number.isFinite(accepted?.median_distance ?? best?.median_distance) ? (accepted?.median_distance ?? best?.median_distance) : null,
      geometric_score: accepted?.geometric_score ?? best?.geometric_score ?? 0,
      projected_area_ratio: accepted?.projected_area_ratio ?? best?.projected_area_ratio ?? null,
      confidence: confidenceFromMatch(accepted),
      ambiguous: Boolean(best && second && !unambiguous),
      runner: 'opencv-orb-ransac-v1',
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
  } finally {
    photoFeatures.dispose();
  }
}
