import {
  rgbaToGray,
  extractOrbLikeFeatures,
  rankGeometricCandidates
} from './geometric-core.js';
import {
  RETRIEVAL_GATE,
  GEOMETRIC_GATES,
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

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

async function blobFromUrl(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Falha ao carregar imagem ${response.status}: ${url}`);
  return response.blob();
}

async function imageFeatures(url, cache = false, includeHash = false) {
  if (cache && referenceCache.has(url)) return referenceCache.get(url);
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
  if (cache) referenceCache.set(url, promise);
  try { return await promise; }
  catch (error) { if (cache) referenceCache.delete(url); throw error; }
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

async function runSample(sample) {
  const started = performance.now();
  const photo = await imageFeatures(sample.occurrence_image_url, false, true);
  const candidates = [];
  for (const candidate of sample.candidates) {
    try {
      const ref = await imageFeatures(candidate.image_url, true, false);
      candidates.push({
        capa_code: candidate.capa_code,
        vector_rank: candidate.cover_rank,
        vector_score: candidate.retrieval_score,
        reference_id: candidate.reference_id,
        reference_kind: candidate.reference_kind,
        width: ref.width,
        height: ref.height,
        feature_count: ref.feature_count,
        features: ref.features
      });
    } catch (error) {
      candidates.push({
        capa_code: candidate.capa_code,
        vector_rank: candidate.cover_rank,
        vector_score: candidate.retrieval_score,
        reference_id: candidate.reference_id,
        reference_kind: candidate.reference_kind,
        width: 1,
        height: 1,
        feature_count: 0,
        features: [],
        load_error: String(error?.message || error)
      });
    }
  }

  const ranked = rankGeometricCandidates(photo.features, candidates, FEATURE_OPTIONS);
  const winner = ranked[0] || null;
  const groundTruthRank = ranked.findIndex(item => item.capa_code === sample.ground_truth);
  const result = {
    status: 'evaluated',
    occurrence_id: sample.occurrence_id,
    platform: sample.platform,
    ground_truth: sample.ground_truth,
    ground_truth_in_vector_top10: sample.correct_cover_rank_within_top10 !== null,
    vector_ground_truth_rank: sample.correct_cover_rank_within_top10,
    vector_top1: sample.vector_top1,
    vector_top1_score: sample.vector_top1_score,
    vector_top1_correct: sample.vector_top1 === sample.ground_truth,
    photo_feature_count: photo.feature_count,
    photo_sha256: photo.sha256,
    geometric_top1: winner?.capa_code || null,
    geometric_top1_correct: winner?.capa_code === sample.ground_truth,
    geometric_top1_valid: winner?.valid === true,
    geometric_ground_truth_rank: groundTruthRank >= 0 ? groundTruthRank + 1 : null,
    elapsed_ms: Math.round(performance.now() - started),
    candidates: ranked.map(item => ({
      capa_code: item.capa_code,
      vector_rank: item.vector_rank,
      vector_score: item.vector_score,
      reference_id: item.reference_id,
      reference_kind: item.reference_kind,
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
  setStatus('Carregando manifest do benchmark...');
  try {
    const manifest = await loadManifest();
    const ready = manifest.results.filter(item => item.status === 'ready');
    const skipped = manifest.results.filter(item => item.status !== 'ready');
    const results = [];
    progressEl.max = Math.max(1, ready.length);

    for (let i = 0; i < ready.length; i++) {
      const sample = ready[i];
      setStatus(`Analisando ${i + 1}/${ready.length}: ocorrência ${sample.occurrence_id} (${sample.platform})`);
      try {
        results.push(await runSample(sample));
      } catch (error) {
        results.push({
          status: 'skipped',
          occurrence_id: sample.occurrence_id,
          platform: sample.platform,
          ground_truth: sample.ground_truth,
          reason: 'geometric_processing_failed',
          error: String(error?.message || error)
        });
      }
      progressEl.value = i + 1;
      await yieldUi();
    }

    const baseline = summarizeBaseline(results);
    const hybrid = summarizeHybridGates(results);
    lastReport = {
      ok: true,
      methodology: 'held-out+d1-authoritative+platform-scoped+vector-top10+browser-orb-like-brief+ransac-homography+hybrid-gate+exact-image-dedupe-shadow',
      production_changed: false,
      generated_at: new Date().toISOString(),
      feature_options: FEATURE_OPTIONS,
      retrieval_gate: RETRIEVAL_GATE,
      geometric_gates: GEOMETRIC_GATES,
      manifest_skipped: skipped,
      summary: {
        ...baseline,
        hybrid,
        production_changed: false
      },
      results
    };
    outputEl.textContent = JSON.stringify(lastReport.summary, null, 2);
    setStatus('Benchmark híbrido concluído. Baixe o JSON e envie para análise.');
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
  a.download = 'geometric-hybrid-shadow-benchmark.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

runButton.addEventListener('click', run);
downloadButton.addEventListener('click', download);
