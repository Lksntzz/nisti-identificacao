import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';
import {
  ensureVisualSignatureSchema,
  extractVisualSignature,
  normalizeVisualSignature
} from './visual-signatures.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_COVERS = 6;
const SUGGESTION_LIMIT = 3;
const MIN_ACCEPT_SCORE = 0.86;
const MIN_ACCEPT_MARGIN = 0.08;
const MIN_SUGGESTION_SCORE = 0.72;
const QUERY_SIGNATURE_TIMEOUT_MS = 5000;

class RecognitionError extends Error {
  constructor(message, status = 500, code = 'recognition_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function base64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
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
    ['verify']
  );
}

function cookieValue(request, name) {
  const source = request.headers.get('cookie') || '';
  for (const part of source.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

async function readSignedTicket(env, token) {
  try {
    const [encoded, signature] = String(token || '').split('.', 2);
    if (!encoded || !signature || !env.GEMINI_API_KEY) return null;
    const key = await ticketKey(String(env.GEMINI_API_KEY));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(signature),
      textBytes(encoded)
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(encoded))
    );
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function inheritTicketPerformance(performance, ticket) {
  const source = ticket?.performance && typeof ticket.performance === 'object'
    ? ticket.performance
    : {};
  const fields = [
    'embedding_ms', 'vectorize_ms', 'retrieval_top1', 'retrieval_top1_code',
    'retrieval_top2', 'retrieval_top2_code', 'retrieval_margin', 'vector_top_k',
    'reference_candidate_count', 'cover_candidate_count', 'candidate_lookup_ms',
    'read_photo_ms', 'model', 'platform', 'platform_key', 'vectorize_namespace'
  ];
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) {
      performance[field] = source[field];
    }
  }
  performance.candidate_generation_ms = Number(source.total_ms || 0);
}

function coversFromTicket(ticket) {
  const codes = Array.isArray(ticket?.codes) ? ticket.codes : [];
  const scores = ticket?.scores && typeof ticket.scores === 'object'
    ? ticket.scores
    : {};
  const refs = Array.isArray(ticket?.references) ? ticket.references : [];
  const covers = [];

  for (const rawCode of codes) {
    const capaCode = String(rawCode || '').trim().toUpperCase();
    if (!capaCode || covers.some(item => item.capa_code === capaCode)) continue;
    const reference = refs
      .filter(item => String(item?.capa_code || '').trim().toUpperCase() === capaCode)
      .sort((a, b) => Number(a?.vector_rank || 999999) - Number(b?.vector_rank || 999999))[0];
    covers.push({
      capa_code: capaCode,
      retrieval_rank: covers.length + 1,
      retrieval_score: Number(scores[capaCode] ?? reference?.retrieval_score ?? 0),
      reference_id: Number(reference?.reference_id || 0) || null
    });
    if (covers.length >= MAX_COVERS) break;
  }
  return covers;
}

function words(values) {
  const stop = new Set(['de','da','do','das','dos','e','a','o','as','os','para','com']);
  const set = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    for (const word of String(item || '').split(/\s+/)) {
      const token = word.trim();
      if (token.length < 2 || stop.has(token)) continue;
      set.add(token);
    }
  }
  return set;
}

function overlap(aValues, bValues) {
  const a = words(aValues);
  const b = words(bValues);
  if (!a.size || !b.size) return null;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(1, Math.min(a.size, b.size));
}

function retrievalSignal(score) {
  const value = Number(score || 0);
  return Math.max(0, Math.min(1, (value - 0.72) / 0.28));
}

