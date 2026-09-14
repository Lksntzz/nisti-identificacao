import {
  mirrorSupabaseRpc,
  supabaseMirrorWritesRequested
} from './supabase-write-store.js';

export async function mirrorAmbiguousReviewStateFromD1(env, occurrenceId) {
  if (!supabaseMirrorWritesRequested(env)) return { attempted: false, ok: true };
  const id = Number(occurrenceId || 0);
  if (!Number.isInteger(id) || id <= 0) return { attempted: false, ok: true };

  const [{ results: candidates }, session] = await Promise.all([
    env.DB.prepare(`
      SELECT occurrence_id,capa_code,candidate_rank,retrieval_score,reference_id,reference_kind,created_at
      FROM scan_occurrence_candidates
      WHERE occurrence_id=?
      ORDER BY candidate_rank ASC,capa_code ASC
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT occurrence_id,review_token_hash,created_at
      FROM scan_occurrence_review_sessions
      WHERE occurrence_id=?
      LIMIT 1
    `).bind(id).first()
  ]);

  return mirrorSupabaseRpc(
    env,
    'nisti_mirror_ambiguous_review_state',
    {
      p_occurrence_id: id,
      p_candidates: candidates || [],
      p_session: session || null
    },
    `ambiguous review state ${id}`
  );
}
