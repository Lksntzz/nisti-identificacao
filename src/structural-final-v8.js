import { parseSku } from './sku.js';
import { normalizePlatform } from './platform-scope.js';
import { reserveGeminiBudget } from './gemini-budget.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_CANDIDATES = 6;
const SUGGESTION_LIMIT = 3;
const MIN_STRUCTURAL_CONFIDENCE = 0.92;
const VERIFY_TIMEOUT_MS = 6500;
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
    'read_photo_ms', 'platform', 'platform_key', 'vectorize_namespace'
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

function personalizedFromCatalogText(values) {
  return (values || []).some(value =>
    /personalizad[oa]|personaliza[cç][aã]o/i.test(String(value || ''))
  );
}

async function candidateCatalogMetadata(env, capaCode, platform) {
  const { results } = await env.DB.prepare(`
    SELECT p.nome,p.variacao
    FROM products p
    JOIN product_platforms pp ON pp.product_id=p.id
    WHERE UPPER(TRIM(p.capa_code))=? AND UPPER(TRIM(pp.platform))=?
    ORDER BY p.id ASC
    LIMIT 8
  `).bind(
    String(capaCode || '').trim().toUpperCase(),
    normalizePlatform(platform)
  ).all();

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

async function resolveCandidate(env, candidate, platform) {
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

  const [object, metadata] = await Promise.all([
    env.PRODUCT_IMAGES.get(row.image_key),
    candidateCatalogMetadata(env, candidate.capa_code, platform)
  ]);
  if (!object) return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  const id = Number(row.id);
  const version = String(row.image_key).split('/').pop() || 'current';
  const mime = String(object.httpMetadata?.contentType || 'image/jpeg').toLowerCase();

  return {
    ...candidate,
    ...metadata,
    reference_id: id,
    image_key: row.image_key,
    thumbnail_url: `/api/reference-images/${id}?v=${encodeURIComponent(version)}`,
    mime_type: mime.startsWith('image/') ? mime : 'image/jpeg',
    source_bytes: bytes.length,
    bytes
  };
}

function parseStructuredJson(payload) {
  const text = (payload?.candidates?.[0]?.content?.parts || [])
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!text) {
    throw new RecognitionError(
      'Gemini não retornou decisão visual.',
      502,
      'catalog_comparator_empty'
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {}
    }
  }

  throw new RecognitionError(
    'Gemini retornou decisão inválida.',
    502,
    'catalog_comparator_invalid_json'
  );
}

