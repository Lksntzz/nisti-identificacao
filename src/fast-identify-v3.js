import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const CANDIDATE_CACHE_LIMIT = 40;
const MIN_FINAL_CONFIDENCE = 0.97;
const DEFAULT_BUDGET_MS = 4100;
const candidateImageCache = new Map();

class RecognitionError extends Error {
  constructor(message, status = 400, code = 'recognition_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
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

function cleanReason(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 320);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = Number(a[i]);
    const bv = Number(b[i]);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return -1;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (!magA || !magB) return -1;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function remainingMs(deadlineAt) {
  return Math.max(0, Number(deadlineAt || 0) - Date.now());
}

async function fetchBeforeDeadline(url, options, deadlineAt, label) {
  const remaining = remainingMs(deadlineAt);
  if (remaining < 150) {
    throw new RecognitionError('Não consegui confirmar a capa dentro do limite de 5 segundos. Tente novamente.', 503, 'recognition_deadline_exceeded');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('deadline'), remaining);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new RecognitionError('Não consegui confirmar a capa dentro do limite de 5 segundos. Tente novamente.', 503, 'recognition_deadline_exceeded');
    }
    throw new RecognitionError(`${label} indisponível: ${error?.message || 'falha de rede'}`, 503, 'upstream_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

async function embedImage(env, bytes, mimeType, deadlineAt) {
  if (!env.GEMINI_API_KEY) throw new RecognitionError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const response = await fetchBeforeDeadline(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        content: {
          parts: [{
            inline_data: {
              mime_type: mimeType || 'image/jpeg',
              data: base64(bytes)
            }
          }]
        },
        output_dimensionality: EMBEDDING_DIMENSIONS
      })
    },
    deadlineAt,
    'Gemini Embedding'
  );

  if (!response.ok) {
    const status = [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502;
    throw new RecognitionError(`Gemini Embedding falhou (${response.status})`, status, 'embedding_failed');
  }
  const payload = await response.json();
  const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || !values.length) {
    throw new RecognitionError('Gemini Embedding não retornou vetor', 502, 'embedding_empty');
  }
  return values;
}

async function getCandidates(env, image, timings, deadlineAt) {
  const readStarted = Date.now();
  const uploadBytes = new Uint8Array(await image.arrayBuffer());
  timings.read_photo_ms = Date.now() - readStarted;

  const parallelStarted = Date.now();
  const embeddingPromise = embedImage(env, uploadBytes, image.type || 'image/jpeg', deadlineAt);
  const indexPromise = env.DB.prepare(`
    SELECT capa_code,image_key,embedding_json
    FROM cover_embeddings
  `).all();

  const [queryEmbedding, indexData] = await Promise.all([embeddingPromise, indexPromise]);
  timings.embedding_and_index_ms = Date.now() - parallelStarted;

  const rows = indexData?.results || [];
  if (!rows.length) throw new RecognitionError('Índice visual vazio. Indexe as imagens das capas antes de identificar.', 503, 'visual_index_empty');

  const scoringStarted = Date.now();
  const scored = [];
  for (const row of rows) {
    try {
      const vector = JSON.parse(row.embedding_json);
      const score = cosineSimilarity(queryEmbedding, vector);
      if (Number.isFinite(score)) {
        scored.push({
          capa_code: String(row.capa_code || '').trim().toUpperCase(),
          image_key: row.image_key,
          retrieval_score: score
        });
      }
    } catch {}
  }
  scored.sort((a, b) => b.retrieval_score - a.retrieval_score);

  // Uma capa pode ter mais de um registro. Mantemos só a melhor referência de cada CAPA_CODE,
  // aumentando a diversidade do Top-K sem aumentar o número de imagens enviado ao Gemini.
  const seen = new Set();
  const candidates = [];
  for (const candidate of scored) {
    if (!candidate.capa_code || seen.has(candidate.capa_code)) continue;
    seen.add(candidate.capa_code);
    candidates.push({ ...candidate, retrieval_rank: candidates.length + 1 });
    if (candidates.length >= TOP_K_COVERS) break;
  }

  timings.score_ms = Date.now() - scoringStarted;
  timings.index_size = scored.length;
  timings.distinct_candidates = candidates.length;
  timings.retrieval_top1 = candidates[0]?.retrieval_score ?? null;
  timings.retrieval_top1_code = candidates[0]?.capa_code || null;
  timings.retrieval_top2 = candidates[1]?.retrieval_score ?? null;
  timings.retrieval_top2_code = candidates[1]?.capa_code || null;
  timings.retrieval_margin = Number.isFinite(timings.retrieval_top1) && Number.isFinite(timings.retrieval_top2)
    ? timings.retrieval_top1 - timings.retrieval_top2
    : 1;

  return { uploadBytes, candidates };
}

function rememberCandidateImage(imageKey, value) {
  if (!imageKey || !value) return;
  if (candidateImageCache.has(imageKey)) candidateImageCache.delete(imageKey);
  candidateImageCache.set(imageKey, value);
  while (candidateImageCache.size > CANDIDATE_CACHE_LIMIT) {
    const oldestKey = candidateImageCache.keys().next().value;
    candidateImageCache.delete(oldestKey);
  }
}

