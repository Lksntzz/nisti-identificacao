import {
  rgbaToGray,
  extractOrbLikeFeatures,
  rankGeometricCandidates
} from './geometric-core.js';
import {
  RETRIEVAL_GATE,
  GEOMETRIC_GATES,
  GEOMETRIC_ROLLOUT_GATE,
  selectContentIndependentCandidates,
  evaluateRetrievalGate,
  evaluateGeometricGate,
  summarizeHybridGates
} from './geometric-hybrid-gate.js';

const $ = selector => document.querySelector(selector);
const runButton = $('#run');
const downloadButton = $('#download');
const statusEl = $('#status');
const progressEl = $('#progress');
const outputEl = $('#output');

let lastReport = null;
const referenceCache = new Map();

const FEATURE_OPTIONS = {
  maxFeatures: 260,
  fastThreshold: 18,
  scales: [1, 0.72],
  ratioThreshold: 0.8,
  maxHamming: 96,
  ransacIterations: 650,
  reprojectionThreshold: 6,
  minGoodMatches: 8,
  minInliers: 6,
  minInlierRatio: 0.26,
  minCoverage: 0.02
};

function setStatus(text) { statusEl.textContent = text; }
function yieldUi() { return new Promise(resolve => requestAnimationFrame(() => resolve())); }
function normalizeCode(value) { return String(value || '').trim().toUpperCase(); }

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