function geminiErrorDetail(payload) {
  return String(payload?.error?.message || payload?.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function normalizeDecision(raw, allowedCodes) {
  const winnerCode = String(raw?.winner_code || '')
    .trim()
    .toUpperCase();
  const exactMatch = raw?.exact_match === true;
  const confidence = Math.max(0, Math.min(1, Number(raw?.confidence) || 0));
  const reasonCode = String(raw?.reason_code || 'unspecified')
    .trim()
    .toLowerCase()
    .slice(0, 80);

  return {
    winner_code: allowedCodes.has(winnerCode) ? winnerCode : null,
    exact_match: exactMatch,
    confidence,
    reason_code: reasonCode
  };
}

async function compareCatalog(env, photoBytes, photoMime, candidates, platform) {
  if (!env.GEMINI_API_KEY) {
    throw new RecognitionError(
      'GEMINI_API_KEY não configurada',
      503,
      'gemini_not_configured'
    );
  }

  const allowed = await reserveGeminiBudget(
    env,
    'catalog-verifier-total-v8',
    VERIFIER_RPM_LIMIT
  );
  if (!allowed) {
    throw new RecognitionError(
      'Limite interno de análise visual atingido.',
      503,
      'gemini_local_budget_exhausted'
    );
  }

  const model = env.GEMINI_VERIFIER_MODEL || env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort('catalog-comparison-timeout'),
    VERIFY_TIMEOUT_MS
  );
  const started = Date.now();

  const prompt = `Você identifica a ARTE-BASE impressa de produtos NISTI PRINT.
A FOTO deve ser comparada com TODAS as candidatas abaixo. Nenhuma candidata é referência principal e a ordem NÃO indica a resposta.
Retorne winner_code somente se UMA candidata for exatamente a mesma arte-base da FOTO.
Compare obrigatoriamente: texto fixo, personagem/objeto principal, elementos gráficos, cores dominantes e layout.
Ignore completamente itens físicos que não fazem parte da impressão: wire-o/espiral, elástico, tassel, plástico, laminação, holografia, brilho, reflexo, sombra, mão, mesa, perspectiva, recorte e fundo externo.
Quando PERSONALIZADO=SIM, ignore somente nome próprio, inicial/letra ou data variável; títulos e frases fixas continuam obrigatórios.
Não aceite por tema, cor geral ou estilo parecido. Se houver diferença permanente relevante, ou se nenhuma candidata for exata, use winner_code="NONE" e exact_match=false.`;

  const parts = [
    { text: prompt },
    { text: 'FOTO DO PRODUTO:' },
    {
      inline_data: {
        mime_type: photoMime || 'image/jpeg',
        data: base64(photoBytes)
      }
    }
  ];

  for (const candidate of candidates) {
    const labels = candidate.catalog_labels?.length
      ? candidate.catalog_labels.join(' | ')
      : 'sem descrição adicional';
    parts.push({
      text: `CANDIDATA CAPA_CODE=${candidate.capa_code}; PERSONALIZADO=${candidate.catalog_personalized ? 'SIM' : 'NÃO'}; CADASTRO=${labels}`
    });
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
            maxOutputTokens: 80,
            media_resolution: 'MEDIA_RESOLUTION_LOW',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                winner_code: { type: 'STRING' },
                exact_match: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER' },
                reason_code: { type: 'STRING' }
              },
              required: [
                'winner_code',
                'exact_match',
                'confidence',
                'reason_code'
              ]
            }
          }
        })
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = geminiErrorDetail(payload);
      throw new RecognitionError(
        detail
          ? `Gemini comparador falhou (${response.status}): ${detail}`
          : `Gemini comparador falhou (${response.status})`,
        [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502,
        `catalog_comparator_http_${response.status}`
      );
    }

    const parsed = parseStructuredJson(await response.json());
    const allowedCodes = new Set(candidates.map(item => item.capa_code));
    return {
      model,
      elapsed_ms: Date.now() - started,
      decision: normalizeDecision(parsed, allowedCodes)
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

async function buildSuggestions(env, candidates, platform) {
  const suggestions = [];
  for (const candidate of candidates) {
    if (suggestions.length >= SUGGESTION_LIMIT) break;
    const products = await productsForCover(env, candidate.capa_code, platform);
    if (!products.length) continue;
    suggestions.push({
      capa_code: candidate.capa_code,
      confidence: Number(candidate.retrieval_score || 0),
      retrieval_score: Number(candidate.retrieval_score || 0),
      verification_source: 'vector-retrieval',
      catalog_personalized: candidate.catalog_personalized === true,
      thumbnail_url: candidate.thumbnail_url,
      products: products.map(product =>
        productPayload(product, candidate.thumbnail_url)
      )
    });
  }
  return suggestions;
}

function finalizePerformance(performance, started) {
  const verifierMs = Date.now() - started;
  performance.fallback_ms = verifierMs;
  performance.total_ms = Math.max(
    0,
    Number(performance.candidate_generation_ms || 0)
  ) + verifierMs;
}

async function successResponse(
  env,
  candidate,
  platform,
  confidence,
  performance,
  identifiedBy
) {
  const products = await productsForCover(env, candidate.capa_code, platform);
  if (!products.length) {
    throw new RecognitionError(
      'A capa foi reconhecida, mas não existe produto correspondente nesta plataforma.',
      422,
      'product_missing_for_platform'
    );
  }

  const displayImageUrl = candidate.thumbnail_url;

  if (products.length > 1) {
    return json({
      needs_selection: true,
      selection_reason: 'same_cover_multiple_skus',
      capa_code: candidate.capa_code,
      platform,
      products: products.map(product =>
        productPayload(product, displayImageUrl)
      ),
      confidence,
      identified_by: `${identifiedBy}+human-sku-selection`,
      performance
    });
  }

  return json({
    product: productPayload(products[0], displayImageUrl),
    capa_code: candidate.capa_code,
    platform,
    confidence,
    identified_by: identifiedBy,
    performance
  });
}

export async function structuralFinalIdentifyV8(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'platform-vectorize+comparative-six-v8.7',
    verification_mode: 'single-call-multi-candidate-exact-art',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true,
    candidate_transport: 'inline-r2-bytes'
  };

  try {
    const ticket = await readSignedTicket(
      env,
      cookieValue(request, COOKIE_NAME)
    );
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
        'Plataforma ausente no ticket.',
        409,
        'candidate_platform_missing'
      );
    }
    performance.platform = platform;

    const form = await request.formData();
    const image = form.get('image');
    const requestedPlatform = normalizePlatform(form.get('platform'));

    if (!(image instanceof File)) {
      throw new RecognitionError(
        'Foto da capa obrigatória.',
        400,
        'image_required'
      );
    }
    if (!requestedPlatform || requestedPlatform !== platform) {
      throw new RecognitionError(
        'Plataforma da confirmação divergente.',
        409,
        'platform_mismatch'
      );
    }

    const rawCandidates = candidatesFromTicket(ticket);
    if (!rawCandidates.length) {
      throw new RecognitionError(
        'Nenhuma candidata disponível.',
        422,
        'no_candidates'
      );
    }

    const referenceStarted = Date.now();
    const loaded = (await Promise.all(
      rawCandidates.map(candidate =>
        resolveCandidate(env, candidate, platform)
      )
    )).filter(Boolean);
    performance.reference_load_ms = Date.now() - referenceStarted;

    if (!loaded.length) {
      throw new RecognitionError(
        'As imagens candidatas do catálogo não estão disponíveis.',
        503,
        'candidate_images_missing'
      );
    }

    performance.candidate_count = loaded.length;
    performance.candidate_codes = loaded.map(item => item.capa_code);
    performance.candidate_source_bytes = loaded.map(item => ({
      code: item.capa_code,
      bytes: item.source_bytes
    }));

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    let comparison = null;
    let comparatorError = null;
    const verifyStarted = Date.now();

    try {
      comparison = await compareCatalog(
        env,
        photoBytes,
        image.type || 'image/jpeg',
        loaded,
        platform
      );
    } catch (error) {
      comparatorError = error;
    }

    performance.gemini_ms = Date.now() - verifyStarted;
    performance.gemini_calls = comparison ? 1 : 0;
    performance.model = comparison?.model || env.GEMINI_VERIFIER_MODEL || env.GEMINI_MODEL || null;

    if (comparison) {
      const decision = comparison.decision;
      performance.verifier_reason_code = decision.reason_code;
      performance.verifier_evidence = `winner=${decision.winner_code || 'NONE'}; exact=${decision.exact_match}; confidence=${decision.confidence.toFixed(3)}`;
      performance.gemini_confidence = decision.confidence;

      if (
        decision.exact_match &&
        decision.winner_code &&
        decision.confidence >= MIN_STRUCTURAL_CONFIDENCE
      ) {
        const winner = loaded.find(
          item => item.capa_code === decision.winner_code
        );
        if (winner) {
          performance.accepted_by = 'comparative-exact-art-winner';
          performance.winner_code = winner.capa_code;
          finalizePerformance(performance, started);
          return successResponse(
            env,
            winner,
            platform,
            decision.confidence,
            performance,
            'platform-catalog-v8.7-comparative-winner'
          );
        }
      }
    }

    if (comparatorError) {
      performance.comparator_error = comparatorError.code || comparatorError.message || 'catalog_comparison_failed';
      performance.comparator_error_message = comparatorError.message || null;
      performance.verifier_reason_code = performance.comparator_error;
      performance.verifier_evidence = String(comparatorError.message || '').slice(0, 220);
    }

    const suggestions = await buildSuggestions(env, loaded, platform);
    performance.accepted_by = comparatorError
      ? `comparator-unavailable:${performance.comparator_error}`
      : 'comparative-no-exact-winner';
    performance.suggestion_count = suggestions.length;
    finalizePerformance(performance, started);

    return json({
      error: suggestions.length
        ? 'Não consegui confirmar um único produto. Confira as possíveis correspondências abaixo.'
        : 'Não encontrei uma correspondência visual segura para este produto.',
      confidence: comparison?.decision?.confidence || loaded[0]?.retrieval_score || 0,
      platform,
      suggestions,
      suggestions_are_unconfirmed: true,
      identified_by: suggestions.length
        ? 'platform-catalog-visual-suggestions-v8.7'
        : 'platform-catalog-no-match-v8.7',
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
