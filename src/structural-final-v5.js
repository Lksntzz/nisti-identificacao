import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';
import { reserveGeminiBudget } from './gemini-budget.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_COVERS = 6;
const SUGGESTION_LIMIT = 3;
const MIN_EXACT_CONFIDENCE = 0.96;
const VERIFY_TIMEOUT_MS = 7000;
const VERIFIER_RPM_LIMIT = 8;

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

async function loadReference(env, cover) {
  let row = null;
  if (cover.reference_id) {
    row = await env.DB.prepare(`
      SELECT id,capa_code,image_key
      FROM cover_visual_references
      WHERE id=? AND active=1 AND image_key IS NOT NULL
      LIMIT 1
    `).bind(cover.reference_id).first();
  }

  if (!row || String(row.capa_code || '').trim().toUpperCase() !== cover.capa_code) {
    row = await env.DB.prepare(`
      SELECT id,capa_code,image_key
      FROM cover_visual_references
      WHERE UPPER(TRIM(capa_code))=? AND active=1 AND image_key IS NOT NULL
      ORDER BY id ASC
      LIMIT 1
    `).bind(cover.capa_code).first();
  }

  if (!row?.image_key) return null;
  const object = await env.PRODUCT_IMAGES.get(row.image_key);
  if (!object) return null;

  return {
    id: Number(row.id),
    capa_code: String(row.capa_code || '').trim().toUpperCase(),
    image_key: row.image_key,
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
  if (!text) throw new Error('empty_pairwise_response');
  try {
    return JSON.parse(text);
  } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(text.slice(first, last + 1));
  throw new Error('invalid_pairwise_json');
}

function normalizeStrings(values, limit = 8) {
  const output = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim();
    if (!value || output.includes(value)) continue;
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

function normalizeAssessment(result, elapsedMs, error = null) {
  return {
    completed: !error,
    same_base_art: result?.same_base_art === true,
    fixed_text_match: result?.fixed_text_match === true,
    primary_subject_match: result?.primary_subject_match === true,
    graphic_elements_match: result?.graphic_elements_match === true,
    dominant_colors_match: result?.dominant_colors_match === true,
    layout_match: result?.layout_match === true,
    disqualifying_conflict: result?.disqualifying_conflict === true,
    confidence: Math.max(0, Math.min(1, Number(result?.confidence) || 0)),
    observed_fixed_text: normalizeStrings(result?.observed_fixed_text, 6),
    observed_subjects: normalizeStrings(result?.observed_subjects, 6),
    observed_elements: normalizeStrings(result?.observed_elements, 8),
    observed_colors: normalizeStrings(result?.observed_colors, 6),
    elapsed_ms: Number(elapsedMs || 0),
    error
  };
}

async function verifyTopCandidate(env, photoBytes, photoMime, cover, reference, platform) {
  if (!env.GEMINI_API_KEY) {
    return normalizeAssessment(null, 0, 'gemini_not_configured');
  }

  const allowed = await reserveGeminiBudget(
    env,
    'gemini-3.5-flash-lite-pairwise-verifier',
    VERIFIER_RPM_LIMIT
  );
  if (!allowed) {
    return normalizeAssessment(null, 0, 'gemini_local_budget_exhausted');
  }

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('pairwise-timeout'), VERIFY_TIMEOUT_MS);
  const started = Date.now();

  const prompt = `Compare a FOTO do produto físico com a REFERÊNCIA NISTI PRINT da plataforma ${platform}. A referência candidata tem CAPA_CODE=${cover.capa_code}.

Objetivo: decidir se é EXATAMENTE A MESMA ARTE-BASE, não apenas uma capa parecida.

Analise obrigatoriamente nesta ordem:
1. TEXTO FIXO permanente da arte. Ignore somente nome próprio, inicial/letra e datas personalizadas.
2. PERSONAGEM, SÍMBOLO ou OBJETO principal permanente.
3. ELEMENTOS GRÁFICOS permanentes: folhas, flores, ícones, molduras, faixas, linhas, estrelas, corações etc.
4. CORES DOMINANTES e distribuição das grandes regiões de cor da capa.
5. LAYOUT: posições relativas de título, personagem/objeto, elementos e áreas de cor.

Ignore Wire-O/espiral, elástico, tassel, mão, mesa, fundo externo, brilho, reflexo, perspectiva e recorte.
Não aceite por estilo geral, tema ou cor parecida. Se qualquer elemento permanente importante divergir, same_base_art=false.
primary_subject_match=true quando os assuntos principais correspondem ou quando ambas as artes realmente não possuem assunto principal.

Também descreva resumidamente o que você observa NA FOTO em texto fixo, assuntos, elementos e cores. Seja conservador.`;

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
            parts: [
              { text: prompt },
              { text: 'FOTO DO PRODUTO FÍSICO:' },
              {
                inline_data: {
                  mime_type: photoMime || 'image/jpeg',
                  data: base64(photoBytes)
                }
              },
              { text: `REFERÊNCIA CAPA_CODE=${cover.capa_code}:` },
              {
                inline_data: {
                  mime_type: reference.mime_type,
                  data: base64(reference.bytes)
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 220,
            media_resolution: 'MEDIA_RESOLUTION_LOW',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                same_base_art: { type: 'BOOLEAN' },
                fixed_text_match: { type: 'BOOLEAN' },
                primary_subject_match: { type: 'BOOLEAN' },
                graphic_elements_match: { type: 'BOOLEAN' },
                dominant_colors_match: { type: 'BOOLEAN' },
                layout_match: { type: 'BOOLEAN' },
                disqualifying_conflict: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER' },
                observed_fixed_text: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_subjects: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_elements: { type: 'ARRAY', items: { type: 'STRING' } },
                observed_colors: { type: 'ARRAY', items: { type: 'STRING' } }
              },
              required: [
                'same_base_art','fixed_text_match','primary_subject_match',
                'graphic_elements_match','dominant_colors_match','layout_match',
                'disqualifying_conflict','confidence','observed_fixed_text',
                'observed_subjects','observed_elements','observed_colors'
              ]
            }
          }
        })
      }
    );

    if (!response.ok) {
      return normalizeAssessment(null, Date.now() - started, `gemini_http_${response.status}`);
    }

    const parsed = parseStructuredJson(await response.json());
    return normalizeAssessment(parsed, Date.now() - started);
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === 'AbortError';
    return normalizeAssessment(
      null,
      Date.now() - started,
      timedOut ? 'pairwise_timeout' : 'pairwise_request_error'
    );
  } finally {
    clearTimeout(timer);
  }
}

