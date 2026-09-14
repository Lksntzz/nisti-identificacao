import app from './ambiguous-review-router.js';
import {
  mirrorOccurrenceStateFromD1,
  mirrorTrainedOccurrenceArtifactsFromD1
} from './supabase-write-store.js';
import { mirrorAmbiguousReviewStateFromD1 } from './supabase-ambiguous-review-store.js';

async function responseJson(response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

async function mirrorReviewMutation(url, request, response, env) {
  if (request.method !== 'POST') return;

  const data = await responseJson(response);
  const occurrenceId = Number(data?.occurrence_id || 0);
  if (!Number.isInteger(occurrenceId) || occurrenceId <= 0) return;

  if (url.pathname === '/api/operator/ambiguous-review/start') {
    // start can return a controlled 503 after the occurrence has already been
    // persisted. Mirror the occurrence even in that partial-failure case so
    // D1/Supabase do not diverge silently.
    await mirrorOccurrenceStateFromD1(env, occurrenceId);
    await mirrorAmbiguousReviewStateFromD1(env, occurrenceId);
    return;
  }

  if (url.pathname === '/api/operator/ambiguous-review/confirm' && response.ok) {
    await mirrorTrainedOccurrenceArtifactsFromD1(env, occurrenceId);
    await mirrorAmbiguousReviewStateFromD1(env, occurrenceId);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await app.fetch(request, env, ctx);

    try {
      await mirrorReviewMutation(url, request, response, env);
    } catch (error) {
      // D1 remains authoritative while mirror mode is active. Never manufacture
      // distributed rollback after the D1 mutation has committed.
      console.error('[Supabase mirror] ambiguous review mutation failed', {
        path: url.pathname,
        status: response.status,
        message: error?.message || String(error)
      });
    }

    return response;
  }
};
