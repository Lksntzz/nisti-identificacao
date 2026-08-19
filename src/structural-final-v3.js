import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_RETRIEVAL_COVERS = 6;
const FINAL_COVER_LIMIT = 2;
const SUGGESTION_LIMIT = 3;
const MIN_EXACT_CONFIDENCE = 0.97;
const MIN_VERIFIED_SUGGESTION_CONFIDENCE = 0.70;
const MIN_RETRIEVAL_SUGGESTION_SCORE = 0.78;
const VERIFY_TIMEOUT_MS = 6500;

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

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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

    const references = refs
      .filter(item => String(item?.capa_code || '').trim().toUpperCase() === capaCode)
      .map(item => ({
        reference_id: Number(item?.reference_id || 0),
        vector_rank: Number(item?.vector_rank || 0),
        retrieval_score: Number(item?.retrieval_score ?? scores[capaCode] ?? -1)
      }))
      .filter(item => Number.isInteger(item.reference_id) && item.reference_id > 0)
      .sort((a, b) => (a.vector_rank || 999999) - (b.vector_rank || 999999));

    covers.push({
      capa_code: capaCode,
      retrieval_rank: covers.length + 1,
      retrieval_score: Number(scores[capaCode] ?? references[0]?.retrieval_score ?? -1),
      references
    });

    if (covers.length >= MAX_RETRIEVAL_COVERS) break;
  }

  return covers;
}