function scoreSignature(query, reference, retrievalScore) {
  const signals = {
    text: overlap(query.fixed_text, reference.fixed_text),
    subjects: overlap(query.primary_subjects, reference.primary_subjects),
    graphics: overlap(query.graphic_elements, reference.graphic_elements),
    colors: overlap(query.colors, reference.colors),
    layout: overlap(query.layout_tokens, reference.layout_tokens),
    style: overlap(query.style_tokens, reference.style_tokens),
    retrieval: retrievalSignal(retrievalScore)
  };
  const weights = {
    text: 0.32,
    subjects: 0.25,
    graphics: 0.15,
    colors: 0.10,
    layout: 0.06,
    style: 0.04,
    retrieval: 0.08
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const value = signals[name];
    if (value === null || value === undefined) continue;
    weighted += value * weight;
    totalWeight += weight;
  }
  const score = totalWeight > 0 ? weighted / totalWeight : 0;

  const textConflict = signals.text !== null && signals.text < 0.34;
  const subjectConflict = signals.subjects !== null &&
    signals.subjects < 0.20 &&
    signals.graphics !== null &&
    signals.graphics < 0.25;

  const semanticStrongCount = [
    signals.text, signals.subjects, signals.graphics, signals.colors, signals.layout
  ].filter(value => value !== null && value >= 0.55).length;

  return {
    score,
    hard_conflict: textConflict || subjectConflict,
    semantic_strong_count: semanticStrongCount,
    signals
  };
}