async function blobFromUrl(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Falha ao carregar imagem ${response.status}: ${url}`);
  return response.blob();
}

async function imageFeatures(url, cache = false, includeHash = false) {
  const cacheKey = `${url}|sha256=${includeHash ? '1' : '0'}`;
  if (cache && referenceCache.has(cacheKey)) return referenceCache.get(cacheKey);
  const promise = (async () => {
    const blob = await blobFromUrl(url);
    const digestPromise = includeHash
      ? blob.arrayBuffer().then(buffer => crypto.subtle.digest('SHA-256', buffer)).then(hex)
      : Promise.resolve(null);
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      const maxDimension = 520;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(48, Math.round(bitmap.width * scale));
      const height = Math.max(48, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
      ctx.drawImage(bitmap, 0, 0, width, height);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const gray = rgbaToGray(rgba, width, height);
      const features = extractOrbLikeFeatures(gray, width, height, FEATURE_OPTIONS);
      return {
        width,
        height,
        features,
        feature_count: features.length,
        sha256: await digestPromise
      };
    } finally {
      bitmap.close?.();
    }
  })();
  if (cache) referenceCache.set(cacheKey, promise);
  try { return await promise; }
  catch (error) { if (cache) referenceCache.delete(cacheKey); throw error; }
}

function summarizeBaseline(results) {
  const evaluated = results.filter(r => r.status === 'evaluated');
  const vectorCorrect = evaluated.filter(r => r.vector_top1_correct).length;
  const geometricCorrect = evaluated.filter(r => r.geometric_top1_correct).length;
  const improved = evaluated.filter(r => !r.vector_top1_correct && r.geometric_top1_correct).length;
  const worsened = evaluated.filter(r => r.vector_top1_correct && !r.geometric_top1_correct).length;
  const gtInTop10 = evaluated.filter(r => r.ground_truth_in_vector_top10).length;
  const validWinner = evaluated.filter(r => r.geometric_top1_valid).length;
  const validWinnerCorrect = evaluated.filter(r => r.geometric_top1_valid && r.geometric_top1_correct).length;
  const falsePositiveLike = evaluated.filter(r => r.geometric_top1_valid && !r.geometric_top1_correct).length;
  const elapsed = evaluated.map(r => r.elapsed_ms).filter(Number.isFinite);
  return {
    evaluated: evaluated.length,
    vector_top1: { correct: vectorCorrect, accuracy: evaluated.length ? vectorCorrect / evaluated.length : null },
    geometric_top1: { correct: geometricCorrect, accuracy: evaluated.length ? geometricCorrect / evaluated.length : null },
    vector_top10_ceiling: { ground_truth_present: gtInTop10, rate: evaluated.length ? gtInTop10 / evaluated.length : null },
    delta: { improved, worsened, net: improved - worsened },
    geometric_valid_winner: {
      accepted: validWinner,
      correct: validWinnerCorrect,
      incorrect: falsePositiveLike,
      precision: validWinner ? validWinnerCorrect / validWinner : null,
      coverage: evaluated.length ? validWinner / evaluated.length : null
    },
    elapsed_ms: {
      mean: elapsed.length ? elapsed.reduce((a,b) => a+b, 0) / elapsed.length : null,
      max: elapsed.length ? Math.max(...elapsed) : null
    }
  };
}

function summarizeContentHoldout(results) {
  const evaluated = results.filter(r => r.status === 'evaluated');
  const preTop1Correct = evaluated.filter(r => normalizeCode(r.pre_content_holdout?.vector_top1) === normalizeCode(r.ground_truth)).length;
  const preTop10 = evaluated.filter(r => r.pre_content_holdout?.correct_cover_rank_within_top10 !== null).length;
  const postTop1Correct = evaluated.filter(r => r.vector_top1_correct).length;
  const postTop10 = evaluated.filter(r => r.ground_truth_in_vector_top10).length;
  const changedTop1 = evaluated.filter(r => normalizeCode(r.pre_content_holdout?.vector_top1) !== normalizeCode(r.vector_top1)).length;
  const samplesWithExclusions = evaluated.filter(r => Number(r.content_holdout?.excluded_same_content_count || 0) > 0).length;
  const referencesExcluded = evaluated.reduce((sum, r) => sum + Number(r.content_holdout?.excluded_same_content_count || 0), 0);
  const unhashedReferences = evaluated.reduce((sum, r) => sum + Number(r.content_holdout?.unhashed_reference_count || 0), 0);
  const exhausted = evaluated.filter(r => r.content_holdout?.exhausted_before_limit === true).length;
  const groundTruthSameContentExclusions = evaluated.filter(r => r.content_holdout?.same_content_ground_truth_reference_excluded === true).length;

  return {
    algorithm: 'sha256-exact-response-bytes',
    evaluated: evaluated.length,
    pre_content_holdout: {
      vector_top1_correct: preTop1Correct,
      vector_top1_accuracy: evaluated.length ? preTop1Correct / evaluated.length : null,
      ground_truth_in_top10: preTop10,
      top10_rate: evaluated.length ? preTop10 / evaluated.length : null
    },
    post_content_holdout: {
      vector_top1_correct: postTop1Correct,
      vector_top1_accuracy: evaluated.length ? postTop1Correct / evaluated.length : null,
      ground_truth_in_top10: postTop10,
      top10_rate: evaluated.length ? postTop10 / evaluated.length : null
    },
    vector_top1_changed_samples: changedTop1,
    samples_with_same_content_reference_exclusions: samplesWithExclusions,
    same_content_references_excluded: referencesExcluded,
    same_content_ground_truth_reference_exclusions: groundTruthSameContentExclusions,
    unhashed_references: unhashedReferences,
    candidate_pool_exhausted_before_top10: exhausted
  };
}

async function buildContentHeldoutCandidates(sample, photo) {
  const sourcePool = Array.isArray(sample.candidate_reference_pool) && sample.candidate_reference_pool.length
    ? sample.candidate_reference_pool
    : (sample.candidates || []).map(item => ({ ...item, vector_rank: item.vector_rank ?? item.cover_rank }));
  const orderedPool = [...sourcePool].sort((a, b) => Number(a.vector_rank || 999999) - Number(b.vector_rank || 999999));
  const enrichedPool = [];
  const loadErrors = [];
  let selection = selectContentIndependentCandidates(enrichedPool, photo.sha256, 10);

  for (const candidate of orderedPool) {
    const code = normalizeCode(candidate.capa_code);
    if (!code) continue;
    if (selection.selected.some(item => normalizeCode(item.capa_code) === code)) continue;
    try {
      const ref = await imageFeatures(candidate.image_url, true, true);
      enrichedPool.push({
        ...candidate,
        capa_code: code,
        vector_rank: Number(candidate.vector_rank || candidate.cover_rank || 0) || null,
        vector_score: candidate.retrieval_score,
        reference_sha256: ref.sha256,
        width: ref.width,
        height: ref.height,
        feature_count: ref.feature_count,
        features: ref.features
      });
      selection = selectContentIndependentCandidates(enrichedPool, photo.sha256, 10);
      if (selection.selected.length >= 10) break;
    } catch (error) {
      loadErrors.push({
        capa_code: code,
        reference_id: candidate.reference_id,
        vector_rank: candidate.vector_rank ?? null,
        error: String(error?.message || error)
      });
    }
  }

  return {
    ...selection,
    reference_pool_size: orderedPool.length,
    references_examined: enrichedPool.length,
    load_errors: loadErrors
  };
}

async function runSample(sample) {
  const started = performance.now();
  const photo = await imageFeatures(sample.occurrence_image_url, false, true);
  if (!photo.sha256) throw new Error('SHA-256 da foto de consulta indisponível; content holdout falhou fechado.');

  const holdout = await buildContentHeldoutCandidates(sample, photo);
  if (!holdout.selected.length) throw new Error('Nenhuma referência independente restou após content holdout.');

  const candidates = holdout.selected.map(item => ({
    capa_code: item.capa_code,
    vector_rank: item.vector_rank,
    cover_rank: item.cover_rank,
    vector_score: item.vector_score ?? item.retrieval_score,
    reference_id: item.reference_id,
    reference_kind: item.reference_kind,
    reference_sha256: item.reference_sha256,
    width: item.width,
    height: item.height,
    feature_count: item.feature_count,
    features: item.features
  }));

  const ranked = rankGeometricCandidates(photo.features, candidates, FEATURE_OPTIONS);
  const winner = ranked[0] || null;
  const geometricGroundTruthRank = ranked.findIndex(item => normalizeCode(item.capa_code) === normalizeCode(sample.ground_truth));
  const vectorGroundTruthRank = candidates.findIndex(item => normalizeCode(item.capa_code) === normalizeCode(sample.ground_truth));
  const vectorTop1 = candidates[0] || null;
  const sameContentExclusions = holdout.excluded_same_content.map(item => ({
    capa_code: normalizeCode(item.capa_code),
    reference_id: item.reference_id,
    reference_kind: item.reference_kind,
    vector_rank: item.vector_rank,
    reference_sha256: item.reference_sha256
  }));

  const result = {
    status: 'evaluated',
    occurrence_id: sample.occurrence_id,
    platform: sample.platform,
    ground_truth: sample.ground_truth,
    ground_truth_in_vector_top10: vectorGroundTruthRank >= 0,
    vector_ground_truth_rank: vectorGroundTruthRank >= 0 ? vectorGroundTruthRank + 1 : null,
    vector_top1: vectorTop1?.capa_code || null,
    vector_top1_score: vectorTop1?.vector_score ?? null,
    vector_top1_correct: normalizeCode(vectorTop1?.capa_code) === normalizeCode(sample.ground_truth),
    pre_content_holdout: {
      vector_top1: sample.vector_top1,
      vector_top1_score: sample.vector_top1_score,
      correct_cover_rank_within_top10: sample.correct_cover_rank_within_top10
    },
    photo_feature_count: photo.feature_count,
    photo_sha256: photo.sha256,
    content_holdout: {
      applied: true,
      algorithm: 'sha256-exact-response-bytes',
      query_hash_missing: false,
      reference_pool_size: holdout.reference_pool_size,
      references_examined: holdout.references_examined,
      selected_cover_count: candidates.length,
      excluded_same_content_count: sameContentExclusions.length,
      excluded_same_content: sameContentExclusions,
      same_content_ground_truth_reference_excluded: sameContentExclusions.some(item => normalizeCode(item.capa_code) === normalizeCode(sample.ground_truth)),
      unhashed_reference_count: holdout.unhashed_references.length,
      load_error_count: holdout.load_errors.length,
      load_errors: holdout.load_errors,
      exhausted_before_limit: holdout.exhausted_before_limit
    },
    geometric_top1: winner?.capa_code || null,
    geometric_top1_correct: normalizeCode(winner?.capa_code) === normalizeCode(sample.ground_truth),
    geometric_top1_valid: winner?.valid === true,
    geometric_ground_truth_rank: geometricGroundTruthRank >= 0 ? geometricGroundTruthRank + 1 : null,
    elapsed_ms: Math.round(performance.now() - started),
    candidates: ranked.map(item => ({
      capa_code: item.capa_code,
      vector_rank: item.vector_rank,
      cover_rank: item.cover_rank,
      vector_score: item.vector_score,
      reference_id: item.reference_id,
      reference_kind: item.reference_kind,
      reference_sha256: item.reference_sha256,
      feature_count: item.feature_count,
      valid: item.valid,
      geometric_score: item.score,
      good_matches: item.good_matches,
      inliers: item.inliers,
      inlier_ratio: item.inlier_ratio,
      reference_coverage: item.reference_coverage,
      mean_squared_error: item.mean_squared_error,
      load_error: item.load_error || null
    }))
  };

  result.retrieval_gate = evaluateRetrievalGate(result, RETRIEVAL_GATE);
  result.geometric_gate_observed_v815 = evaluateGeometricGate(result, GEOMETRIC_GATES.observed_v815);
  result.geometric_gate_strict_core_v816 = evaluateGeometricGate(result, GEOMETRIC_GATES.strict_core_v816);
  return result;
}

async function loadManifest() {
  const response = await fetch('/api/admin/geometric-shadow-manifest', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 50, offset: 0 })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Manifest HTTP ${response.status}`);
  return payload;
}