async function loadReferenceGroups(env, covers) {
  const codes = covers.map(item => item.capa_code);
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE active=1 AND image_key IS NOT NULL
      AND capa_code IN (${placeholders})
    ORDER BY id ASC
  `).bind(...codes).all();

  const byId = new Map();
  const byCode = new Map(codes.map(code => [code, []]));
  for (const row of results || []) {
    const normalized = {
      id: Number(row.id),
      capa_code: String(row.capa_code || '').trim().toUpperCase(),
      image_key: row.image_key,
      source_product_id: Number(row.source_product_id || 0) || null,
      reference_kind: row.reference_kind || 'product'
    };
    byId.set(normalized.id, normalized);
    if (byCode.has(normalized.capa_code)) byCode.get(normalized.capa_code).push(normalized);
  }

  const groups = [];
  for (const cover of covers) {
    let chosen = null;
    for (const meta of cover.references || []) {
      const row = byId.get(meta.reference_id);
      if (row && row.capa_code === cover.capa_code) {
        chosen = { ...row, exact_retrieval_reference: true };
        break;
      }
    }
    if (!chosen) {
      const row = (byCode.get(cover.capa_code) || [])[0];
      if (row) chosen = { ...row, exact_retrieval_reference: false };
    }
    if (!chosen) continue;

    const object = await env.PRODUCT_IMAGES.get(chosen.image_key);
    if (!object) continue;
    groups.push({
      cover,
      reference: {
        ...chosen,
        bytes: new Uint8Array(await object.arrayBuffer()),
        mimeType: object.httpMetadata?.contentType || 'image/jpeg'
      }
    });
  }
  return groups;
}

function parseStructuredJson(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) throw new Error('empty_response');
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('invalid_json');
}

function verificationParts(photoBytes, photoMime, group, platform) {
  const code = group.cover.capa_code;
  return [{
    text: `Verifique se a FOTO e a REFERÊNCIA da plataforma ${platform} representam exatamente a mesma ARTE-BASE NISTI PRINT. CAPA_CODE=${code}.\n\nRegras obrigatórias:\n1. Não aceite apenas por cor ou estilo parecido.\n2. Ignore somente nome próprio, inicial/letra e datas personalizadas do cliente.\n3. Texto fixo diferente reprova.\n4. Compare layout, fundo/textura, faixas, molduras, linhas, ícones/ilustrações, tipografia fixa e assinatura gráfica.\n5. Ignore Wire-O, elástico, tassel, brilho, reflexo, mão, mesa, recorte e perspectiva.\n6. same_base_art=true somente se os elementos permanentes indicarem identidade da mesma capa.`
  }, {
    text: 'FOTO:'
  }, {
    inline_data: {
      mime_type: photoMime || 'image/jpeg',
      data: base64(photoBytes)
    }
  }, {
    text: `REFERÊNCIA CAPA_CODE=${code}:`
  }, {
    inline_data: {
      mime_type: group.reference.mimeType,
      data: base64(group.reference.bytes)
    }
  }];
}

function normalizeAssessment(code, result, extra = {}) {
  return {
    capa_code: code,
    completed: extra.completed !== false,
    same_base_art: result?.same_base_art === true,
    permanent_text_compatible: result?.permanent_text_compatible === true,
    layout_match: result?.layout_match === true,
    distinctive_graphics_match: result?.distinctive_graphics_match === true,
    disqualifying_conflict: result?.disqualifying_conflict === true,
    confidence: Math.max(0, Math.min(1, Number(result?.confidence) || 0)),
    elapsed_ms: Number(extra.elapsed_ms || 0),
    error: extra.error || null
  };
}

async function verifyOne(env, photoBytes, photoMime, group, platform) {
  const code = group.cover.capa_code;
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort('verification-timeout'),
    VERIFY_TIMEOUT_MS
  );
  const started = Date.now();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: verificationParts(photoBytes, photoMime, group, platform)
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 120,
            media_resolution: 'MEDIA_RESOLUTION_LOW',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                same_base_art: { type: 'BOOLEAN' },
                permanent_text_compatible: { type: 'BOOLEAN' },
                layout_match: { type: 'BOOLEAN' },
                distinctive_graphics_match: { type: 'BOOLEAN' },
                disqualifying_conflict: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER' }
              },
              required: [
                'same_base_art', 'permanent_text_compatible', 'layout_match',
                'distinctive_graphics_match', 'disqualifying_conflict', 'confidence'
              ]
            }
          }
        })
      }
    );

    if (!response.ok) {
      return normalizeAssessment(code, null, {
        completed: false,
        elapsed_ms: Date.now() - started,
        error: `gemini_http_${response.status}`
      });
    }

    const result = parseStructuredJson(await response.json());
    return normalizeAssessment(code, result, {
      completed: true,
      elapsed_ms: Date.now() - started
    });
  } catch (error) {
    const timeout = controller.signal.aborted || error?.name === 'AbortError';
    return normalizeAssessment(code, null, {
      completed: false,
      elapsed_ms: Date.now() - started,
      error: timeout ? 'timeout' : 'gemini_request_error'
    });
  } finally {
    clearTimeout(timer);
  }
}

function isExact(assessment) {
  return assessment?.completed === true &&
    assessment.same_base_art === true &&
    assessment.permanent_text_compatible === true &&
    assessment.layout_match === true &&
    assessment.distinctive_graphics_match === true &&
    assessment.disqualifying_conflict !== true &&
    assessment.confidence >= MIN_EXACT_CONFIDENCE;
}

async function verifyCandidates(env, photoBytes, photoMime, groups, platform) {
  if (!env.GEMINI_API_KEY) {
    throw new RecognitionError(
      'GEMINI_API_KEY não configurada',
      503,
      'gemini_not_configured'
    );
  }

  const started = Date.now();
  const assessments = await Promise.all(
    groups.map(group => verifyOne(env, photoBytes, photoMime, group, platform))
  );
  const exact = assessments.filter(isExact);
  const unresolved = assessments.filter(item => !item.completed);
  const accepted = unresolved.length === 0 && exact.length === 1;

  return {
    accepted,
    selected_capa_code: accepted ? exact[0].capa_code : null,
    assessments,
    unresolved_codes: unresolved.map(item => item.capa_code),
    confidence: accepted
      ? exact[0].confidence
      : Math.max(0, ...assessments.map(item => item.confidence || 0)),
    model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    elapsed_ms: Date.now() - started
  };
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

function suggestionCandidates(covers, assessments) {
  const assessmentByCode = new Map(
    assessments.map(item => [item.capa_code, item])
  );
  const topScore = Number(covers[0]?.retrieval_score || 0);
  const relativeFloor = Math.max(
    MIN_RETRIEVAL_SUGGESTION_SCORE,
    topScore - 0.06
  );

  const candidates = [];
  for (const cover of covers.slice(0, SUGGESTION_LIMIT)) {
    const assessment = assessmentByCode.get(cover.capa_code) || null;
    const retrievalScore = Number(cover.retrieval_score || 0);

    if (assessment?.completed) {
      if (assessment.disqualifying_conflict === true) continue;
      if (assessment.permanent_text_compatible !== true) continue;
      if (
        assessment.confidence < MIN_VERIFIED_SUGGESTION_CONFIDENCE ||
        (assessment.layout_match !== true && assessment.distinctive_graphics_match !== true)
      ) continue;
      candidates.push({
        capa_code: cover.capa_code,
        confidence: assessment.confidence,
        retrieval_score: retrievalScore,
        verification_source: 'gemini-verified'
      });
      continue;
    }

    if (retrievalScore >= relativeFloor) {
      candidates.push({
        capa_code: cover.capa_code,
        confidence: retrievalScore,
        retrieval_score: retrievalScore,
        verification_source: 'vector-retrieval'
      });
    }
  }

  return candidates.sort((a, b) =>
    Number(b.verification_source === 'gemini-verified') - Number(a.verification_source === 'gemini-verified') ||
    b.confidence - a.confidence ||
    b.retrieval_score - a.retrieval_score
  );
}

async function buildSuggestions(env, covers, assessments, platform) {
  const candidates = suggestionCandidates(covers, assessments);
  const suggestions = [];
  for (const item of candidates) {
    const products = await productsForCover(env, item.capa_code, platform);
    if (!products.length) continue;
    suggestions.push({
      ...item,
      products: products.map(productPayload)
    });
  }
  return suggestions.slice(0, SUGGESTION_LIMIT);
}

function finalizePerformance(performance, started) {
  const verifierMs = Date.now() - started;
  performance.fallback_ms = verifierMs;
  performance.total_ms = Math.max(0, Number(performance.candidate_generation_ms || 0)) + verifierMs;
}

export async function structuralFinalIdentifyV3(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-scoped-vectorize+parallel-binary-gemini-v3',
    verification_mode: 'parallel-binary-top2-with-graceful-degradation',
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
      throw new RecognitionError(
        'Plataforma ausente no ticket de reconhecimento.',
        409,
        'candidate_platform_missing'
      );
    }
    performance.platform = platform;

    const covers = coversFromTicket(ticket);
    if (!covers.length) {
      throw new RecognitionError(
        'Nenhuma capa candidata disponível.',
        422,
        'no_candidates'
      );
    }

    const form = await request.formData();
    const image = form.get('image');
    const requestedPlatform = normalizePlatform(form.get('platform'));
    if (!(image instanceof File)) {
      throw new RecognitionError('Foto da capa obrigatória.', 400, 'image_required');
    }
    if (!requestedPlatform || requestedPlatform !== platform) {
      throw new RecognitionError(
        'A plataforma da confirmação não corresponde à busca iniciada.',
        409,
        'platform_mismatch'
      );
    }

    const shortlisted = covers.slice(0, FINAL_COVER_LIMIT);
    performance.candidate_count = covers.length;
    performance.candidate_codes = covers.map(item => item.capa_code);
    performance.verifier_candidate_codes = shortlisted.map(item => item.capa_code);

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    const photoMime = image.type || 'image/jpeg';
    performance.upload_bytes = image.size;

    const referenceStarted = Date.now();
    const groups = await loadReferenceGroups(env, shortlisted);
    performance.reference_load_ms = Date.now() - referenceStarted;
    performance.reference_candidate_count = groups.length;
    performance.reference_ids = groups.map(group => group.reference.id);

    if (!groups.length) {
      throw new RecognitionError(
        'As referências visuais não estão disponíveis.',
        503,
        'reference_images_missing'
      );
    }

    const decision = await verifyCandidates(
      env,
      photoBytes,
      photoMime,
      groups,
      platform
    );
    performance.gemini_ms = decision.elapsed_ms;
    performance.model = decision.model;
    performance.confidence = decision.confidence;
    performance.assessments = decision.assessments;
    performance.unresolved_codes = decision.unresolved_codes;
    performance.verifier_timeout_count = decision.assessments.filter(item => item.error === 'timeout').length;

    if (!decision.accepted || !decision.selected_capa_code) {
      const suggestions = await buildSuggestions(
        env,
        covers,
        decision.assessments,
        platform
      );
      performance.accepted_by = decision.unresolved_codes.length
        ? 'verifier-degraded-to-suggestions'
        : 'strict-binary-verifier-rejected';
      performance.suggestion_count = suggestions.length;
      finalizePerformance(performance, started);

      return json({
        error: suggestions.length
          ? 'Não consegui confirmar um único produto. Confira as possíveis correspondências abaixo.'
          : 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: decision.confidence,
        platform,
        suggestions,
        suggestions_are_unconfirmed: true,
        degraded_verification: decision.unresolved_codes.length > 0,
        identified_by: suggestions.length
          ? 'platform-scoped-safe-suggestions'
          : 'platform-scoped-no-match',
        performance
      }, 422);
    }

    const products = await productsForCover(
      env,
      decision.selected_capa_code,
      platform
    );
    if (!products.length) {
      throw new RecognitionError(
        'A capa foi reconhecida, mas não existe produto correspondente nesta plataforma.',
        422,
        'product_missing_for_platform'
      );
    }

    performance.accepted_by = 'parallel-binary-unique-winner';
    performance.winner_code = decision.selected_capa_code;
    finalizePerformance(performance, started);

    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: decision.selected_capa_code,
        platform,
        products: products.map(productPayload),
        confidence: decision.confidence,
        identified_by: 'platform-scoped+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      capa_code: decision.selected_capa_code,
      platform,
      confidence: decision.confidence,
      identified_by: 'platform-scoped-parallel-binary-unique-winner',
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