async function loadReferenceSignatures(env, covers) {
  await ensureVisualSignatureSchema(env);
  const codes = covers.map(item => item.capa_code);
  if (!codes.length) return new Map();
  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT capa_code,reference_id,signature_json,signature_model,updated_at
    FROM cover_visual_signatures
    WHERE capa_code IN (${placeholders})
  `).bind(...codes).all();

  const map = new Map();
  for (const row of results || []) {
    try {
      map.set(String(row.capa_code || '').trim().toUpperCase(), {
        reference_id: Number(row.reference_id || 0) || null,
        model: row.signature_model,
        signature: normalizeVisualSignature(JSON.parse(row.signature_json || '{}'))
      });
    } catch {}
  }
  return map;
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    image_url: product.image_key
      ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
      : null
  };
}

async function productsForCover(env, capaCode, platform) {
  const { results } = await env.DB.prepare(`
    SELECT p.*, pp.platform, pp.link
    FROM products p
    JOIN product_platforms pp ON pp.product_id=p.id
    WHERE UPPER(TRIM(p.capa_code))=?
      AND UPPER(TRIM(pp.platform))=?
    ORDER BY p.id ASC, pp.id ASC
  `).bind(
    String(capaCode || '').trim().toUpperCase(),
    normalizePlatform(platform)
  ).all();

  const seen = new Set();
  return (results || []).filter(product => {
    const id = Number(product.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function buildSuggestions(env, ranked, platform) {
  const suggestions = [];
  for (const item of ranked) {
    if (suggestions.length >= SUGGESTION_LIMIT) break;
    if (item.score < MIN_SUGGESTION_SCORE && item.retrieval_score < 0.80) continue;
    if (item.hard_conflict) continue;
    const products = await productsForCover(env, item.capa_code, platform);
    if (!products.length) continue;
    suggestions.push({
      capa_code: item.capa_code,
      confidence: item.score,
      retrieval_score: item.retrieval_score,
      verification_source: item.signature_available
        ? 'semantic-visual-fingerprint'
        : 'vector-retrieval',
      products: products.map(productPayload)
    });
  }
  return suggestions;
}

function finalizePerformance(performance, started) {
  const verifierMs = Date.now() - started;
  performance.fallback_ms = verifierMs;
  performance.total_ms = Math.max(0, Number(performance.candidate_generation_ms || 0)) + verifierMs;
}

export async function structuralFinalIdentifyV4(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-vectorize+semantic-visual-fingerprint-v4',
    verification_mode: 'single-image-semantic-fingerprint',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true
  };

  try {
    const ticket = await readSignedTicket(env, cookieValue(request, COOKIE_NAME));
    if (!ticket) {
      throw new RecognitionError(
        'Ticket de candidatos ausente ou expirado. Refaça a foto.',
        409,
        'candidate_ticket_missing'
      );
    }
    inheritTicketPerformance(performance, ticket);

    const platform = normalizePlatform(ticket.platform);
    if (!platform) {
      throw new RecognitionError('Plataforma ausente no ticket.', 409, 'candidate_platform_missing');
    }
    performance.platform = platform;

    const form = await request.formData();
    const image = form.get('image');
    const requestedPlatform = normalizePlatform(form.get('platform'));
    if (!(image instanceof File)) {
      throw new RecognitionError('Foto da capa obrigatória.', 400, 'image_required');
    }
    if (!requestedPlatform || requestedPlatform !== platform) {
      throw new RecognitionError('Plataforma da confirmação divergente.', 409, 'platform_mismatch');
    }

    const covers = coversFromTicket(ticket);
    if (!covers.length) {
      throw new RecognitionError('Nenhuma capa candidata disponível.', 422, 'no_candidates');
    }
    performance.candidate_count = covers.length;
    performance.candidate_codes = covers.map(item => item.capa_code);

    const referenceSignatures = await loadReferenceSignatures(env, covers);
    performance.reference_signature_count = referenceSignatures.size;

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    let queryAnalysis = null;
    try {
      queryAnalysis = await extractVisualSignature(
        env,
        photoBytes,
        image.type || 'image/jpeg',
        { timeoutMs: QUERY_SIGNATURE_TIMEOUT_MS }
      );
      performance.gemini_ms = queryAnalysis.elapsed_ms;
      performance.model = queryAnalysis.model;
      performance.query_signature = queryAnalysis.signature;
    } catch (error) {
      performance.signature_error = error?.code || error?.message || 'signature_failed';
    }

    const ranked = covers.map(cover => {
      const stored = referenceSignatures.get(cover.capa_code);
      if (!queryAnalysis || !stored) {
        return {
          ...cover,
          score: retrievalSignal(cover.retrieval_score) * 0.75,
          hard_conflict: false,
          semantic_strong_count: 0,
          signals: { retrieval: retrievalSignal(cover.retrieval_score) },
          signature_available: Boolean(stored)
        };
      }
      const scored = scoreSignature(
        queryAnalysis.signature,
        stored.signature,
        cover.retrieval_score
      );
      return {
        ...cover,
        ...scored,
        signature_available: true
      };
    }).sort((a, b) => b.score - a.score || b.retrieval_score - a.retrieval_score);

    performance.semantic_rank = ranked.map(item => ({
      capa_code: item.capa_code,
      score: item.score,
      retrieval_score: item.retrieval_score,
      hard_conflict: item.hard_conflict,
      semantic_strong_count: item.semantic_strong_count,
      signals: item.signals
    }));

    const first = ranked[0] || null;
    const second = ranked[1] || null;
    const margin = first && second ? first.score - second.score : 1;
    performance.confidence = first?.score || 0;
    performance.semantic_margin = margin;

    const accepted = Boolean(
      queryAnalysis &&
      first?.signature_available &&
      first.score >= MIN_ACCEPT_SCORE &&
      margin >= MIN_ACCEPT_MARGIN &&
      first.hard_conflict !== true &&
      first.semantic_strong_count >= 2
    );

    if (!accepted) {
      const suggestions = await buildSuggestions(env, ranked, platform);
      performance.accepted_by = queryAnalysis
        ? 'semantic-fingerprint-rejected'
        : 'signature-unavailable-safe-suggestions';
      performance.suggestion_count = suggestions.length;
      finalizePerformance(performance, started);
      return json({
        error: suggestions.length
          ? 'Não consegui confirmar um único produto. Confira as possíveis correspondências abaixo.'
          : 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: first?.score || 0,
        platform,
        suggestions,
        suggestions_are_unconfirmed: true,
        identified_by: suggestions.length
          ? 'platform-scoped-semantic-suggestions'
          : 'platform-scoped-semantic-no-match',
        performance
      }, 422);
    }

    const products = await productsForCover(env, first.capa_code, platform);
    if (!products.length) {
      throw new RecognitionError(
        'A capa foi reconhecida, mas não existe produto correspondente nesta plataforma.',
        422,
        'product_missing_for_platform'
      );
    }

    performance.accepted_by = 'semantic-fingerprint-unique-winner';
    performance.winner_code = first.capa_code;
    finalizePerformance(performance, started);

    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: first.capa_code,
        platform,
        products: products.map(productPayload),
        confidence: first.score,
        identified_by: 'platform-semantic-fingerprint+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      capa_code: first.capa_code,
      platform,
      confidence: first.score,
      identified_by: 'platform-semantic-fingerprint-unique-winner',
      performance
    });
  } catch (error) {
    finalizePerformance(performance, started);
    return json({
      error: error?.message || 'Falha no reconhecimento visual.',
      technical_error: error?.code || 'recognition_error',
      performance
    }, Number(error?.status) || 500);
  }
}
