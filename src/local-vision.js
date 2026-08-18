import { matchLocalCandidates as matchBatch, warmLocalVision } from './local-vision-v3.js';

export { warmLocalVision };

const BATCH_SIZE = 8;

function betterResult(current, candidate) {
  if (!current) return candidate;
  if (candidate?.matched && !current?.matched) return candidate;
  if (!candidate?.matched && current?.matched) return current;
  return Number(candidate?.geometric_score || 0) > Number(current?.geometric_score || 0) ? candidate : current;
}

export async function matchLocalCandidates(photoFile, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  let best = null;
  let totalMs = 0;
  let tested = 0;
  const debug = [];

  for (let offset = 0; offset < list.length; offset += BATCH_SIZE) {
    const batch = list.slice(offset, offset + BATCH_SIZE);
    if (!batch.length) break;

    const result = await matchBatch(photoFile, batch);
    totalMs += Number(result?.local_cv_ms || 0);
    tested += Number(result?.candidates_tested || batch.length);
    if (Array.isArray(result?.debug_candidates)) debug.push(...result.debug_candidates);
    best = betterResult(best, result);

    if (result?.matched) {
      return {
        ...result,
        candidates_tested: tested,
        local_cv_ms: totalMs,
        debug_candidates: debug,
        runner: `${result.runner || 'jsfeat-orb-ransac-v3'}+progressive-batches`
      };
    }

    // Cede o event loop entre lotes para o Safari poder liberar memória e pintar a UI.
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  return {
    ...(best || {
      matched: false,
      capa_code: '',
      good_matches: 0,
      inliers: 0,
      inlier_ratio: 0,
      median_distance: null,
      geometric_score: 0,
      confidence: 0,
      ambiguous: false,
      runner: 'jsfeat-orb-ransac-v3+progressive-batches'
    }),
    matched: false,
    capa_code: '',
    candidates_tested: tested,
    local_cv_ms: totalMs,
    debug_candidates: debug,
    runner: `${best?.runner || 'jsfeat-orb-ransac-v3'}+progressive-batches`
  };
}
