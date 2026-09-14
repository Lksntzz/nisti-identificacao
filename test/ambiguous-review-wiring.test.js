import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operatorRouter = readFileSync(new URL('../src/operator-audit-router.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/shadow-confirmation-client.js', import.meta.url), 'utf8');
const mirrorRouter = readFileSync(new URL('../src/ambiguous-review-mirror-router.js', import.meta.url), 'utf8');
const d1Migration = readFileSync(new URL('../migrations/0014_ambiguous_review_candidates.sql', import.meta.url), 'utf8');
const supabaseMigration = readFileSync(new URL('../supabase/migrations/202609141330_nisti_ambiguous_review_mirror_v1.sql', import.meta.url), 'utf8');

test('v8.25 routes operator traffic through Supabase-safe ambiguous review wrapper', () => {
  assert.match(operatorRouter, /import app from '\.\/ambiguous-review-mirror-router\.js'/);
  assert.match(mirrorRouter, /import app from '\.\/ambiguous-review-router\.js'/);
  assert.match(mirrorRouter, /mirrorOccurrenceStateFromD1/);
  assert.match(mirrorRouter, /mirrorTrainedOccurrenceArtifactsFromD1/);
  assert.match(mirrorRouter, /mirrorAmbiguousReviewStateFromD1/);
});

test('v8.25 mounts the supervised ambiguous review prompt', () => {
  assert.match(entry, /import\('\.\/ambiguous-review-prompt\.jsx'\)/);
  assert.match(entry, /<AmbiguousReviewPrompt \/>/);
});

test('v8.25 client starts review only for ambiguous_top1_margin', () => {
  assert.match(client, /data\?\.technical_error === 'ambiguous_top1_margin'/);
  assert.match(client, /\/api\/operator\/ambiguous-review\/start/);
  assert.match(client, /occurrence_id: review\.occurrence_id/);
  assert.match(client, /sent_to_adm: review\.sent_to_adm/);
});

test('v8.25 links a late-created review occurrence back to shadow evidence', () => {
  assert.match(client, /linkAmbiguousOccurrence/);
  assert.match(client, /\/link-occurrence/);
  assert.match(client, /shadow_ticket: shadowTicket/);
  assert.match(client, /occurrence_id: id/);
});

test('v8.25 persists review candidates and token hashes in D1 and Supabase mirror state', () => {
  assert.match(d1Migration, /CREATE TABLE IF NOT EXISTS scan_occurrence_candidates/);
  assert.match(d1Migration, /CREATE TABLE IF NOT EXISTS scan_occurrence_review_sessions/);
  assert.match(supabaseMigration, /CREATE TABLE IF NOT EXISTS public\.scan_occurrence_candidates/);
  assert.match(supabaseMigration, /CREATE TABLE IF NOT EXISTS public\.scan_occurrence_review_sessions/);
  assert.match(supabaseMigration, /SECURITY INVOKER/);
  assert.match(supabaseMigration, /TO service_role/);
});
