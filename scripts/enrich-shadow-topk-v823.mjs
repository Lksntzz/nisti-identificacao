import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function write(relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.writeFileSync(filePath, content, 'utf8');
}

function replaceOnce(content, needle, replacement, label) {
  const first = content.indexOf(needle);
  if (first === -1) throw new Error(`Marcador ausente: ${label}`);
  if (content.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`Marcador ambíguo: ${label}`);
  }
  return `${content.slice(0, first)}${replacement}${content.slice(first + needle.length)}`;
}

function patchEvidenceRouter() {
  const file = 'src/geometric-shadow-evidence-router.js';
  let source = read(file);

  source = replaceOnce(
    source,
    "const GATE_VERSION = 'strict_core_v816';\nconst RETRIEVAL_MIN_SCORE = 0.920;",
    "const GATE_VERSION = 'strict_core_v816';\nconst EVIDENCE_SCHEMA_VERSION = 'v8.23';\nconst RETRIEVAL_MIN_SCORE = 0.920;",
    'evidence schema version constant'
  );

  source = replaceOnce(
    source,
    '      shadow_version: SHADOW_VERSION,\n      gate_version: GATE_VERSION,\n      production: {',
    '      shadow_version: SHADOW_VERSION,\n      gate_version: GATE_VERSION,\n      evidence_schema_version: EVIDENCE_SCHEMA_VERSION,\n      production: {',
    'evidence schema version payload'
  );

  source = replaceOnce(
    source,
    '      retrieval,\n      geometric\n    })',
    '      retrieval: {\n        ...retrieval,\n        candidates\n      },\n      geometric\n    })',
    'canonical signed TopK persistence'
  );

  write(file, source);
}

function patchObservabilityRouter() {
  const file = 'src/geometric-shadow-observability-router.js';
  let source = read(file);

  source = replaceOnce(
    source,
    `function parseEvidenceJson(value) {\n  try {\n    const parsed = JSON.parse(String(value || '{}'));\n    return parsed && typeof parsed === 'object' ? parsed : {};\n  } catch {\n    return {};\n  }\n}\n\nfunction clampLimit(value) {`,
    `function parseEvidenceJson(value) {\n  try {\n    const parsed = JSON.parse(String(value || '{}'));\n    return parsed && typeof parsed === 'object' ? parsed : {};\n  } catch {\n    return {};\n  }\n}\n\nfunction normalizeRetrievalCandidates(value) {\n  if (!Array.isArray(value)) return [];\n  return value\n    .slice(0, 10)\n    .map((candidate, index) => ({\n      capa_code: normalizeCode(candidate?.capa_code),\n      retrieval_score: finite(candidate?.retrieval_score),\n      vector_rank: Number(candidate?.vector_rank || index + 1) || index + 1,\n      reference_id: Number(candidate?.reference_id || 0) || null,\n      reference_kind: String(candidate?.reference_kind || '').trim().toLowerCase() || null\n    }))\n    .filter(candidate => candidate.capa_code && candidate.retrieval_score !== null)\n    .sort((a, b) => a.vector_rank - b.vector_rank);\n}\n\nfunction clampLimit(value) {`,
    'TopK normalization helper'
  );

  source = replaceOnce(
    source,
    '  const retrieval = evidence?.retrieval || {};\n  const geometric = evidence?.geometric || {};\n  const production = evidence?.production || {};',
    '  const retrieval = evidence?.retrieval || {};\n  const geometric = evidence?.geometric || {};\n  const production = evidence?.production || {};\n  const retrievalCandidates = normalizeRetrievalCandidates(retrieval?.candidates);',
    'observability TopK extraction'
  );

  source = replaceOnce(
    source,
    '    shadow_version: row?.shadow_version || evidence?.shadow_version || null,\n    gate_version: row?.gate_version || evidence?.gate_version || null,',
    '    shadow_version: row?.shadow_version || evidence?.shadow_version || null,\n    gate_version: row?.gate_version || evidence?.gate_version || null,\n    evidence_schema_version: evidence?.evidence_schema_version || null,',
    'observability schema version'
  );

  source = replaceOnce(
    source,
    '      margin: finite(retrieval?.margin),\n      reference_kind: retrieval?.reference_kind || null\n    },',
    '      margin: finite(retrieval?.margin),\n      reference_kind: retrieval?.reference_kind || null,\n      candidate_count: Number(evidence?.candidate_count || retrievalCandidates.length) || retrievalCandidates.length,\n      candidates: retrievalCandidates\n    },',
    'observability TopK response'
  );

  source = replaceOnce(
    source,
    "    observability_version: 'v8.20',",
    "    observability_version: 'v8.23',",
    'observability response version'
  );

  write(file, source);
}

