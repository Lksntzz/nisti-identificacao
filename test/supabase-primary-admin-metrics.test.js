import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const metrics=fs.readFileSync('src/system-metrics-clean-router.js','utf8');
const recognition=fs.readFileSync('src/recognition-metrics.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261001250000_primary_admin_metrics_reads_v1.sql','utf8');

test('Admin metrics and recognition reads use Supabase when reads are enabled',()=>{
  assert.match(metrics,/supabaseReadsRequested\(env\)/);
  assert.match(metrics,/nisti_system_metrics_core_v1/);
  assert.match(metrics,/nisti_system_health_core_v1/);
  assert.match(recognition,/nisti_recognition_events_v1/);
  assert.match(recognition,/nisti_operator_stats_v1/);
  assert.match(recognition,/nisti_recognition_metrics_v1/);
});

test('Admin metrics read RPCs are invoker-only and service-role-only',()=>{
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  for(const name of [
    'nisti_recognition_events_v1',
    'nisti_operator_stats_v1',
    'nisti_recognition_metrics_v1',
    'nisti_system_metrics_core_v1',
    'nisti_system_health_core_v1'
  ]){
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});

test('Supabase health path does not require the D1 health check',()=>{
  const start=metrics.indexOf('async function handleSystemHealthFromSupabase');
  const end=metrics.indexOf('async function handleSystemHealth(env',start);
  const block=metrics.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.doesNotMatch(block,/env\.DB\.prepare/);
  assert.doesNotMatch(block,/Banco D1/);
  assert.match(block,/Banco primário \/ Supabase/);
});

test('Supabase health exposes pending visual references and scheduled repair context',()=>{
  const start=metrics.indexOf('async function handleSystemHealthFromSupabase');
  const end=metrics.indexOf('async function handleSystemHealth(env',start);
  const block=metrics.slice(start,end);
  assert.match(block,/nisti_vectorize_status_v1/);
  assert.match(block,/pendingVisualReferences/);
  assert.match(block,/pending_visual_references:pendingVisualReferences/);
  assert.match(block,/repair_schedule:'\*\/30 \* \* \* \*'/);
  assert.match(block,/ÍNDICE VISUAL/);
  assert.match(block,/operationalIssues=[\s\S]*pendingVisualReferences/);
});
