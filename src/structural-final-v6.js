import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';
import { reserveGeminiBudget } from './gemini-budget.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_CANDIDATES = 4;
const SUGGESTION_LIMIT = 3;
const MIN_EXACT_CONFIDENCE = 0.95;
const VERIFY_TIMEOUT_MS = 9000;
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

function candidatesFromTicket(ticket) {
  const codes = Array.isArray(ticket?.codes) ? ticket.codes : [];
  const scores = ticket?.scores && typeof ticket.scores === 'object'
    ? ticket.scores
    : {};
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

async function loadCandidateImage(env, candidate) {
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
  const object = await env.PRODUCT_IMAGES.get(row.image_key);
  if (!object) return null;

  const id = Number(row.id);
  const version = String(row.image_key).split('/').pop() || 'current';
  return {
    ...candidate,
    reference_id: id,
    image_key: row.image_key,
    thumbnail_url: `/api/reference-images/${id}?v=${encodeURIComponent(version)}`,
    mime_type: object.httpMetadata?.contentType || 'image/jpeg',
    bytes: new Uint8Array(await object.arrayBuffer())
  };
}

function parseStructuredJson(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  const text = (Array.isArray(parts) ? parts : [])
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!text) throw new Error('empty_catalog_comparison');
  try {
    return JSON.parse(text);
  } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('invalid_catalog_comparison_json');
}

