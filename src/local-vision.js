import { matchLocalCandidates as matchBatch, warmLocalVision } from './local-vision-v3.js';
import { buildPersonalizationMaskedInput } from './personalized-vision.js';

export { warmLocalVision };

const BATCH_SIZE = 8;
const PERSONALIZED_LIMIT = 8;

function betterResult(current, candidate) {
  if (!current) return candidate;
  if (candidate?.matched && !current?.matched) return candidate;
  if (!candidate?.matched && current?.matched) return current;
  return Number(candidate?.geometric_score || 0) > Number(current?.geometric_score || 0) ? candidate : current;
}

function personalizedDebug(rows) {
  return (rows || []).map(row => ({
    ...row,
    pass: `personalized-${row.pass || 'detail'}`
  }));
}

export async function matchLocalCandidates(photoFile, candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const deadlineMs = Number.isFinite(Number(options?.deadlineMs)) ? Number(options.deadlineMs) : null;
  const startedAt = Date.now();
  const deadlineExceeded = () => deadlineMs !== null && (Date.now() - startedAt) >= deadlineMs;

  let best = null;
  let totalMs = 0;
  let tested = 0;
  let stoppedByDeadline = false;
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

    if (deadlineExceeded()) {
      stoppedByDeadline = true;
      break;
    }

    // Cede o event loop entre lotes para o Safari poder liberar memória e pintar a UI.
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Capas personalizadas podem trocar inicial/nome sem trocar o modelo da capa.
  // Só executamos este passe se o comparador original falhar, se ainda houver
  // orçamento de tempo, e mantemos os mesmos limiares geométricos: o fallback
  // remove a região variável, não reduz a exigência de segurança.
  if (list.length && !stoppedByDeadline && !deadlineExceeded()) {
    let prepared = null;
    try {
      prepared = await buildPersonalizationMaskedInput(photoFile, list.slice(0, PERSONALIZED_LIMIT));
      const personalized = await matchBatch(prepared.photo, prepared.candidates);
      totalMs += Number(personalized?.local_cv_ms || 0);
      tested += Number(personalized?.candidates_tested || prepared.candidates.length);
      const maskedDebug = personalizedDebug(personalized?.debug_candidates);
      debug.push(...maskedDebug);
      best = betterResult(best, personalized);

      if (personalized?.matched) {
        return {
          ...personalized,
          candidates_tested: tested,
          local_cv_ms: totalMs,
          debug_candidates: debug,
          runner: `${personalized.runner || 'jsfeat-orb-ransac-v3'}+personalization-mask`
        };
      }
    } catch (error) {
      debug.push({
        capa_code: '',
        pass: 'personalized-error',
        accepted: false,
        good_matches: 0,
        inliers: 0,
        inlier_ratio: 0,
        median_distance: null,
        geometric_score: 0,
        local_error: String(error?.message || error).slice(0, 220)
      });
    } finally {
      prepared?.cleanup?.();
    }
  }

  // A geometria local continua sendo a primeira linha de decisão. Quando ela
  // não consegue confirmar nenhuma capa (ou estoura o orçamento de tempo
  // definido pelo chamador), lançamos uma falha controlada para o fluxo já
  // existente do app acionar /api/identify, que usa o verificador estrutural
  // do Gemini e ignora nome/inicial personalizados. Assim não reduzimos os
  // limiares ORB/RANSAC e evitamos falsos negativos como MCP1.
  const inconclusive = new Error(
    stoppedByDeadline
      ? 'Verificação geométrica excedeu o tempo local disponível; acionar verificador estrutural.'
      : 'Verificação geométrica inconclusiva; acionar verificador estrutural.'
  );
  inconclusive.code = stoppedByDeadline ? 'LOCAL_GEOMETRY_DEADLINE_EXCEEDED' : 'LOCAL_GEOMETRY_INCONCLUSIVE';
  inconclusive.local_match = {
    ...(best || {}),
    matched: false,
    capa_code: '',
    candidates_tested: tested,
    local_cv_ms: totalMs,
    debug_candidates: debug,
    stopped_by_deadline: stoppedByDeadline,
    runner: `${best?.runner || 'jsfeat-orb-ransac-v3'}+progressive-batches+personalization-mask`
  };
  throw inconclusive;
}
