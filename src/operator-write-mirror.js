import { recordScanOccurrence as recordD1ScanOccurrence } from './occurrences-router.js';
import {
  mirrorSupabaseRpc,
  supabaseWriteMode
} from './supabase-write-store.js';

export async function recordScanOccurrence(env, input) {
  const mode = supabaseWriteMode(env);
  const occurrenceId = await recordD1ScanOccurrence(env, input);
  if (!occurrenceId || mode !== 'mirror') return occurrenceId;

  try {
    const row = await env.DB.prepare(`
      SELECT id, image_key, platform, suggested_capa_code, confidence, error_reason,
             operator_name, operator_id, status, trained_capa_code, trained_at, created_at
      FROM scan_occurrences
      WHERE id=?
      LIMIT 1
    `).bind(Number(occurrenceId)).first();

    if (!row) {
      console.error('[Supabase mirror] ocorrência D1 não pôde ser relida após insert', { occurrenceId });
      return occurrenceId;
    }

    await mirrorSupabaseRpc(env, 'nisti_mirror_scan_occurrence', {
      p_row: row
    }, 'scan occurrence');
  } catch (error) {
    console.error('[Supabase mirror] falha ao preparar ocorrência para espelhamento', {
      occurrenceId,
      message: error?.message || String(error)
    });
  }

  return occurrenceId;
}
