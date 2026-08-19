import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_RETRIEVAL_COVERS = 6;
const FINAL_COVER_LIMIT = 3;
const MIN_EXACT_CONFIDENCE = 0.97;
const MIN_SUGGESTION_CONFIDENCE = 0.72;
const VERIFY_TIMEOUT_MS = 12_000;

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

function verificationParts(photoBytes, photoMime, groups, platform) {
  const allowedCodes = groups.map(group => group.cover.capa_code).join(', ');
  const parts = [{
    text: `Você é o verificador final de identidade visual da NISTI PRINT para a plataforma ${platform}. Compare a FOTO somente com as ${groups.length} referências fornecidas.\n\nCAPA_CODE permitidos: ${allowedCodes}.\n\nREGRAS:\n1. Avalie cada candidata separadamente. NÃO escolha simplesmente a mais parecida.\n2. Ignore somente nome próprio, inicial/letra e datas personalizadas do cliente.\n3. Textos fixos da arte são discriminadores fortes. Texto fixo conflitante reprova a candidata.\n4. Compare fundo/textura, faixas, molduras, linhas, posição dos blocos, ícones/ilustrações, tipografia fixa e assinatura gráfica.\n5. Cor isolada, Wire-O, elástico, tassel, brilho, reflexo, mão, mesa, recorte e perspectiva não provam identidade.\n6. unique_match=true somente quando exatamente UMA candidata representar a mesma arte-base. Caso contrário selected_capa_code=NONE.\n7. Para cada candidata retorne também confidence de 0 a 1 para permitir ordenar possíveis correspondências sem tratá-las como identificação.`
  }, {
    text: 'FOTO A IDENTIFICAR:'
  }, {
    inline_data: {
      mime_type: photoMime || 'image/jpeg',
      data: base64(photoBytes)
    }
  }];

  for (const group of groups) {
    const code = group.cover.capa_code;
    parts.push({ text: `REFERÊNCIA CAPA_CODE=${code}` });
    parts.push({
      inline_data: {
        mime_type: group.reference.mimeType,
        data: base64(group.reference.bytes)
      }
    });
  }
  return parts;
}

async function verifyFinal(env, photoBytes, photoMime, groups, platform) {
  if (!env.GEMINI_API_KEY) {
    throw new RecognitionError(
      'GEMINI_API_KEY não configurada',
      503,
      'gemini_not_configured'
    );
  }

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
            parts: verificationParts(photoBytes, photoMime, groups, platform)
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 360,
            media_resolution: 'MEDIA_RESOLUTION_MEDIUM',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                selected_capa_code: { type: 'STRING' },
                unique_match: { type: 'BOOLEAN' },
                assessments: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      capa_code: { type: 'STRING' },
                      same_base_art: { type: 'BOOLEAN' },
                      permanent_text_compatible: { type: 'BOOLEAN' },
                      layout_match: { type: 'BOOLEAN' },
                      distinctive_graphics_match: { type: 'BOOLEAN' },
                      disqualifying_conflict: { type: 'BOOLEAN' },
                      confidence: { type: 'NUMBER' }
                    },
                    required: [
                      'capa_code', 'same_base_art', 'permanent_text_compatible',
                      'layout_match', 'distinctive_graphics_match',
                      'disqualifying_conflict', 'confidence'
                    ]
                  }
                }
              },
              required: ['selected_capa_code', 'unique_match', 'assessments']
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new RecognitionError(
        `Gemini verificador falhou (${response.status})`,
        503,
        'gemini_verifier_failed'
      );
    }

    const result = parseStructuredJson(await response.json());
    const allowed = new Set(groups.map(group => group.cover.capa_code));
    const assessments = Array.isArray(result?.assessments)
      ? result.assessments.map(item => ({
          capa_code: String(item?.capa_code || '').trim().toUpperCase(),
          same_base_art: item?.same_base_art === true,
          permanent_text_compatible: item?.permanent_text_compatible === true,
          layout_match: item?.layout_match === true,
          distinctive_graphics_match: item?.distinctive_graphics_match === true,
          disqualifying_conflict: item?.disqualifying_conflict === true,
          confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0))
        })).filter(item => allowed.has(item.capa_code))
      : [];

    const exact = assessments.filter(item =>
      item.same_base_art === true &&
      item.permanent_text_compatible === true &&
      item.layout_match === true &&
      item.distinctive_graphics_match === true &&
      item.disqualifying_conflict !== true &&
      item.confidence >= MIN_EXACT_CONFIDENCE
    );

    const proposedCode = String(result?.selected_capa_code || '').trim().toUpperCase();
    const accepted =
      result?.unique_match === true &&
      exact.length === 1 &&
      allowed.has(proposedCode) &&
      exact[0].capa_code === proposedCode;

    return {
      accepted,
      selected_capa_code: accepted ? proposedCode : null,
      proposed_capa_code: proposedCode || null,
      unique_match: result?.unique_match === true,
      assessments,
      confidence: accepted
        ? exact[0].confidence
        : Math.max(0, ...assessments.map(item => item.confidence)),
      model,
      elapsed_ms: Date.now() - started
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new RecognitionError(
        'Gemini verificador excedeu o tempo disponível.',
        503,
        'gemini_verifier_timeout'
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

async function buildSuggestions(env, assessments, groups, platform) {
  const retrievalByCode = new Map(
    groups.map(group => [group.cover.capa_code, group.cover.retrieval_score])
  );

  const eligible = assessments
    .filter(item =>
      item.disqualifying_conflict !== true &&
      item.permanent_text_compatible === true &&
      (item.layout_match === true || item.distinctive_graphics_match === true) &&
      item.confidence >= MIN_SUGGESTION_CONFIDENCE
    )
    .sort((a, b) =>
      b.confidence - a.confidence ||
      Number(retrievalByCode.get(b.capa_code) || 0) -
        Number(retrievalByCode.get(a.capa_code) || 0)
    )
    .slice(0, 3);

  const suggestions = [];
  for (const item of eligible) {
    const products = await productsForCover(env, item.capa_code, platform);
    if (!products.length) continue;
    suggestions.push({
      capa_code: item.capa_code,
      confidence: item.confidence,
      retrieval_score: Number(retrievalByCode.get(item.capa_code) || 0),
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

export async function structuralFinalIdentifyV2(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-scoped-vectorize+gemini-final-v1',
    verification_mode: 'platform-scoped-strict-classifier',
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

    const decision = await verifyFinal(
      env,
      photoBytes,
      photoMime,
      groups,
      platform
    );
    performance.gemini_ms = decision.elapsed_ms;
    performance.model = decision.model;
    performance.proposed_code = decision.proposed_capa_code;
    performance.confidence = decision.confidence;
    performance.assessments = decision.assessments;

    if (!decision.accepted || !decision.selected_capa_code) {
      const suggestions = await buildSuggestions(
        env,
        decision.assessments,
        groups,
        platform
      );
      performance.accepted_by = 'strict-classifier-rejected';
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
        identified_by: suggestions.length
          ? 'platform-scoped-verified-suggestions'
          : 'platform-scoped-strict-classifier-no-match',
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

    performance.accepted_by = 'platform-scoped-unique-winner';
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
      identified_by: 'platform-scoped-unique-winner',
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
