import { Buffer } from 'node:buffer';
import { buildVectorizeCandidates } from './vectorize-candidates.js';
import { canonicalizeActiveVectorMatches } from './vector-match-authority.js';

const VERIFICATION_COVER_LIMIT = 1;
const SHADOW_COVER_LIMIT = 10;
const SHADOW_TTL_SECONDS = 15 * 60;
const SHADOW_PURPOSE = 'geometric-shadow-evidence-v818';

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function ticketKey(secret) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    textBytes(`nisti-local-vision:${secret}`)
  );
  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function decodeTicketPayload(ticket) {
  const [encoded] = String(ticket || '').split('.', 1);
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function signTicket(env, payload) {
  const secret = String(
    env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || ''
  );
  if (!secret) throw new Error('Chave de segurança para tickets não configurada');

  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const key = await ticketKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textBytes(encoded))
  );
  return `${encoded}.${base64url(signature)}`;
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function restrictTicketPayloadToTop1(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const sourceCodes = Array.isArray(payload.codes) ? payload.codes : [];
  const topCode = normalizeCode(sourceCodes[0]);
  if (!topCode) return null;

  const sourceScores = payload.scores && typeof payload.scores === 'object'
    ? payload.scores
    : {};
  const sourceReferences = Array.isArray(payload.references)
    ? payload.references
    : [];

  const { reference_evidence: _referenceEvidence, ...productionPayload } = payload;

  return {
    ...productionPayload,
    codes: [topCode].slice(0, VERIFICATION_COVER_LIMIT),
    scores: {
      [topCode]: Number(sourceScores[topCode] ?? 0)
    },
    references: sourceReferences.filter(
      item => normalizeCode(item?.capa_code) === topCode
    )
  };
}

function asVectorMatch(candidate) {
  return {
    id: String(candidate?.vector_id || candidate?.reference_id || ''),
    score: Number(candidate?.retrieval_score || 0),
    metadata: {
      reference_id: Number(candidate?.reference_id || 0) || null,
      capa_code: normalizeCode(candidate?.capa_code),
      image_key: candidate?.image_key || null,
      source_product_id: Number(candidate?.product_id || 0) || null,
      reference_kind: candidate?.reference_kind || null,
      platform: candidate?.platform || null
    },
    __candidate: candidate
  };
}

export function rebuildPayloadFromAuthoritativeMatches(sourcePayload, matches) {
  if (!sourcePayload || typeof sourcePayload !== 'object') return null;

  const covers = [];
  const seenCodes = new Set();
  for (const match of matches || []) {
    const code = normalizeCode(match?.metadata?.capa_code);
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    covers.push({
      code,
      score: Number(match?.score || 0),
      reference_id: Number(match?.metadata?.reference_id || 0) || null,
      reference_kind: String(match?.metadata?.reference_kind || '').trim().toLowerCase() || null,
      vector_rank: Number(match?.__candidate?.vector_rank || match?.metadata?.vector_rank || covers.length + 1),
      candidate: match?.__candidate || null,
      canonical: match?.metadata || {}
    });
  }

  if (!covers.length) return null;

  const performance = {
    ...(sourcePayload.performance || {}),
    retrieval_top1: covers[0]?.score ?? null,
    retrieval_top1_code: covers[0]?.code || null,
    retrieval_top2: covers[1]?.score ?? null,
    retrieval_top2_code: covers[1]?.code || null,
    retrieval_margin: covers.length > 1
      ? Number(covers[0].score || 0) - Number(covers[1].score || 0)
      : 1,
    cover_candidate_count: covers.length,
    vector_authority: 'd1-active-reference'
  };

  return {
    payload: {
      ...sourcePayload,
      codes: covers.map(item => item.code),
      scores: Object.fromEntries(covers.map(item => [item.code, item.score])),
      references: covers.map(item => ({
        reference_id: item.reference_id,
        capa_code: item.code,
        retrieval_score: item.score,
        vector_rank: item.vector_rank,
        reference_kind: item.reference_kind
      })),
      performance
    },
    candidates: covers.map(item => item.candidate ? ({
      ...item.candidate,
      reference_id: item.reference_id,
      product_id: Number(item.canonical?.source_product_id || 0) || null,
      capa_code: item.code,
      reference_kind: item.reference_kind,
      image_key: item.canonical?.image_key || item.candidate.image_key || null,
      retrieval_score: item.score
    }) : null).filter(Boolean)
  };
}