async function loadCandidateImage(env, candidate) {
  const cached = candidateImageCache.get(candidate.image_key);
  if (cached) {
    candidateImageCache.delete(candidate.image_key);
    candidateImageCache.set(candidate.image_key, cached);
    return { ...candidate, ...cached, cacheHit: true };
  }

  const object = await env.PRODUCT_IMAGES.get(candidate.image_key);
  if (!object) return null;
  const value = {
    bytes: new Uint8Array(await object.arrayBuffer()),
    mimeType: object.httpMetadata?.contentType || 'image/jpeg'
  };
  rememberCandidateImage(candidate.image_key, value);
  return { ...candidate, ...value, cacheHit: false };
}

async function loadCandidates(env, candidates, timings, deadlineAt) {
  if (remainingMs(deadlineAt) < 700) {
    throw new RecognitionError('Não consegui confirmar a capa dentro do limite de 5 segundos. Tente novamente.', 503, 'recognition_deadline_exceeded');
  }
  const started = Date.now();
  const loaded = await Promise.all(candidates.map(candidate => loadCandidateImage(env, candidate)));
  const usable = loaded.filter(Boolean);
  timings.r2_candidates_ms = Date.now() - started;
  timings.candidate_count = usable.length;
  timings.candidate_cache_hits = usable.filter(item => item.cacheHit).length;
  timings.candidate_bytes = usable.reduce((sum, item) => sum + item.bytes.byteLength, 0);

  if (!usable.length) throw new RecognitionError('As imagens candidatas não foram encontradas no R2', 503, 'candidate_images_missing');
  return usable;
}

function buildParts(image, uploadBytes, usable) {
  const parts = [{
    text: `Você é o verificador visual de produção da NISTI PRINT. Compare a FOTO com as REFERÊNCIAS e identifique uma capa SOMENTE quando existir correspondência inequívoca da MESMA ARTE-BASE.

Não escolha a "mais parecida". Se nenhuma referência for exatamente a mesma arte-base, responda matched=false.

IGNORE apenas: nome/texto personalizado, iniciais, datas, Wire-O/espiral, tassel, elástico, mão, mesa, brilho, reflexo, iluminação, perspectiva e pequenos cortes da foto.

NÃO use apenas tema, paleta ou estilo. Flores, borboletas, ursinhos, estrelas, tons rosa/azul e a mesma categoria de produto NÃO provam identidade.

Para a candidata escolhida, avalie obrigatoriamente quatro critérios:
- background_structure: fundo, grandes blocos, molduras e áreas centrais são estruturalmente os mesmos;
- layout_structure: os principais elementos ocupam posições equivalentes;
- decorative_structure: ilustrações, flores, folhas, borboletas, personagens e objetos principais são os mesmos e estão distribuídos de forma equivalente;
- signature_elements: os elementos distintivos da arte coincidem e não há elemento grande presente em uma imagem e ausente na outra.

matched=true somente se TODOS os quatro critérios forem true. Na menor dúvida, matched=false. Nunca invente CAPA_CODE.`
  }];

  parts.push({ text: 'FOTO A IDENTIFICAR:' });
  parts.push({
    inline_data: {
      mime_type: image.type || 'image/jpeg',
      data: base64(uploadBytes)
    }
  });

  for (const candidate of usable) {
    parts.push({
      text: `REFERÊNCIA ${candidate.retrieval_rank}: CAPA_CODE=${candidate.capa_code}; score_embedding=${candidate.retrieval_score.toFixed(6)}`
    });
    parts.push({
      inline_data: {
        mime_type: candidate.mimeType,
        data: base64(candidate.bytes)
      }
    });
  }

  return parts;
}