function normalizeStrings(values, limit = 8) {
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim();
    if (!value || out.includes(value)) continue;
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
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

async function compareCatalogCandidates(env, photoBytes, photoMime, candidates, platform) {
  if (!env.GEMINI_API_KEY) throw new RecognitionError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');

  const allowed = await reserveGeminiBudget(
    env,
    'gemini-3.5-flash-lite-catalog-comparator',
    VERIFIER_RPM_LIMIT
  );
  if (!allowed) {
    throw new RecognitionError(
      'Limite interno de análise visual atingido. Tente novamente em alguns segundos.',
      503,
      'gemini_local_budget_exhausted'
    );
  }

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('catalog-comparison-timeout'), VERIFY_TIMEOUT_MS);
  const started = Date.now();

  const prompt = `Você recebe UMA FOTO de um produto físico NISTI PRINT e várias CANDIDATAS DO CATÁLOGO da plataforma ${platform}.

IMPORTANTE: nenhuma candidata é a referência principal. Compare a foto contra TODAS as candidatas e escolha somente se existir uma correspondência visual única.

Critérios obrigatórios:
1. TEXTO FIXO da arte.
2. PERSONAGEM, SÍMBOLO ou OBJETO principal.
3. ELEMENTOS GRÁFICOS permanentes: folhas, flores, ícones, molduras, faixas, linhas, estrelas, corações etc.
4. CORES DOMINANTES e distribuição das áreas de cor.
5. LAYOUT e posições relativas dos elementos.

PERSONALIZAÇÃO:
- Algumas capas são personalizadas e outras não.
- Nome próprio, inicial/letra ou data podem ser ignorados SOMENTE quando forem claramente personalização sobre a mesma arte-base.
- Não ignore títulos, frases, categoria do produto ou qualquer texto que faça parte do desenho fixo.
- personalization_difference_only=true somente quando a diferença textual for exclusivamente nome/inicial/data personalizada e TODO o restante da arte coincidir.
- Se a diferença de texto não puder ser classificada com segurança como personalização, trate como conflito.

IGNORE apenas Wire-O/espiral, elástico, tassel, mão, mesa, reflexo, brilho, perspectiva, recorte e fundo externo.
Não aceite por tema ou cor parecida. Se houver duas candidatas plausíveis, unique_match=false.`;

  const parts = [
    { text: prompt },
    { text: 'FOTO DO PRODUTO FÍSICO:' },
    { inline_data: { mime_type: photoMime || 'image/jpeg', data: base64(photoBytes) } }
  ];

  for (const candidate of candidates) {
    parts.push({ text: `CANDIDATA DO CATÁLOGO CAPA_CODE=${candidate.capa_code}:` });
    parts.push({
      inline_data: {
        mime_type: candidate.mime_type,
        data: base64(candidate.bytes)
      }
    });
  }

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
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 480,
            media_resolution: 'MEDIA_RESOLUTION_LOW',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                selected_capa_code: { type: 'STRING' },
                unique_match: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER' },
                personalization_detected: { type: 'BOOLEAN' },
                ignored_personalization_text: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_fixed_text: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_subjects: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_elements: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_colors: { type: 'ARRAY', items: { type: 'STRING' } },
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
              required: [
                'selected_capa_code','unique_match','confidence','personalization_detected',
                'ignored_personalization_text','observed_fixed_text','observed_subjects',
                'observed_elements','observed_colors','assessments'
              ]
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new RecognitionError(
        `Gemini comparador falhou (${response.status})`,
        [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502,
        'catalog_comparator_failed'
      );
    }

    const parsed = parseStructuredJson(await response.json());
    return {
      model,
      elapsed_ms: Date.now() - started,
      selected_capa_code: String(parsed?.selected_capa_code || '').trim().toUpperCase(),
      unique_match: parsed?.unique_match === true,
      confidence: Math.max(0, Math.min(1, Number(parsed?.confidence) || 0)),
      personalization_detected: parsed?.personalization_detected === true,
      ignored_personalization_text: normalizeStrings(parsed?.ignored_personalization_text, 5),
      observed_fixed_text: normalizeStrings(parsed?.observed_fixed_text, 6),
      observed_subjects: normalizeStrings(parsed?.observed_subjects, 6),
      observed_elements: normalizeStrings(parsed?.observed_elements, 8),
      observed_colors: normalizeStrings(parsed?.observed_colors, 6),
      assessments: (Array.isArray(parsed?.assessments) ? parsed.assessments : [])
        .map(normalizeAssessment)
        .filter(item => item.capa_code)
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new RecognitionError(
        'A análise visual excedeu o tempo disponível.',
        503,
        'catalog_comparator_timeout'
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function exactWinner(comparison, candidates) {
  if (!comparison?.unique_match) return null;
  if (comparison.confidence < MIN_EXACT_CONFIDENCE) return null;

  const code = String(comparison.selected_capa_code || '').trim().toUpperCase();
  const candidate = candidates.find(item => item.capa_code === code);
  const assessment = comparison.assessments.find(item => item.capa_code === code);
  if (!candidate || !assessment) return null;

  const textCompatible = assessment.fixed_text_match || assessment.personalization_difference_only;
  const accepted = assessment.same_base_art &&
    textCompatible &&
    assessment.primary_subject_match &&
    assessment.graphic_elements_match &&
    assessment.dominant_colors_match &&
    assessment.layout_match &&
    !assessment.disqualifying_conflict &&
    assessment.confidence >= MIN_EXACT_CONFIDENCE;

  return accepted ? { candidate, assessment } : null;
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

async function buildSuggestions(env, candidates, comparison, platform) {
  const byCode = new Map(comparison?.assessments?.map(item => [item.capa_code, item]) || []);
  const ordered = [...candidates].sort((a, b) => {
    const aa = byCode.get(a.capa_code);
    const bb = byCode.get(b.capa_code);
    return Number(bb?.confidence || b.retrieval_score) - Number(aa?.confidence || a.retrieval_score);
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
      confidence: Number(assessment?.confidence || candidate.retrieval_score || 0),
      retrieval_score: candidate.retrieval_score,
      verification_source: assessment ? 'catalog-visual-comparison' : 'vector-retrieval',
      personalization_difference_only: assessment?.personalization_difference_only === true,
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

export async function structuralFinalIdentifyV6(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-vectorize+comparative-catalog-v6',
    verification_mode: 'single-call-multi-candidate-comparison',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true
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
    if (!requestedPlatform || requestedPlatform !== platform) {
      throw new RecognitionError('Plataforma da confirmação divergente.', 409, 'platform_mismatch');
    }

    const candidates = candidatesFromTicket(ticket);
    if (!candidates.length) throw new RecognitionError('Nenhuma candidata disponível.', 422, 'no_candidates');

    const loaded = (await Promise.all(candidates.map(candidate => loadCandidateImage(env, candidate))))
      .filter(Boolean);
    if (!loaded.length) throw new RecognitionError('As imagens candidatas do catálogo não estão disponíveis.', 503, 'candidate_images_missing');

    performance.candidate_count = loaded.length;
    performance.candidate_codes = loaded.map(item => item.capa_code);
    performance.reference_load_ms = Date.now() - started - Number(performance.candidate_generation_ms || 0);

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    let comparison = null;
    try {
      comparison = await compareCatalogCandidates(env, photoBytes, image.type || 'image/jpeg', loaded, platform);
      performance.gemini_ms = comparison.elapsed_ms;
      performance.model = comparison.model;
      performance.confidence = comparison.confidence;
      performance.personalization_detected = comparison.personalization_detected;
      performance.observed_fixed_text = comparison.observed_fixed_text;
      performance.observed_subjects = comparison.observed_subjects;
      performance.observed_elements = comparison.observed_elements;
      performance.observed_colors = comparison.observed_colors;
      performance.candidate_assessments = comparison.assessments;
    } catch (error) {
      performance.comparator_error = error?.code || error?.message || 'catalog_comparison_failed';
    }

    const winner = comparison ? exactWinner(comparison, loaded) : null;
    if (!winner) {
      const suggestions = await buildSuggestions(env, loaded, comparison, platform);
      performance.accepted_by = comparison ? 'comparative-catalog-rejected' : 'comparator-unavailable-safe-suggestions';
      performance.suggestion_count = suggestions.length;
      finalizePerformance(performance, started);
      return json({
        error: suggestions.length
          ? 'Não consegui confirmar um único produto. Confira as possíveis correspondências abaixo.'
          : 'Não encontrei uma correspondência visual segura para este produto.',
        confidence: comparison?.confidence || loaded[0]?.retrieval_score || 0,
        platform,
        suggestions,
        suggestions_are_unconfirmed: true,
        identified_by: suggestions.length ? 'platform-catalog-visual-suggestions' : 'platform-catalog-no-match',
        performance
      }, 422);
    }

    const products = await productsForCover(env, winner.candidate.capa_code, platform);
    if (!products.length) {
      throw new RecognitionError('A capa foi reconhecida, mas não existe produto correspondente nesta plataforma.', 422, 'product_missing_for_platform');
    }

    performance.accepted_by = 'comparative-catalog-unique-winner';
    performance.winner_code = winner.candidate.capa_code;
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
        personalization_detected: comparison.personalization_detected,
        identified_by: 'platform-catalog-comparison+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0], displayImageUrl),
      capa_code: winner.candidate.capa_code,
      platform,
      confidence: winner.assessment.confidence,
      personalization_detected: comparison.personalization_detected,
      identified_by: 'platform-catalog-comparison-unique-winner',
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
