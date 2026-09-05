import { recordScanOccurrence as recordD1ScanOccurrence } from './occurrences-router.js';
import {
  mirrorSupabaseRpc,
  supabaseWriteMode
} from './supabase-write-store.js';

export async function recordScanOccurrence(env, input) {
  const mode = supabaseWriteMode(env);
  const occurrenceId = await recordD1ScanOccurrence(env, input);
  if (!occurrenceId || mode !== 'mirror') return occurrenceId;

  await mirrorSupabaseRpc(env, 'nisti_mirror_scan_occurrence', {
    p_row: {
      id: Number(occurrenceId),
      image_key: null,
      platform: input?.platform || null,
      suggested_capa_code: input?.suggestedCapaCode || null,
      confidence: Number(input?.confidence || 0),
      error_reason: input?.errorReason || 'no_match',
      operator_name: input?.operatorName || null,
      operator_id: input?.operatorId || null,
      created_at: new Date().toISOString()
    }
  }, 'scan occurrence');

  return occurrenceId;
}
