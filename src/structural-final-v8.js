import { parseSku } from './sku.js';
import { normalizePlatform, platformNamespace } from './platform-scope.js';
import { reserveGeminiBudget } from './gemini-budget.js';
import { detectCrossPlatformMatch, embedImage } from './vectorize-candidates.js';
import { recordScanOccurrence } from './occurrences-router.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_CANDIDATES = 4;
const SUGGESTION_LIMIT = 4;
const MIN_STRUCTURAL_CONFIDENCE = 0.65;
const VERIFY_TIMEOUT_MS = 8000;
const VERIFIER_RPM_LIMIT = 60;

class RecognitionError extends Error {
  constructor(message, status = 500, code = 'recognition_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

import { Buffer } from 'node:buffer';

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
  return Buffer.from(bytes).toString('base64');
}

function base64urlDecode(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
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
    const secret = String(env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || '');
    if (!encoded || !signature || !secret) return null;
    const key = await ticketKey(secret);
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
      reference_id: Number(ref?.reference_id || 0) || null,
      reference_kind: ref?.reference_kind || 'product'
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
      SELECT id,capa_code,image_key,reference_kind
      FROM cover_visual_references
      WHERE id=? AND active=1 AND image_key IS NOT NULL
      LIMIT 1
    `).bind(candidate.reference_id).first();
  }

  if (!row || String(row.capa_code || '').trim().toUpperCase() !== candidate.capa_code) {
    row = await env.DB.prepare(`
      SELECT id,capa_code,image_key,reference_kind
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
    reference_kind: row.reference_kind || candidate.reference_kind || 'product',
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
  const photoOcrText = String(raw?.photo_ocr_text || '').trim();
  const photoMonogramLetter = String(raw?.photo_monogram_letter || '').trim().toUpperCase();
  const photoDominantColor = String(raw?.photo_dominant_color || '').trim();

  return {
    winner_code: allowedCodes.has(winnerCode) ? winnerCode : null,
    exact_match: exactMatch,
    confidence,
    reason_code: reasonCode,
    photo_ocr_text: photoOcrText || null,
    photo_monogram_letter: (photoMonogramLetter && photoMonogramLetter !== 'NONE') ? photoMonogramLetter : null,
    photo_dominant_color: photoDominantColor || null
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

  const model = env.GEMINI_VERIFIER_MODEL || 'gemini-3.6-flash';
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort('catalog-comparison-timeout'),
    VERIFY_TIMEOUT_MS
  );
  const started = Date.now();

  const prompt = `Você é o classificador visual oficial da gráfica NISTI PRINT.
Sua missão é confirmar se a FOTO DO PRODUTO corresponde exatamente à ARTE-BASE de uma das CANDIDATAS do catálogo.

REGRAS OBRIGATÓRIAS:
1. Compare principalmente a ilustração fixa, composição, personagens, elementos gráficos, geometria, tipografia fixa e paleta essencial da ARTE-BASE.
2. PERSONALIZAÇÃO VARIÁVEL NÃO DEFINE CAPA: nomes de clientes, iniciais e monogramas personalizados podem mudar entre a foto e a referência. Ignore essas diferenças quando forem campos variáveis de personalização. Só use uma letra/monograma como evidência discriminante quando estiver claramente integrado à arte-base fixa.
3. Não elimine uma candidata apenas por pequenas diferenças de luminosidade, saturação ou sub-tom causadas por impressão, câmera, laminação ou iluminação. Rejeite quando a paleta-base ou a composição realmente forem diferentes.
4. Ignore wire-o, furos, elásticos, tassel, plástico, reflexos, sombras, mãos, fundo, recorte e perspectiva.
5. Não invente correspondência. Se nenhuma candidata tiver a mesma arte-base, retorne NONE.

DECISÃO:
- Se houver correspondência inequívoca de ARTE-BASE, retorne winner_code com o CAPA_CODE, exact_match=true e confidence entre 0 e 1.
- Caso contrário, retorne winner_code="NONE", exact_match=false e confidence baixa.
- reason_code deve ser curto e técnico, por exemplo: exact_base_art, different_illustration, different_layout, insufficient_visual_evidence.`;

  const parts = [
    { text: prompt },
    { text: 'FOTO DO PRODUTO (Tirada na expedição):' },
    {
      inline_data: {
        mime_type: photoMime || 'image/jpeg',
        data: base64(photoBytes)
      }
    }
  ];

  for (const candidate of candidates) {
    const isRealScan = candidate.reference_kind === 'real_scan';
    const baseLabels = candidate.catalog_labels?.length
      ? candidate.catalog_labels.join(' | ')
      : 'sem descrição adicional';
    const labels = isRealScan
      ? `${baseLabels} [FOTO REAL DE BANCADA APROVADA PELO ADMINISTRADOR - PRIORIDADE MÁXIMA]`
      : baseLabels;

    parts.push({
      text: `CANDIDATA CAPA_CODE=${candidate.capa_code}; CADASTRO=${labels}${isRealScan ? ' [GROUND_TRUTH_ADM]' : ''}`
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
            maxOutputTokens: 256,
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
          ? `Gemini comparador (${model}) falhou (${response.status}): ${detail}`
          : `Gemini comparador (${model}) falhou (${response.status})`,
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
  } catch (err) {
    if (controller.signal.aborted || err?.name === 'AbortError') {
      throw new RecognitionError(
        'A análise visual excedeu o tempo disponível.',
        503,
        'catalog_comparator_timeout'
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function productPayload(product) {
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
    image_url: productImage
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

  if (products.length > 1) {
    return json({
      needs_selection: true,
      selection_reason: 'same_cover_multiple_skus',
      capa_code: candidate.capa_code,
      platform,
      products: products.map(product => productPayload(product)),
      confidence,
      identified_by: `${identifiedBy}+human-sku-selection`,
      performance
    });
  }

  return json({
    product: productPayload(products[0]),
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
    pipeline_version: 'platform-vectorize+single-gemini-v8.8',
    verification_mode: 'single-model-exact-art-fail-closed',
    retrieval_source: 'vectorize-platform-ticket-reuse',
    reused_candidates: true,
    candidate_transport: 'inline-r2-bytes'
  };

  try {
    const form = await request.formData();
    const image = form.get('image');
    const requestedPlatform = normalizePlatform(form.get('platform'));
    const formTicket = String(form.get('ticket') || '').trim();
    const cookieTicket = cookieValue(request, COOKIE_NAME);
    const headerTicket = request.headers.get('x-recognition-ticket');

    const ticket = await readSignedTicket(
      env,
      formTicket || cookieTicket || headerTicket
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

    const topScore = Number(ticket.performance?.retrieval_top1 ?? rawCandidates[0]?.retrieval_score ?? 0);
    if (topScore < 0.45) {
      throw new RecognitionError(
        `Produto não corresponde ao catálogo da plataforma ${platform}. Identificação abortada para economia de recursos.`,
        422,
        'low_retrieval_score_barrier'
      );
    }

    const referenceStarted = Date.now();
    const loaded = (await Promise.all(
      rawCandidates.map(candidate =>
        resolveCandidate(env, candidate, platform)
      )
    )).filter(Boolean);
    performance.reference_load_ms = Date.now() - referenceStarted;

    loaded.sort((a, b) => {
      const aTrained = a.reference_kind === 'real_scan' && Number(a.retrieval_score || 0) >= 0.82;
      const bTrained = b.reference_kind === 'real_scan' && Number(b.retrieval_score || 0) >= 0.82;
      if (aTrained && !bTrained) return -1;
      if (!aTrained && bTrained) return 1;
      return Number(b.retrieval_score || 0) - Number(a.retrieval_score || 0);
    });

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
    performance.gemini_calls = ['gemini_not_configured', 'gemini_local_budget_exhausted'].includes(comparatorError?.code)
      ? 0
      : 1;
    performance.model = comparison?.model || env.GEMINI_VERIFIER_MODEL || 'gemini-3.6-flash';

    if (comparison) {
      const decision = comparison.decision;
      performance.verifier_reason_code = decision.reason_code;
      performance.verifier_evidence = `winner=${decision.winner_code || 'NONE'}; exact=${decision.exact_match}; confidence=${decision.confidence.toFixed(3)}`;
      performance.gemini_confidence = decision.confidence;
      if (decision.photo_ocr_text) performance.ocr_text = decision.photo_ocr_text;
      if (decision.photo_monogram_letter) performance.monogram_letter = decision.photo_monogram_letter;
      if (decision.photo_dominant_color) performance.dominant_color = decision.photo_dominant_color;

      if (
        decision.winner_code &&
        decision.winner_code !== 'NONE' &&
        decision.exact_match === true &&
        decision.confidence >= MIN_STRUCTURAL_CONFIDENCE
      ) {
        const winnerCode = decision.winner_code;
        const candidateMap = new Map(loaded.map(c => [c.capa_code, c]));
        const winner = candidateMap.get(winnerCode);
        if (winner) {
          performance.accepted_by = 'comparative-exact-winner';
          performance.suggestion_count = 0;
          finalizePerformance(performance, started);
          return successResponse(
            env,
            winner,
            platform,
            Math.max(decision.confidence, 0.75),
            performance,
            'platform-catalog-v8.8-comparative-winner'
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

    let occurrenceId = null;
    try {
      let operatorName = null;
      const rawOpName = request?.headers?.get('x-operator-name');
      if (rawOpName) {
        try { operatorName = decodeURIComponent(rawOpName); } catch { operatorName = rawOpName; }
      }
      const operatorId = request?.headers?.get('x-operator-id') || request?.headers?.get('x-user-id') || null;

      occurrenceId = await recordScanOccurrence(env, {
        photoBytes,
        photoMime: image.type || 'image/jpeg',
        platform,
        suggestedCapaCode: loaded[0]?.capa_code || null,
        confidence: comparison?.decision?.confidence || (loaded[0]?.retrieval_score || 0),
        errorReason: comparatorError
          ? (comparatorError.code || 'catalog_comparison_failed')
          : 'no_exact_winner',
        operatorName,
        operatorId
      });
    } catch (e) {
      console.error('Falha ao gravar ocorrencia:', e);
    }

    performance.accepted_by = comparatorError
      ? `comparator-unavailable:${performance.comparator_error}`
      : 'comparative-no-exact-winner';
    performance.suggestion_count = 0;
    finalizePerformance(performance, started);

    return json({
      error: comparatorError
        ? 'Não foi possível confirmar a capa com segurança. Tente outra foto.'
        : `Produto não identificado na plataforma ${platform}. Verifique o enquadramento ou cadastre no catálogo.`,
      confidence: comparison?.decision?.confidence || 0,
      platform,
      suggested_platform: null,
      suggestions: [],
      suggestions_are_unconfirmed: false,
      identified_by: 'platform-catalog-no-match-v8.8',
      performance,
      occurrence_id: occurrenceId,
      sent_to_adm: true
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

export async function identifyProductByDetail(request, env) {
  try {
    const form = await request.formData();
    const image = form.get('image');
    const capaCode = String(form.get('capa_code') || '').trim().toUpperCase();
    const platform = normalizePlatform(form.get('platform'));

    if (!(image instanceof File)) {
      return json({ error: 'Foto de detalhe obrigatória.' }, 400);
    }
    if (!capaCode || !platform) {
      return json({ error: 'Capa e plataforma obrigatórias.' }, 400);
    }

    const products = await productsForCover(env, capaCode, platform);
    if (!products.length) {
      return json({ error: 'Nenhum produto cadastrado para esta capa.' }, 404);
    }

    if (products.length === 1) {
      return json({ ok: true, product: productPayload(products[0]) });
    }

    const bytes = new Uint8Array(await image.arrayBuffer());
    const model = env.GEMINI_VERIFIER_MODEL || env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

    const productListDesc = products.map((p, idx) =>
      `Opção [${idx}]: SKU="${p.sku}", Nome="${p.nome || ''}", Variação="${p.variacao || ''}", Miolo="${p.miolo_code}", Acabamento="${p.acabamento_code}"`
    ).join('\n');

    const prompt = `Você é um especialista em conferência de produtos da gráfica NISTI.
Analise a foto de DETALHE/TEXTO/ZOOM enviada pelo operador e identifique a qual das seguintes opções de produtos ela corresponde.
Preste atenção especial em:
1. Textos, anos (ex: 2025, 2026), frases, títulos ou nomes gravados na capa.
2. Tipo de acabamento, cor do wire-o/espiral, elástico ou tassel visíveis.
3. Tipo de pauta ou miolo se visível.

Opções disponíveis:
${productListDesc}

Retorne exclusivamente um JSON no seguinte formato:
{
  "selected_index": 0,
  "confidence": 0.98,
  "evidence": "Texto 2026 identificado no centro da capa"
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: image.type || 'image/jpeg',
                  data: base64(bytes)
                }
              }
            ]
          }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1
          }
        })
      }
    );

    if (!response.ok) {
      return json({ error: 'Falha ao analisar detalhe com IA.' }, 502);
    }

    const payload = await response.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    let parsed = {};
    try { parsed = JSON.parse(text); } catch {}

    const index = Number(parsed.selected_index);
    const selectedProduct = (Number.isInteger(index) && index >= 0 && index < products.length)
      ? products[index]
      : products[0];

    return json({
      ok: true,
      product: productPayload(selectedProduct),
      confidence: Number(parsed.confidence || 0.95),
      evidence: parsed.evidence || null
    });
  } catch (err) {
    return json({ error: err.message || 'Erro ao processar foto de detalhe.' }, 500);
  }
}

export async function autoLearnVisualSample(env, capaCode, imageBytes, mimeType = 'image/jpeg') {
  if (!env?.DB || !env?.PRODUCT_IMAGES || !env?.COVER_VECTORS) return;
  const cleanCode = String(capaCode || '').trim().toUpperCase();
  if (!cleanCode || !imageBytes || imageBytes.length < 500) return;

  try {
    const existing = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM cover_visual_references
      WHERE capa_code=? AND reference_kind='auto_learned' AND active=1
    `).bind(cleanCode).first();

    if (Number(existing?.total || 0) >= 2) return;

    const key = `references/learned/${cleanCode}/${crypto.randomUUID()}.jpg`;
    await env.PRODUCT_IMAGES.put(key, imageBytes, { httpMetadata: { contentType: mimeType } });

    const insertResult = await env.DB.prepare(`
      INSERT INTO cover_visual_references (
        capa_code, image_key, source_product_id, reference_kind, active, created_at, updated_at
      ) VALUES (?, ?, NULL, 'auto_learned', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(cleanCode, key).run();

    const refId = Number(insertResult.meta?.last_row_id);
    if (!refId) return;

    const { model, values } = await embedImage(env, imageBytes, mimeType);

    await env.DB.prepare(`
      INSERT INTO cover_reference_embeddings (
        reference_id, embedding_model, dimensions, embedding_json, updated_at
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(refId, model, values.length, JSON.stringify(values)).run();

    const { results } = await env.DB.prepare(`
      SELECT DISTINCT pp.platform
      FROM products p
      JOIN product_platforms pp ON pp.product_id=p.id
      WHERE UPPER(TRIM(p.capa_code))=?
    `).bind(cleanCode).all();

    const vectors = (results || []).map(row => {
      const namespace = platformNamespace(row.platform);
      return namespace ? {
        id: `learned_${refId}_${cleanCode}`,
        values,
        namespace,
        metadata: {
          reference_id: refId,
          capa_code: cleanCode,
          reference_kind: 'auto_learned',
          image_key: key,
          platform: row.platform,
          updated_at: new Date().toISOString()
        }
      } : null;
    }).filter(Boolean);

    if (vectors.length && env.COVER_VECTORS?.upsert) {
      await env.COVER_VECTORS.upsert(vectors).catch(() => {});
    }
  } catch {}
}
