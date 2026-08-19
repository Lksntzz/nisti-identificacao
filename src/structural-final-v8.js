import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';
import { reserveGeminiBudget } from './gemini-budget.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_CANDIDATES = 4;
const BATCH_SIZE = 2;
const SUGGESTION_LIMIT = 3;
const MIN_STRUCTURAL_CONFIDENCE = 0.90;
const MIN_DECISION_GAP = 0.06;
const CALL_TIMEOUT_MS = 4500;
const TOTAL_VERIFY_BUDGET_MS = 7000;
const VERIFIER_RPM_LIMIT = 6;

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
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
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
  const material = await crypto.subtle.digest('SHA-256', textBytes(`nisti-local-vision:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
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
    const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(signature), textBytes(encoded));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded)));
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function inheritTicketPerformance(performance, ticket) {
  const source = ticket?.performance && typeof ticket.performance === 'object' ? ticket.performance : {};
  const fields = [
    'embedding_ms', 'vectorize_ms', 'retrieval_top1', 'retrieval_top1_code',
    'retrieval_top2', 'retrieval_top2_code', 'retrieval_margin', 'vector_top_k',
    'reference_candidate_count', 'cover_candidate_count', 'candidate_lookup_ms',
    'read_photo_ms', 'platform', 'platform_key', 'vectorize_namespace'
  ];
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) performance[field] = source[field];
  }
  performance.candidate_generation_ms = Number(source.total_ms || 0);
}

function candidatesFromTicket(ticket) {
  const codes = Array.isArray(ticket?.codes) ? ticket.codes : [];
  const scores = ticket?.scores && typeof ticket.scores === 'object' ? ticket.scores : {};
  const refs = Array.isArray(ticket?.references) ? ticket.references : [];
  const out = [];

  for (const rawCode of codes) {
    const capaCode = String(rawCode || '').trim().toUpperCase();
    if (!capaCode || out.some(item => item.capa_code === capaCode)) continue;
    const ref = refs
      .filter(item => String(item?.capa_code || '').trim().toUpperCase() === capaCode)
      .sort((a, b) => Number(a?.vector_rank || 999999) - Number(b?.vector_rank || 999999))[0];
    out.push({
      capa_code: capaCode,
      retrieval_rank: out.length + 1,
      retrieval_score: Number(scores[capaCode] ?? ref?.retrieval_score ?? 0),
      reference_id: Number(ref?.reference_id || 0) || null
    });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

function personalizedFromCatalogText(values) {
  return (values || []).some(value => /personalizad[oa]|personaliza[cç][aã]o/i.test(String(value || '')));
}

async function candidateCatalogMetadata(env, capaCode, platform) {
  const { results } = await env.DB.prepare(`
    SELECT p.nome,p.variacao
    FROM products p
    JOIN product_platforms pp ON pp.product_id=p.id
    WHERE UPPER(TRIM(p.capa_code))=? AND UPPER(TRIM(pp.platform))=?
    ORDER BY p.id ASC
    LIMIT 8
  `).bind(String(capaCode || '').trim().toUpperCase(), normalizePlatform(platform)).all();

  const labels = [];
  for (const row of results || []) {
    for (const raw of [row.nome, row.variacao]) {
      const value = String(raw || '').trim();
      if (value && !labels.includes(value)) labels.push(value);
    }
  }
  return {
    catalog_personalized: personalizedFromCatalogText(labels),
    catalog_labels: labels.slice(0, 3)
  };
}

async function loadCandidateImage(env, candidate, platform, requestOrigin) {
  let row = null;
  if (candidate.reference_id) {
    row = await env.DB.prepare(`
      SELECT id,capa_code,image_key
      FROM cover_visual_references
      WHERE id=? AND active=1 AND image_key IS NOT NULL
      LIMIT 1
    `).bind(candidate.reference_id).first();
  }

  if (!row || String(row.capa_code || '').trim().toUpperCase() !== candidate.capa_code) {
    row = await env.DB.prepare(`
      SELECT id,capa_code,image_key
      FROM cover_visual_references
      WHERE UPPER(TRIM(capa_code))=? AND active=1 AND image_key IS NOT NULL
      ORDER BY id ASC
      LIMIT 1
    `).bind(candidate.capa_code).first();
  }
  if (!row?.image_key) return null;

  const [head, metadata] = await Promise.all([
    env.PRODUCT_IMAGES.head(row.image_key),
    candidateCatalogMetadata(env, candidate.capa_code, platform)
  ]);
  if (!head) return null;

  const id = Number(row.id);
  const version = String(row.image_key).split('/').pop() || 'current';
  const relativeUrl = `/api/reference-images/${id}?v=${encodeURIComponent(version)}`;
  const mime = String(head.httpMetadata?.contentType || 'image/jpeg').toLowerCase();
  return {
    ...candidate,
    ...metadata,
    reference_id: id,
    image_key: row.image_key,
    thumbnail_url: relativeUrl,
    file_uri: new URL(relativeUrl, requestOrigin).toString(),
    mime_type: mime.startsWith('image/') ? mime : 'image/jpeg',
    source_bytes: Number(head.size || 0)
  };
}

function parseStructuredJson(payload) {
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!text) throw new RecognitionError('Gemini não retornou análise visual.', 502, 'catalog_comparator_empty');
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new RecognitionError('Gemini retornou JSON inválido.', 502, 'catalog_comparator_invalid_json');
}

function normalizeAssessment(raw) {
  return {
    capa_code: String(raw?.capa_code || '').trim().toUpperCase(),
    same_base_art: raw?.same_base_art === true,
    fixed_text_match: raw?.fixed_text_match === true,
    personalization_difference_only: raw?.personalization_difference_only === true,
    primary_subject_match: raw?.primary_subject_match === true,
    graphic_elements_match: raw?.graphic_elements_match === true,
    dominant_colors_match: raw?.dominant_colors_match === true,
    layout_match: raw?.layout_match === true,
    disqualifying_conflict: raw?.disqualifying_conflict === true,
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0))
  };
}

function geminiErrorDetail(payload) {
  return String(payload?.error?.message || payload?.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function structuralPass(assessment) {
  if (!assessment) return false;
  const textCompatible = assessment.fixed_text_match || assessment.personalization_difference_only;
  return assessment.same_base_art && textCompatible && assessment.primary_subject_match &&
    assessment.graphic_elements_match && assessment.dominant_colors_match &&
    assessment.layout_match && !assessment.disqualifying_conflict;
}

function adjudicate(assessments, candidates) {
  const candidateByCode = new Map(candidates.map(item => [item.capa_code, item]));
  const passing = assessments
    .filter(item => candidateByCode.has(item.capa_code) && structuralPass(item))
    .sort((a, b) => b.confidence - a.confidence);
  const best = passing[0] || null;
  if (!best || best.confidence < MIN_STRUCTURAL_CONFIDENCE) return { winner: null, ambiguous: false, passing };
  const second = passing[1] || null;
  if (second && best.confidence - second.confidence < MIN_DECISION_GAP) {
    return { winner: null, ambiguous: true, passing };
  }
  return {
    winner: {
      candidate: candidateByCode.get(best.capa_code),
      assessment: best,
      decision_gap: second ? best.confidence - second.confidence : 1,
      passing_count: passing.length
    },
    ambiguous: false,
    passing
  };
}

async function callComparatorModel(env, model, photoBytes, photoMime, candidates, platform, timeoutMs) {
  const allowed = await reserveGeminiBudget(env, 'catalog-verifier-total-v8', VERIFIER_RPM_LIMIT);
  if (!allowed) throw new RecognitionError('Limite interno de análise visual atingido.', 503, 'gemini_local_budget_exhausted');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('catalog-comparison-timeout'), timeoutMs);
  const started = Date.now();

  const prompt = `Compare a FOTO com as candidatas do catálogo ${platform}. Não escolha a mais parecida: confirme somente a mesma arte-base.
Verifique obrigatoriamente texto fixo, personagem/objeto principal, elementos gráficos, cores dominantes e layout.
Ignore apenas nome próprio, inicial ou data quando a candidata estiver marcada PERSONALIZADO=SIM. Ignore wire-o/espiral, elástico, tassel, mão, mesa, brilho, reflexo, perspectiva, recorte e fundo externo.
Se houver diferença permanente importante, marque disqualifying_conflict=true e same_base_art=false.`;

  const parts = [
    { text: prompt },
    { text: 'FOTO:' },
    { inline_data: { mime_type: photoMime || 'image/jpeg', data: base64(photoBytes) } }
  ];
  for (const candidate of candidates) {
    const labels = candidate.catalog_labels?.length ? candidate.catalog_labels.join(' | ') : 'sem descrição adicional';
    parts.push({ text: `CAPA_CODE=${candidate.capa_code}; PERSONALIZADO=${candidate.catalog_personalized ? 'SIM' : 'NÃO'}; CADASTRO=${labels}` });
    parts.push({ file_data: { mime_type: candidate.mime_type, file_uri: candidate.file_uri } });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 220,
          media_resolution: 'MEDIA_RESOLUTION_LOW',
          thinkingConfig: { thinkingLevel: 'minimal' },
          response_mime_type: 'application/json',
          response_schema: {
            type: 'OBJECT',
            properties: {
              assessments: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  properties: {
                    capa_code: { type: 'STRING' },
                    same_base_art: { type: 'BOOLEAN' },
                    fixed_text_match: { type: 'BOOLEAN' },
                    personalization_difference_only: { type: 'BOOLEAN' },
                    primary_subject_match: { type: 'BOOLEAN' },
                    graphic_elements_match: { type: 'BOOLEAN' },
                    dominant_colors_match: { type: 'BOOLEAN' },
                    layout_match: { type: 'BOOLEAN' },
                    disqualifying_conflict: { type: 'BOOLEAN' },
                    confidence: { type: 'NUMBER' }
                  },
                  required: [
                    'capa_code','same_base_art','fixed_text_match','personalization_difference_only',
                    'primary_subject_match','graphic_elements_match','dominant_colors_match',
                    'layout_match','disqualifying_conflict','confidence'
                  ]
                }
              }
            },
            required: ['assessments']
          }
        }
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = geminiErrorDetail(payload);
      throw new RecognitionError(
        detail ? `Gemini comparador falhou (${response.status}): ${detail}` : `Gemini comparador falhou (${response.status})`,
        [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502,
        `catalog_comparator_http_${response.status}`
      );
    }

    const parsed = parseStructuredJson(await response.json());
    return {
      model,
      elapsed_ms: Date.now() - started,
      assessments: (Array.isArray(parsed?.assessments) ? parsed.assessments : [])
        .map(normalizeAssessment)
        .filter(item => item.capa_code)
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new RecognitionError('A análise visual excedeu o tempo disponível.', 503, 'catalog_comparator_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function compareBatch(env, photoBytes, photoMime, candidates, platform, remainingMs) {
  const primaryModel = env.GEMINI_VERIFIER_MODEL || 'gemini-3.5-flash-lite';
  const fallbackModel = env.GEMINI_MODEL || 'gemini-3.5-flash';
  const timeoutMs = Math.max(1800, Math.min(CALL_TIMEOUT_MS, remainingMs));
  try {
    return await callComparatorModel(env, primaryModel, photoBytes, photoMime, candidates, platform, timeoutMs);
  } catch (error) {
    if (error?.code !== 'catalog_comparator_http_429' || fallbackModel === primaryModel) throw error;
    const fallbackTimeout = Math.max(1800, Math.min(CALL_TIMEOUT_MS, remainingMs));
    return callComparatorModel(env, fallbackModel, photoBytes, photoMime, candidates, platform, fallbackTimeout);
  }
}

function productPayload(product, displayImageUrl = null) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  const productImage = product.image_key
    ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
    : null;
  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    product_image_url: productImage,
    image_url: displayImageUrl || productImage
  };
}

async function productsForCover(env, capaCode, platform) {
  const { results } = await env.DB.prepare(`
    SELECT p.*, pp.platform, pp.link
    FROM products p
    JOIN product_platforms pp ON pp.product_id=p.id
    WHERE UPPER(TRIM(p.capa_code))=? AND UPPER(TRIM(pp.platform))=?
    ORDER BY p.id ASC, pp.id ASC
  `).bind(String(capaCode || '').trim().toUpperCase(), normalizePlatform(platform)).all();
  const seen = new Set();
  return (results || []).filter(product => {
    const id = Number(product.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function buildSuggestions(env, candidates, assessments, platform) {
  const byCode = new Map((assessments || []).map(item => [item.capa_code, item]));
  const ordered = [...candidates].sort((a, b) => {
    const aa = byCode.get(a.capa_code);
    const bb = byCode.get(b.capa_code);
    return Number(bb?.confidence ?? b.retrieval_score) - Number(aa?.confidence ?? a.retrieval_score);
  });
  const suggestions = [];
  for (const candidate of ordered) {
    if (suggestions.length >= SUGGESTION_LIMIT) break;
    const assessment = byCode.get(candidate.capa_code);
    if (assessment?.disqualifying_conflict) continue;
    const products = await productsForCover(env, candidate.capa_code, platform);
    if (!products.length) continue;
    suggestions.push({
      capa_code: candidate.capa_code,
      confidence: Number(assessment?.confidence ?? candidate.retrieval_score ?? 0),
      retrieval_score: candidate.retrieval_score,
      verification_source: assessment ? 'catalog-visual-comparison' : 'vector-retrieval',
      personalization_difference_only: assessment?.personalization_difference_only === true,
      catalog_personalized: candidate.catalog_personalized === true,
      thumbnail_url: candidate.thumbnail_url,
      products: products.map(product => productPayload(product, candidate.thumbnail_url))
    });
  }
  return suggestions;
}

function finalizePerformance(performance, started) {
  const verifierMs = Date.now() - started;
  performance.fallback_ms = verifierMs;
  performance.total_ms = Math.max(0, Number(performance.candidate_generation_ms || 0)) + verifierMs;
}

export async function structuralFinalIdentifyV8(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-vectorize+batched-catalog-v8.2',
    verification_mode: 'two-at-a-time-structural-adjudication',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true,
    candidate_transport: 'https-file-uri'
  };

  try {
    const ticket = await readSignedTicket(env, cookieValue(request, COOKIE_NAME));
    if (!ticket) throw new RecognitionError('Ticket de candidatos ausente ou expirado. Refaça a foto.', 409, 'candidate_ticket_missing');
    inheritTicketPerformance(performance, ticket);

    const platform = normalizePlatform(ticket.platform);
    if (!platform) throw new RecognitionError('Plataforma ausente no ticket.', 409, 'candidate_platform_missing');
    performance.platform = platform;

    const form = await request.formData();
    const image = form.get('image');
    const requestedPlatform = normalizePlatform(form.get('platform'));
    if (!(image instanceof File)) throw new RecognitionError('Foto da capa obrigatória.', 400, 'image_required');
    if (!requestedPlatform || requestedPlatform !== platform) throw new RecognitionError('Plataforma da confirmação divergente.', 409, 'platform_mismatch');

    const candidates = candidatesFromTicket(ticket);
    if (!candidates.length) throw new RecognitionError('Nenhuma candidata disponível.', 422, 'no_candidates');

    const referenceStarted = Date.now();
    const requestOrigin = new URL(request.url).origin;
    const loaded = (await Promise.all(candidates.map(candidate => loadCandidateImage(env, candidate, platform, requestOrigin)))).filter(Boolean);
    performance.reference_load_ms = Date.now() - referenceStarted;
    if (!loaded.length) throw new RecognitionError('As imagens candidatas do catálogo não estão disponíveis.', 503, 'candidate_images_missing');

    performance.candidate_count = loaded.length;
    performance.candidate_codes = loaded.map(item => item.capa_code);
    performance.candidate_source_bytes = loaded.map(item => ({ code: item.capa_code, bytes: item.source_bytes }));

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    const verifyStarted = Date.now();
    const allAssessments = [];
    let winner = null;
    let comparatorError = null;
    let calls = 0;
    let usedModel = null;

    for (let offset = 0; offset < loaded.length; offset += BATCH_SIZE) {
      const elapsed = Date.now() - verifyStarted;
      const remaining = TOTAL_VERIFY_BUDGET_MS - elapsed;
      if (remaining < 1800) break;
      const batch = loaded.slice(offset, offset + BATCH_SIZE);
      try {
        const comparison = await compareBatch(env, photoBytes, image.type || 'image/jpeg', batch, platform, remaining);
        calls += 1;
        usedModel = comparison.model;
        allAssessments.push(...comparison.assessments);
        const decision = adjudicate(comparison.assessments, batch);
        if (decision.ambiguous) break;
        if (decision.winner) {
          winner = decision.winner;
          break;
        }
      } catch (error) {
        comparatorError = error;
        break;
      }
    }

    performance.gemini_ms = Date.now() - verifyStarted;
    performance.gemini_calls = calls;
    performance.model = usedModel || env.GEMINI_VERIFIER_MODEL || env.GEMINI_MODEL || null;
    performance.candidate_assessments = allAssessments;
    if (comparatorError) {
      performance.comparator_error = comparatorError.code || comparatorError.message;
      performance.comparator_error_message = comparatorError.message || null;
    }

    if (!winner) {
      const suggestions = await buildSuggestions(env, loaded, allAssessments, platform);
      performance.accepted_by = comparatorError
        ? `comparator-unavailable:${performance.comparator_error}`
        : 'structural-adjudication-rejected';
      performance.suggestion_count = suggestions.length;
      finalizePerformance(performance, started);
      return json({
        error: suggestions.length
          ? 'Não consegui confirmar um único produto. Confira as possíveis correspondências abaixo.'
          : 'Não encontrei uma correspondência visual segura para este produto.',
        confidence: allAssessments[0]?.confidence || loaded[0]?.retrieval_score || 0,
        platform,
        suggestions,
        suggestions_are_unconfirmed: true,
        identified_by: suggestions.length ? 'platform-catalog-visual-suggestions-v8.2' : 'platform-catalog-no-match-v8.2',
        performance
      }, 422);
    }

    const products = await productsForCover(env, winner.candidate.capa_code, platform);
    if (!products.length) throw new RecognitionError('A capa foi reconhecida, mas não existe produto correspondente nesta plataforma.', 422, 'product_missing_for_platform');

    performance.accepted_by = 'batched-structural-unique-winner';
    performance.winner_code = winner.candidate.capa_code;
    performance.decision_gap = winner.decision_gap;
    performance.passing_candidate_count = winner.passing_count;
    performance.personalization_difference_only = winner.assessment.personalization_difference_only;
    finalizePerformance(performance, started);

    const displayImageUrl = winner.candidate.thumbnail_url;
    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: winner.candidate.capa_code,
        platform,
        products: products.map(product => productPayload(product, displayImageUrl)),
        confidence: winner.assessment.confidence,
        identified_by: 'platform-catalog-v8.2+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0], displayImageUrl),
      capa_code: winner.candidate.capa_code,
      platform,
      confidence: winner.assessment.confidence,
      identified_by: 'platform-catalog-v8.2-deterministic-winner',
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