export function buildShadowEvidencePayload(
  rebuiltPayload,
  rebuiltCandidates,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    nonce = crypto.randomUUID(),
    referenceEvidence = []
  } = {}
) {
  if (!rebuiltPayload || typeof rebuiltPayload !== 'object') return null;
  const platform = String(rebuiltPayload.platform || '').trim().toUpperCase();
  if (!platform) return null;

  const candidates = [];
  const seenCodes = new Set();
  for (const candidate of rebuiltCandidates || []) {
    const capaCode = normalizeCode(candidate?.capa_code);
    const referenceId = Number(candidate?.reference_id || 0) || null;
    const retrievalScore = Number(candidate?.retrieval_score);
    const imageKey = String(candidate?.image_key || '').trim();
    if (!capaCode || seenCodes.has(capaCode) || !referenceId || !imageKey || !Number.isFinite(retrievalScore)) continue;
    seenCodes.add(capaCode);
    const version = imageKey.split('/').pop() || 'current';
    candidates.push({
      capa_code: capaCode,
      cover_rank: candidates.length + 1,
      vector_rank: Number(candidate?.vector_rank || candidates.length + 1),
      retrieval_score: retrievalScore,
      reference_id: referenceId,
      reference_kind: String(candidate?.reference_kind || 'product').trim().toLowerCase() || 'product',
      image_url: `/api/reference-images/${referenceId}?v=${encodeURIComponent(version)}`
    });
    if (candidates.length >= SHADOW_COVER_LIMIT) break;
  }

  if (candidates.length < 2) return null;

  const diagnosticReferences = [];
  const seenReferenceIds = new Set();
  for (const reference of referenceEvidence || []) {
    const capaCode = normalizeCode(reference?.capa_code);
    const referenceId = Number(reference?.reference_id || 0) || null;
    const retrievalScore = Number(reference?.retrieval_score);
    const vectorRank = Number(reference?.vector_rank || diagnosticReferences.length + 1);
    if (
      !capaCode ||
      !referenceId ||
      seenReferenceIds.has(referenceId) ||
      !Number.isFinite(retrievalScore) ||
      !Number.isFinite(vectorRank)
    ) continue;
    seenReferenceIds.add(referenceId);
    diagnosticReferences.push({
      capa_code: capaCode,
      retrieval_score: retrievalScore,
      vector_rank: vectorRank,
      reference_id: referenceId,
      reference_kind: String(reference?.reference_kind || 'product').trim().toLowerCase() || 'product'
    });
    if (diagnosticReferences.length >= 50) break;
  }
  diagnosticReferences.sort((a, b) => a.vector_rank - b.vector_rank);

  const token = String(nonce || '').trim();
  if (!token) return null;
  const signedPayload = {
    purpose: SHADOW_PURPOSE,
    exp: Number(nowSeconds) + SHADOW_TTL_SECONDS,
    nonce: token,
    platform,
    candidates: candidates.map(candidate => ({
      capa_code: candidate.capa_code,
      vector_rank: candidate.vector_rank,
      retrieval_score: candidate.retrieval_score,
      reference_id: candidate.reference_id,
      reference_kind: candidate.reference_kind
    })),
    reference_evidence: diagnosticReferences
  };

  return {
    token,
    signed_payload: signedPayload,
    candidates,
    reference_evidence: diagnosticReferences
  };
}

function staleIndexResponse(data) {
  return new Response(JSON.stringify({
    error: 'O índice vetorial contém apenas referências que não estão mais ativas no catálogo.',
    technical_error: 'vector_index_stale',
    performance: {
      ...(data?.performance || {}),
      vector_authority: 'd1-active-reference',
      authoritative_candidate_count: 0
    }
  }), {
    status: 422,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function buildVectorizeTop1Candidates(request, env) {
  const response = await buildVectorizeCandidates(request, env);
  if (!response?.ok) return response;

  const data = await response.clone().json().catch(() => null);
  if (!data?.ticket) return response;

  const sourcePayload = decodeTicketPayload(data.ticket);
  if (!sourcePayload) return response;

  const rawMatches = (Array.isArray(data.candidates) ? data.candidates : [])
    .map(asVectorMatch);
  const authoritativeMatches = await canonicalizeActiveVectorMatches(env, rawMatches);

  const rawReferenceEvidence = (Array.isArray(sourcePayload.reference_evidence)
    ? sourcePayload.reference_evidence
    : []).map(asVectorMatch);
  const authoritativeReferenceMatches = await canonicalizeActiveVectorMatches(env, rawReferenceEvidence);
  const authoritativeReferenceEvidence = authoritativeReferenceMatches.map((match, index) => ({
    reference_id: Number(match?.metadata?.reference_id || 0) || null,
    product_id: Number(match?.metadata?.source_product_id || 0) || null,
    capa_code: normalizeCode(match?.metadata?.capa_code),
    retrieval_score: Number(match?.score || 0),
    vector_rank: Number(match?.__candidate?.vector_rank || index + 1),
    reference_kind: String(match?.metadata?.reference_kind || 'product').trim().toLowerCase() || 'product'
  })).filter(reference => reference.reference_id && reference.capa_code);

  const rebuilt = rebuildPayloadFromAuthoritativeMatches(sourcePayload, authoritativeMatches);
  if (!rebuilt?.payload?.codes?.length) return staleIndexResponse(data);

  const top1Payload = restrictTicketPayloadToTop1(rebuilt.payload);
  if (!top1Payload?.codes?.length) return staleIndexResponse(data);

  const topCode = top1Payload.codes[0];
  const ticket = await signTicket(env, top1Payload);
  const candidates = rebuilt.candidates
    .filter(item => normalizeCode(item?.capa_code) === topCode)
    .slice(0, 1);

  let shadowEvidence = null;
  const shadow = buildShadowEvidencePayload(rebuilt.payload, rebuilt.candidates, {
    referenceEvidence: authoritativeReferenceEvidence
  });
  if (shadow) {
    const shadowTicket = await signTicket(env, shadow.signed_payload);
    shadowEvidence = {
      version: 'v8.18',
      gate: 'strict_core_v816',
      token: shadow.token,
      ticket: shadowTicket,
      candidates: shadow.candidates,
      reference_evidence_count: shadow.reference_evidence.length,
      production_changed: false
    };
  }

  const performance = {
    ...(data.performance || {}),
    ...(rebuilt.payload.performance || {}),
    verification_strategy: 'vectorize-top1-binary',
    verification_cover_limit: VERIFICATION_COVER_LIMIT,
    verification_candidate_count: candidates.length,
    authoritative_candidate_count: rebuilt.candidates.length,
    shadow_evidence_candidate_count: shadowEvidence?.candidates?.length || 0,
    shadow_reference_evidence_count: shadowEvidence?.reference_evidence_count || 0,
    shadow_evidence_version: shadowEvidence ? 'v8.18' : null
  };

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(JSON.stringify({
    ...data,
    ticket,
    candidates,
    shadow_evidence: shadowEvidence,
    performance
  }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}