async function verifyWithGemini(env, image, uploadBytes, candidates, timings, deadlineAt) {
  const usable = await loadCandidates(env, candidates, timings, deadlineAt);
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const started = Date.now();

  const response = await fetchBeforeDeadline(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: buildParts(image, uploadBytes, usable) }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 160,
          media_resolution: 'MEDIA_RESOLUTION_MEDIUM',
          thinkingConfig: { thinkingLevel: 'minimal' },
          response_mime_type: 'application/json',
          response_schema: {
            type: 'OBJECT',
            properties: {
              matched: { type: 'BOOLEAN' },
              capa_code: { type: 'STRING' },
              background_structure: { type: 'BOOLEAN' },
              layout_structure: { type: 'BOOLEAN' },
              decorative_structure: { type: 'BOOLEAN' },
              signature_elements: { type: 'BOOLEAN' },
              confidence: { type: 'NUMBER' },
              reason: { type: 'STRING' }
            },
            required: [
              'matched',
              'capa_code',
              'background_structure',
              'layout_structure',
              'decorative_structure',
              'signature_elements',
              'confidence',
              'reason'
            ]
          }
        }
      })
    },
    deadlineAt,
    'Gemini'
  );

  timings.gemini_ms = Date.now() - started;
  timings.model = model;
  timings.media_resolution = 'MEDIA_RESOLUTION_MEDIUM';
  timings.verification_mode = `gemini-structural-single-pass-${usable.length}`;

  if (!response.ok) {
    const status = [429, 500, 502, 503, 504].includes(response.status) ? 503 : 502;
    throw new RecognitionError(`Gemini falhou (${response.status})`, status, 'gemini_failed');
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new RecognitionError('Gemini não retornou resultado', 502, 'gemini_empty');

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new RecognitionError('Gemini retornou resposta inválida', 502, 'gemini_invalid_json');
  }

  const allowed = new Set(usable.map(candidate => candidate.capa_code));
  const capaCode = String(result?.capa_code || '').trim().toUpperCase();
  const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  const checks = {
    background_structure: result?.background_structure === true,
    layout_structure: result?.layout_structure === true,
    decorative_structure: result?.decorative_structure === true,
    signature_elements: result?.signature_elements === true
  };
  const structuralPass = Object.values(checks).every(Boolean);
  const accepted = result?.matched === true && allowed.has(capaCode) && structuralPass && confidence >= MIN_FINAL_CONFIDENCE;

  timings.gemini_confidence = confidence;
  timings.gemini_matched = Boolean(result?.matched);
  timings.gemini_proposed_capa_code = capaCode || null;
  timings.gemini_reason = cleanReason(result?.reason);
  timings.structural_checks = checks;
  timings.accepted_by = accepted ? 'single-pass-structural-guard' : 'rejected-by-structural-guard';
  timings.minimum_confidence = MIN_FINAL_CONFIDENCE;

  return {
    matched: accepted,
    capa_code: accepted ? capaCode : '',
    confidence,
    candidates: usable,
    reason: timings.gemini_reason
  };
}

function timingHeader(timings) {
  const entries = [
    ['embedding_index', timings.embedding_and_index_ms],
    ['score', timings.score_ms],
    ['r2', timings.r2_candidates_ms],
    ['gemini', timings.gemini_ms],
    ['database', timings.database_ms],
    ['total', timings.total_ms]
  ];
  return entries
    .filter(([, value]) => Number.isFinite(value))
    .map(([name, value]) => `${name};dur=${value}`)
    .join(', ');
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    image_url: product.image_key ? `/api/images/${product.id}` : null
  };
}

export async function fastIdentify(request, env, options = {}) {
  const started = Date.now();
  const deadlineAt = Number(options.deadlineAt) || (started + DEFAULT_BUDGET_MS);
  const timings = {
    recognition_budget_ms: Math.max(0, deadlineAt - started),
    pipeline_version: 'single-pass-v1'
  };

  try {
    const formStarted = Date.now();
    const form = await request.formData();
    timings.formdata_ms = Date.now() - formStarted;
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);
    timings.upload_bytes = image.size;

    const { uploadBytes, candidates } = await getCandidates(env, image, timings, deadlineAt);
    if (!candidates.length) throw new RecognitionError('Nenhuma capa candidata encontrada no índice visual', 422, 'no_candidates');

    const ai = await verifyWithGemini(env, image, uploadBytes, candidates, timings, deadlineAt);

    if (!ai.matched || !ai.capa_code) {
      timings.total_ms = Date.now() - started;
      return json({
        error: 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: ai.confidence,
        performance: timings
      }, 422, { 'server-timing': timingHeader(timings) });
    }

    const capaCode = ai.capa_code;
    const databaseStarted = Date.now();
    const { results } = await env.DB.prepare(`
      SELECT p.*,
        (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
        (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
      FROM products p
      WHERE p.capa_code=?
      ORDER BY p.id ASC
    `).bind(capaCode).all();
    timings.database_ms = Date.now() - databaseStarted;

    if (!results?.length) {
      timings.total_ms = Date.now() - started;
      return json({
        error: 'A capa foi reconhecida, mas não existe produto correspondente no banco.',
        capa_code: capaCode,
        confidence: ai.confidence,
        performance: timings
      }, 422, { 'server-timing': timingHeader(timings) });
    }

    const selectedCandidate = ai.candidates.find(candidate => candidate.capa_code === capaCode);
    timings.total_ms = Date.now() - started;
    const identifiedBy = 'capa_embedding+gemini-structural-single-pass';

    if (results.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: capaCode,
        products: results.map(productPayload),
        confidence: ai.confidence,
        retrieval_score: selectedCandidate?.retrieval_score ?? null,
        identified_by: `${identifiedBy}+human-sku-selection`,
        performance: timings
      }, 200, { 'server-timing': timingHeader(timings) });
    }

    return json({
      product: productPayload(results[0]),
      confidence: ai.confidence,
      retrieval_score: selectedCandidate?.retrieval_score ?? null,
      identified_by: identifiedBy,
      performance: timings
    }, 200, { 'server-timing': timingHeader(timings) });
  } catch (error) {
    timings.total_ms = Date.now() - started;
    const status = Number(error?.status) || 400;
    return json({
      error: error?.message || 'Erro interno',
      technical_error: error?.code || null,
      performance: timings
    }, status, { 'server-timing': timingHeader(timings) });
  }
}