async function run() {
  runButton.disabled = true;
  downloadButton.disabled = true;
  outputEl.textContent = '';
  progressEl.value = 0;
  setStatus('Carregando manifest do benchmark v8.17...');
  try {
    const manifest = await loadManifest();
    const ready = manifest.results.filter(item => item.status === 'ready');
    const skipped = manifest.results.filter(item => item.status !== 'ready');
    const results = [];
    progressEl.max = Math.max(1, ready.length);

    for (let i = 0; i < ready.length; i++) {
      const sample = ready[i];
      setStatus(`Content holdout + geometria ${i + 1}/${ready.length}: ocorrência ${sample.occurrence_id} (${sample.platform})`);
      try {
        results.push(await runSample(sample));
      } catch (error) {
        results.push({
          status: 'skipped',
          occurrence_id: sample.occurrence_id,
          platform: sample.platform,
          ground_truth: sample.ground_truth,
          reason: 'content_holdout_or_geometric_processing_failed',
          error: String(error?.message || error)
        });
      }
      progressEl.value = i + 1;
      await yieldUi();
    }

    const baseline = summarizeBaseline(results);
    const contentHoldout = summarizeContentHoldout(results);
    const hybrid = summarizeHybridGates(results);
    lastReport = {
      ok: true,
      methodology: 'held-out+d1-authoritative+platform-scoped+vector-top50+sha256-reference-content-holdout+distinct-cover-top10+browser-orb-like-brief+ransac-homography+hybrid-gate+exact-query-dedupe-shadow',
      production_changed: false,
      generated_at: new Date().toISOString(),
      feature_options: FEATURE_OPTIONS,
      retrieval_gate: RETRIEVAL_GATE,
      geometric_gates: GEOMETRIC_GATES,
      geometric_rollout_gate: GEOMETRIC_ROLLOUT_GATE,
      manifest_methodology: manifest.methodology,
      manifest_reference_pool_limit: manifest.reference_pool_limit ?? null,
      manifest_skipped: skipped,
      summary: {
        ...baseline,
        reference_content_holdout: contentHoldout,
        hybrid,
        production_changed: false
      },
      results
    };
    outputEl.textContent = JSON.stringify(lastReport.summary, null, 2);
    setStatus('Benchmark v8.17 concluído. Baixe o JSON e envie para análise.');
    downloadButton.disabled = false;
  } catch (error) {
    setStatus(`Erro: ${String(error?.message || error)}`);
  } finally {
    runButton.disabled = false;
  }
}

function download() {
  if (!lastReport) return;
  const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'geometric-hybrid-content-holdout-benchmark.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

runButton.addEventListener('click', run);
downloadButton.addEventListener('click', download);