function isExact(assessment) {
  return assessment?.completed === true &&
    assessment.same_base_art === true &&
    assessment.fixed_text_match === true &&
    assessment.primary_subject_match === true &&
    assessment.graphic_elements_match === true &&
    assessment.dominant_colors_match === true &&
    assessment.layout_match === true &&
    assessment.disqualifying_conflict !== true &&
    assessment.confidence >= MIN_EXACT_CONFIDENCE;
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

async function buildSuggestions(env, covers, platform) {
  const suggestions = [];
  for (const cover of covers.slice(0, SUGGESTION_LIMIT)) {
    const products = await productsForCover(env, cover.capa_code, platform);
    if (!products.length) continue;
    suggestions.push({
      capa_code: cover.capa_code,
      confidence: cover.retrieval_score,
      retrieval_score: cover.retrieval_score,
      verification_source: 'vector-retrieval-unconfirmed',
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

export async function structuralFinalIdentifyV5(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-vectorize+single-pairwise-verifier-v5',
    verification_mode: 'top1-pairwise-text-subject-elements-colors-layout',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true,
    verifier_rpm_limit: VERIFIER_RPM_LIMIT
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

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    const first = covers[0];
    const referenceStarted = Date.now();
    const reference = await loadReference(env, first);
    performance.reference_load_ms = Date.now() - referenceStarted;

    let assessment = normalizeAssessment(null, 0, 'reference_missing');
    if (reference) {
      assessment = await verifyTopCandidate(
        env,
        photoBytes,
        image.type || 'image/jpeg',
        first,
        reference,
        platform
      );
    }

    performance.gemini_ms = assessment.elapsed_ms || null;
    performance.model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    performance.confidence = assessment.confidence;
    performance.verifier_error = assessment.error;
    performance.observed_fixed_text = assessment.observed_fixed_text;
    performance.observed_subjects = assessment.observed_subjects;
    performance.observed_elements = assessment.observed_elements;
    performance.observed_colors = assessment.observed_colors;
    performance.verifier_signals = {
      same_base_art: assessment.same_base_art,
      fixed_text_match: assessment.fixed_text_match,
      primary_subject_match: assessment.primary_subject_match,
      graphic_elements_match: assessment.graphic_elements_match,
      dominant_colors_match: assessment.dominant_colors_match,
      layout_match: assessment.layout_match,
      disqualifying_conflict: assessment.disqualifying_conflict
    };

    if (isExact(assessment)) {
      const products = await productsForCover(env, first.capa_code, platform);
      if (!products.length) {
        throw new RecognitionError(
          'A capa foi reconhecida, mas não existe produto correspondente nesta plataforma.',
          422,
          'product_missing_for_platform'
        );
      }

      performance.accepted_by = 'pairwise-top1-all-permanent-signals';
      performance.winner_code = first.capa_code;
      finalizePerformance(performance, started);

      if (products.length > 1) {
        return json({
          needs_selection: true,
          selection_reason: 'same_cover_multiple_skus',
          capa_code: first.capa_code,
          platform,
          products: products.map(productPayload),
          confidence: assessment.confidence,
          identified_by: 'platform-pairwise-v5+human-sku-selection',
          performance
        });
      }

      return json({
        product: productPayload(products[0]),
        capa_code: first.capa_code,
        platform,
        confidence: assessment.confidence,
        identified_by: 'platform-pairwise-v5-exact',
        performance
      });
    }

    const suggestions = await buildSuggestions(env, covers, platform);
    performance.accepted_by = assessment.completed
      ? 'pairwise-top1-rejected'
      : 'pairwise-unavailable-safe-suggestions';
    performance.suggestion_count = suggestions.length;
    finalizePerformance(performance, started);

    return json({
      error: suggestions.length
        ? 'Não consegui confirmar a capa com segurança. Confira as possíveis correspondências abaixo.'
        : 'Não encontrei uma correspondência visual segura para esta capa.',
      confidence: assessment.confidence,
      platform,
      suggestions,
      suggestions_are_unconfirmed: true,
      identified_by: suggestions.length
        ? 'platform-pairwise-v5-suggestions'
        : 'platform-pairwise-v5-no-match',
      performance
    }, 422);
  } catch (error) {
    finalizePerformance(performance, started);
    return json({
      error: error?.message || 'Falha no reconhecimento visual.',
      technical_error: error?.code || 'recognition_error',
      performance
    }, Number(error?.status) || 500);
  }
}
