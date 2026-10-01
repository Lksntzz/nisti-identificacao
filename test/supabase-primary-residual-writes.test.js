import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(
  'supabase/migrations/20261001230000_primary_operational_residual_writes_v1.sql',
  'utf8'
);
const metrics=fs.readFileSync('src/recognition-metrics.js','utf8');
const occurrences=fs.readFileSync('src/occurrences-router.js','utf8');
const systemMetrics=fs.readFileSync('src/system-metrics-clean-router.js','utf8');
const mutationMirror=fs.readFileSync('src/supabase-mutation-mirror.js','utf8');

test('residual operational primary RPCs are invoker-only and service-role-only',()=>{
  for(const name of [
    'nisti_record_recognition_event_v1',
    'nisti_create_scan_occurrence_v1',
    'nisti_dismiss_scan_occurrence_v1'
  ]){
    assert.match(migration,new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}`));
    assert.match(migration,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
    assert.match(migration,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`));
  }
  assert.doesNotMatch(migration,/SECURITY DEFINER/i);
  assert.ok((migration.match(/SECURITY INVOKER/g)||[]).length>=3);
});

test('recognition telemetry bypasses D1 in Supabase primary mode',()=>{
  const primary=metrics.indexOf('if (supabasePrimaryWritesRequested(env))');
  const d1=metrics.indexOf('INSERT INTO recognition_daily');
  assert.ok(primary>=0 && d1>primary);
  assert.match(metrics,/nisti_record_recognition_event_v1/);
});

test('occurrence create and dismiss bypass D1 in Supabase primary mode',()=>{
  const create=occurrences.indexOf("nisti_create_scan_occurrence_v1");
  const d1Create=occurrences.indexOf("INSERT INTO scan_occurrences");
  assert.ok(create>=0 && d1Create>create);
  assert.match(occurrences,/nisti_dismiss_scan_occurrence_v1/);
  assert.ok(mutationMirror.includes("occurrences\\/\\d+\\/(?:train|dismiss)"));
});

test('operator rename bypasses D1 in Supabase primary mode',()=>{
  const primary=systemMetrics.indexOf('if (supabasePrimaryWritesRequested(env))');
  const update=systemMetrics.indexOf('UPDATE recognition_events',primary);
  assert.ok(primary>=0 && update>primary);
  assert.match(systemMetrics,/nisti_mirror_operator_name/);
});
