import { matchLocalCandidates as matchLocalCandidatesV2, warmLocalVision } from './local-vision-v2.js';

export { warmLocalVision };

export async function matchLocalCandidates(photoFile, candidates, options = {}) {
  // O frontend ainda pode enviar um deadline legado. Não usamos mais esse corte:
  // o verificador percorre as passadas necessárias e encerra assim que encontra
  // uma correspondência forte ou esgota as candidatas retornadas pelo embedding.
  return matchLocalCandidatesV2(photoFile, candidates, {
    ...options,
    deadlineMs: Number.MAX_SAFE_INTEGER
  });
}
