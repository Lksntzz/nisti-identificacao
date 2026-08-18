import { matchLocalCandidates as matchLocalCandidatesV2, warmLocalVision } from './local-vision-v2.js';

export { warmLocalVision };

const BATCH_SIZE = 8;

function betterResult(current, candidate) {
  if (!current) return candidate;
  if (candidate?.matched && !current?.matched) return candidate;
  if (!candidate?.matched && current?.matched) return current;
  const currentScore = Number(current?.geometric_score || 0);
  const candidateScore = Number(candidate?.geometric_score || 0);
  return candidateScore > currentScore ? candidate : current;
}

export async function matchLocalCandidates(photoFile, candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let best = null;
  let totalMs = 0;
  let tested = 0;
  const debug = [];

  // O embedding prioriza as capas; esta camada percorre os MKPs reais em lotes
  // pequenos. Não existe mais corte de 5 s: paramos cedo quando há confirmação
  // geométrica segura e seguimos para os lotes seguintes quando necessário.
  for (let offset = 0; offset < list.length; offset += BATCH_SIZE) {
    const batch = list.slice(offset, offset + BATCH_SIZE);
    if (!batch.length) break;

    const result = await matchLocalCandidatesV2(photoFile, batch, {
      ...options,
      deadlineMs: Number.MAX_SAFE_INTEGER
    });

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
        runner: `${result.runner || 'jsfeat-orb-ransac'}+registered-mockup-batches`
      };
    }
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
      runner: 'jsfeat-orb-ransac+registered-mockup-batches'
    }),
    matched: false,
    capa_code: '',
    candidates_tested: tested,
    local_cv_ms: totalMs,
    debug_candidates: debug,
    runner: `${best?.runner || 'jsfeat-orb-ransac'}+registered-mockup-batches`
  };
}
