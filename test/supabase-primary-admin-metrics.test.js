import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const metrics=fs.readFileSync('src/system-metrics-clean-router.js','utf8');
const cleanup=fs.readFileSync('supabase/migrations/20261002115500_remove_ai_recognition_legacy.sql','utf8');

test('Admin metrics and health use only active Supabase operational RPCs',()=>{
  assert.match(metrics,/nisti_system_metrics_core_v1/);
  assert.match(metrics,/nisti_system_health_core_v1/);
  assert.match(metrics,/commerce_nisti_sync_status_v1/);
  assert.match(metrics,/commerce_nisti_product_statuses_v1/);
  assert.doesNotMatch(metrics,/recognition|embedding|vectorize|geometric/i);
});

test('AI cleanup migration removes recognition metrics and keeps core operational metrics',()=>{
  assert.match(cleanup,/nisti_system_metrics_core_v1/);
  assert.match(cleanup,/DROP TABLE IF EXISTS public\.recognition_events/);
  assert.match(cleanup,/DROP TABLE IF EXISTS public\.cover_reference_embeddings/);
  assert.doesNotMatch(cleanup,/DROP TABLE IF EXISTS public\.products/);
  assert.doesNotMatch(cleanup,/DROP TABLE IF EXISTS public\.mural_product_images/);
});

test('health path has no D1 or visual-index dependency',()=>{
  assert.doesNotMatch(metrics,/env\.DB\.prepare|Banco D1|nisti_vectorize_status_v1|ÍNDICE VISUAL/);
  assert.match(metrics,/Banco primário \/ Supabase/);
});
