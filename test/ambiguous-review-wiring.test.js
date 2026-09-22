import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operatorRouter = readFileSync(new URL('../src/operator-audit-router.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/shadow-confirmation-client.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0014_ambiguous_review_candidates.sql', import.meta.url), 'utf8');

test('v8.24.2 routes operator traffic through ambiguous review router', () => {
  assert.match(operatorRouter, /import app from '\.\/ambiguous-review-router\.js'/);
});

test('v8.24.2 mounts the supervised ambiguous review prompt', () => {
  assert.match(entry, /import\('\.\/ambiguous-review-prompt\.jsx'\)/);
  assert.match(entry, /<AmbiguousReviewPrompt \/>/);
});

test('v8.24.2 client starts review only for ambiguous_top1_margin', () => {
  assert.match(client, /data\?\.technical_error === 'ambiguous_top1_margin'/);
  assert.match(client, /\/api\/operator\/ambiguous-review\/start/);
  assert.match(client, /occurrence_id: review\.occurrence_id/);
  assert.match(client, /sent_to_adm: review\.sent_to_adm/);
});

test('v8.24.2 links a late-created review occurrence back to shadow evidence', () => {
  assert.match(client, /linkAmbiguousOccurrence/);
  assert.match(client, /\/link-occurrence/);
  assert.match(client, /shadow_ticket: shadowTicket/);
  assert.match(client, /occurrence_id: id/);
});

test('v8.24.2 migration persists candidates and an unguessable review token hash', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS scan_occurrence_candidates/);
  assert.match(migration, /PRIMARY KEY \(occurrence_id, capa_code\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS scan_occurrence_review_sessions/);
  assert.match(migration, /review_token_hash TEXT NOT NULL UNIQUE/);
});
