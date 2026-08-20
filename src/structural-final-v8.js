import { parseSku } from './sku.js';
import { normalizePlatform, platformNamespace } from './platform-scope.js';
import { reserveGeminiBudget } from './gemini-budget.js';
import { detectCrossPlatformMatch, embedImage } from './vectorize-candidates.js';
import { recordScanOccurrence } from './occurrences-router.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const MAX_CANDIDATES = 8;
const SUGGESTION_LIMIT = 3;
const MIN_STRUCTURAL_CONFIDENCE = 0.65;
const VERIFY_TIMEOUT_MS = 16000;
const VERIFIER_RPM_LIMIT = 60;

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

  const prompt = `Você é o classificador visual oficial da gráfica NISTI PRINT.
Sua missão é identificar com precisão se a FOTO DO PRODUTO corresponde a uma das CANDIDATAS do catálogo pela ARTE-BASE impressa na capa.

REGRAS DE OURO PARA COMPARAÇÃO PRECISA:
1. HIERARQUIA RIGOROSA DE CORES E SUB-TONS (CLARO vs MÉDIO vs ESCURO):
   - Muitos modelos compartilham o mesmo layout e tipografia, variando apenas na FAMÍLIA DE COR ou no TOM ESPECÍFICO.
   - Analise com MÁXIMA ATENÇÃO a matiz e a profundidade de tom (Luminosidade):
     • VERDES:
       - Verde Claro / Menta / Sage / Oliva Claro (ex: MNV1, VFOS).
       - Verde Médio / Folha / Bandeira.
       - Verde Escuro / Musgo / Militar / Floresta (ex: MNV2, MNV3).
     • AZUIS:
       - Azul Bebê / Celeste / Pastel / Serenity (ex: MNZ1).
       - Azul Médio / Royal / Bic (ex: MNZ2).
       - Azul Escuro / Marinho / Petróleo / Noite (ex: MNZ3).
     • ROSAS, LILÁS E ROXO:
       - Rosa Claro / Bebê / Blush / Nude Rosado (ex: CPA).
       - Rosa Médio / Chiclete / Pink / Magenta.
       - Lilás / Lavanda vs Roxo / Púrpura / Uva.
     • BEGES, TERROSOS E AMARELOS:
       - Bege Claro / Off-White / Marfim / Areia.
       - Caramelo / Terracota / Telha.
       - Marrom / Café / Chocolate.
       - Amarelo Pastel / Manteiga vs Amarelo Ocre / Mostarda.
     • NEUTROS, CINZAS E PRETOS:
       - Branco / Cinza Claro / Prata (ex: MNCZ1).
       - Cinza Chumbo / Grafite (ex: MNCZ2).
       - Preto Absoluto / Fundo Escuro (ex: BKF, CQF2).
   - REGRA DE ELIMINAÇÃO TONAL: Se a foto tiver tom CLARO/PASTEL, NUNCA escolha o modelo ESCURO da mesma cor, e vice-versa! O tom e a saturação da cor são critérios eliminatórios.

2. ESTRUTURA CENTRAL, MONOGRAMAS E OCR DE LETRAS:
   - Se a capa tiver uma letra inicial/monograma maiúsculo em destaque (ex: letra "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"):
     • IDENTIFIQUE a letra central exata e valide que a candidata possui EXATAMENTE A MESMA LETRA e o mesmo estilo gráfico de monograma!
     • Se a foto tem a letra "M" em fundo Verde Claro, escolha EXCLUSIVAMENTE a candidata com letra "M" em fundo Verde Claro!
   - O nome pequeno cursivo do cliente pode variar (ex: "Maria", "Mavie", "Manuela"), mas a LETRA DO MONOGRAMA e a COR DO FUNDO definem o modelo exato.
3. FOCO NA ARTE GRÁFICA & ELEMENTOS-CHAVE:
   - Compare o design gráfico: ilustrações, desenhos, flores, animais/personagens, padrões geométricos, listras, blocos de cor, molduras e cores dominantes.
   - Textos fixos e títulos do produto são elementos-chave quando presentes.
4. NOMES PERSONALIZADOS DO CLIENTE:
   - Produtos de papelaria recebem nomes personalizados variáveis de clientes (ex: "Otávio", "Théo", "Eloá", "Mavie", "Helena", "Arthur", "Maria", datas, etc.).
   - A imagem de referência no catálogo pode estar sem nome próprio ou ter um nome fictício de exemplo diferente.
   - IGNORE a diferença do nome cursivo pequeno do cliente, contanto que o layout geral da arte, cores e monogramas correspondam!
5. ITENS FÍSICOS, PERSPECTIVA E ILUMINAÇÃO (TOLERÂNCIA AMPLA):
   - Wire-o / espirais / encadernação lateral (qualquer cor) e espessura lateral das folhas.
   - Elásticos, passadores de elástico, tassel / pingentes.
   - ÂNGULO E PERSPECTIVA 3D (CENÁRIO C): A foto pode ter sido tirada inclinada (a 30°-60°), com distorção trapezoidal de perspectiva. Desconsidere a deformação geométrica e foque nos elementos gráficos da estampa da capa.
   - POUCA LUZ / PENUMBRA (CENÁRIO H): Se a foto estiver escura, com sombras ou granulado de câmera em baixa luminosidade, compense a subexposição e compare as formas, contrastes e ilustrações da capa.
   - Laminação plástica, holografia, glitter, reflexos de luz, sombras e brilhos na foto.
   - Dedos/mãos do operador segurando, mesa e fundo externo da bancada.
6. RESULTADO:
   - Se uma das candidatas for exatamente a mesma arte, cor e modelo da foto, retorne winner_code com o CAPA_CODE dessa candidata, exact_match=true e confidence entre 0.70 e 1.00.
   - Se nenhuma candidata tiver a mesma arte gráfica e cor correspondente, retorne winner_code="NONE", exact_match=false e confidence baixa.`;

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
    const labels = candidate.catalog_labels?.length
      ? candidate.catalog_labels.join(' | ')
      : 'sem descrição adicional';
    parts.push({
      text: `CANDIDATA CAPA_CODE=${candidate.capa_code}; CADASTRO=${labels}`
    });
    parts.push({
      inline_data: {
        mime_type: candidate.mime_type,
        data: base64(candidate.bytes)
      }
    });
  }

  const candidateModels = [
    env.GEMINI_VERIFIER_MODEL,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ].filter(Boolean);
  const models = [...new Set(candidateModels)];

  let lastError = null;
  try {
    for (const model of models) {
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
          lastError = new RecognitionError(
            detail
              ? `Gemini comparador (${model}) falhou (${response.status}): ${detail}`
              : `Gemini comparador (${model}) falhou (${response.status})`,
            [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502,
            `catalog_comparator_http_${response.status}`
          );
          continue;
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
        lastError = err;
      }
    }

    throw lastError || new RecognitionError('Falha ao comparar com IA.', 503, 'comparator_failed');
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
      products: products.map(product => productPayload(product))
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
    pipeline_version: 'platform-vectorize+comparative-six-v8.7',
    verification_mode: 'single-call-multi-candidate-exact-art',
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
        decision.winner_code &&
        decision.winner_code !== 'NONE' &&
        (decision.exact_match || decision.confidence >= MIN_STRUCTURAL_CONFIDENCE)
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

      // Fallback de ultra-alta confiança: apenas se o vetor tem score >= 0.94 (para não confundir monogramas parecidos)
      if (loaded.length && Number(loaded[0].retrieval_score || 0) >= 0.94) {
        const topWinner = loaded[0];
        performance.accepted_by = 'vector-ultra-high-confidence-fallback-on-comparator-timeout';
        performance.suggestion_count = 0;
        finalizePerformance(performance, started);
        return successResponse(
          env,
          topWinner,
          platform,
          Number(topWinner.retrieval_score || 0.94),
          performance,
          'platform-catalog-vector-high-confidence-fallback'
        );
      }
    }

    let crossMatch = null;
    try {
      const embedding = await embedImage(env, photoBytes, image.type || 'image/jpeg');
      crossMatch = await detectCrossPlatformMatch(env, embedding.values, platform);
    } catch {}

    performance.accepted_by = comparatorError
      ? `comparator-unavailable:${performance.comparator_error}`
      : (crossMatch ? 'comparative-cross-platform-match' : 'comparative-no-exact-winner');
    performance.suggestion_count = 0;
    finalizePerformance(performance, started);

    if (crossMatch) {
      return json({
        error: `Este produto não está cadastrado na plataforma ${platform}. Encontramos correspondência no catálogo da plataforma ${crossMatch.found_platform}.`,
        confidence: 0,
        platform,
        suggested_platform: crossMatch.found_platform,
        suggestions: [],
        suggestions_are_unconfirmed: false,
        identified_by: 'platform-catalog-cross-match-v8.7',
        performance
      }, 422);
    }

    // Registra ocorrência de falha no D1/R2 para aprendizado no Painel ADM
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
        confidence: comparison?.decision?.confidence || 0,
        errorReason: 'no_match',
        operatorName,
        operatorId
      });
    } catch {}

    return json({
      error: `Produto não cadastrado na plataforma ${platform}. Verifique se a plataforma correta foi selecionada ou se a capa está cadastrada no catálogo.`,
      confidence: comparison?.decision?.confidence || 0,
      platform,
      suggested_platform: null,
      suggestions: [],
      suggestions_are_unconfirmed: false,
      identified_by: 'platform-catalog-no-match-v8.7',
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