function patchEvidenceTests() {
  const file = 'test/geometric-shadow-evidence.test.js';
  let source = read(file);

  source = replaceOnce(
    source,
    "  assert.equal(detail.production.capa_code, 'A');\n  assert.equal(detail.shadow_version, 'v8.18');\n});",
    "  assert.equal(detail.production.capa_code, 'A');\n  assert.equal(detail.shadow_version, 'v8.18');\n  assert.equal(detail.evidence_schema_version, 'v8.23');\n  assert.deepEqual(detail.retrieval.candidates.map(candidate => candidate.capa_code), ['A', 'B', 'C']);\n  assert.deepEqual(detail.retrieval.candidates.map(candidate => candidate.vector_rank), [1, 2, 3]);\n  assert.equal(detail.retrieval.candidates[2].reference_id, 3);\n  assert.equal(detail.retrieval.candidates[2].reference_kind, 'real_scan');\n});",
    'TopK persistence regression assertions'
  );

  write(file, source);
}

function patchObservabilityTests() {
  const file = 'test/geometric-shadow-observability.test.js';
  let source = read(file);

  source = replaceOnce(
    source,
    "    updated_at: '2026-09-02 23:00:00',\n    evidence_json: JSON.stringify({\n      production: { http_status: 200, capa_code: 'LTE2', identified_by: 'fallback' },",
    "    updated_at: '2026-09-02 23:00:00',\n    evidence_json: JSON.stringify({\n      evidence_schema_version: 'v8.23',\n      production: { http_status: 200, capa_code: 'LTE2', identified_by: 'fallback' },",
    'observability fixture schema version'
  );

  source = replaceOnce(
    source,
    "        margin: 0.0033,\n        reference_kind: 'product'\n      },",
    "        margin: 0.0033,\n        reference_kind: 'product',\n        candidates: [\n          { capa_code: 'LTE2', retrieval_score: 0.9214, vector_rank: 1, reference_id: 101, reference_kind: 'product' },\n          { capa_code: 'LTE1', retrieval_score: 0.9181, vector_rank: 2, reference_id: 102, reference_kind: 'real_scan' }\n        ]\n      },",
    'observability fixture TopK'
  );

  source = replaceOnce(
    source,
    "  assert.equal(normalized.geometric.capa_code, 'LTE1');\n  assert.equal(normalized.retrieval.margin, 0.0033);\n});",
    "  assert.equal(normalized.geometric.capa_code, 'LTE1');\n  assert.equal(normalized.retrieval.margin, 0.0033);\n  assert.equal(normalized.evidence_schema_version, 'v8.23');\n  assert.equal(normalized.retrieval.candidate_count, 2);\n  assert.deepEqual(normalized.retrieval.candidates.map(candidate => candidate.capa_code), ['LTE2', 'LTE1']);\n  assert.equal(normalized.retrieval.candidates[1].reference_id, 102);\n  assert.equal(normalized.retrieval.candidates[1].reference_kind, 'real_scan');\n});",
    'observability TopK assertions'
  );

  source = replaceOnce(
    source,
    "  assert.equal(normalized.verdict, 'geometric_incremental_incorrect');\n  assert.equal(normalized.would_fix_production, false);\n  assert.equal(normalized.would_worsen_production, true);\n});",
    "  assert.equal(normalized.verdict, 'geometric_incremental_incorrect');\n  assert.equal(normalized.would_fix_production, false);\n  assert.equal(normalized.would_worsen_production, true);\n  assert.deepEqual(normalized.retrieval.candidates, []);\n});",
    'legacy evidence backward compatibility assertion'
  );

  write(file, source);
}

patchEvidenceRouter();
patchObservabilityRouter();
patchEvidenceTests();
patchObservabilityTests();

console.log('v8.23 TopK shadow evidence enrichment applied successfully.');
