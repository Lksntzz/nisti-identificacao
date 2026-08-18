import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const FOCUSED_CANDIDATES = 4;

// Precisão em produção: o embedding ranqueia candidatos, mas não encerra a identificação sozinho.
const ALLOW_DIRECT_EMBEDDING = false;
const DIRECT_MIN_SCORE = 0.90;
const DIRECT_MIN_MARGIN = 0.045;

// No fallback, a confiança do modelo é combinada com a concordância do Embedding.
const MODEL_MIN_CONFIDENCE = 0.86;
const AGREEMENT_MIN_CONFIDENCE = 0.75;
const AGREEMENT_MIN_SCORE = 0.82;
const AGREEMENT_MIN_MARGIN = 0.015;

// Margem pequena indica capas visualmente parecidas; nesses casos enviamos as 8 candidatas ao verificador.
const FOCUSED_MIN_SCORE = 0.80;
const FOCUSED_MIN_MARGIN = 0.025;
const CANDIDATE_CACHE_LIMIT = 40;
const candidateImageCache = new Map();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
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

async function embedImage(env, bytes, mimeType) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
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
  });

  if (!response.ok) throw new Error(`Gemini Embedding falhou (${response.status})`);
  const payload = await response.json();
  const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || !values.length) throw new Error('Gemini Embedding não retornou vetor');
  return values;
}

async function getCandidates(env, image, timings) {
  const readStarted = Date.now();
  const uploadBytes = new Uint8Array(await image.arrayBuffer());
  timings.read_photo_ms = Date.now() - readStarted;

  const parallelStarted = Date.now();
  const embeddingPromise = embedImage(env, uploadBytes, image.type || 'image/jpeg');
  const indexPromise = env.DB.prepare(`
    SELECT capa_code,image_key,embedding_json
    FROM cover_embeddings
  `).all();

  const [queryEmbedding, indexData] = await Promise.all([embeddingPromise, indexPromise]);
  timings.embedding_and_index_ms = Date.now() - parallelStarted;

  const rows = indexData?.results || [];
  if (!rows.length) throw new Error('Índice visual vazio. Indexe as imagens das capas antes de identificar.');

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
  timings.score_ms = Date.now() - scoringStarted;
  timings.index_size = scored.length;

  const candidates = scored.slice(0, TOP_K_COVERS).map((candidate, index) => ({
    ...candidate,
    retrieval_rank: index + 1
  }));

  const top1 = candidates[0]?.retrieval_score ?? null;
  const top2 = candidates[1]?.retrieval_score ?? null;
  timings.retrieval_top1 = top1;
  timings.retrieval_top2 = top2;
  timings.retrieval_margin = Number.isFinite(top1) && Number.isFinite(top2) ? top1 - top2 : 1;

  return { uploadBytes, candidates };
}

function tryDirectEmbedding(candidates, timings) {
  const top = candidates[0];
  const margin = Number(timings.retrieval_margin);
  if (!top?.capa_code || !Number.isFinite(top.retrieval_score) || !Number.isFinite(margin)) return null;

  const eligible = top.retrieval_score >= DIRECT_MIN_SCORE && margin >= DIRECT_MIN_MARGIN;
  timings.embedding_direct_eligible = eligible;
  timings.direct_score_threshold = DIRECT_MIN_SCORE;
  timings.direct_margin_threshold = DIRECT_MIN_MARGIN;

  if (!eligible) return null;

  timings.verification_mode = 'embedding-direct';
  return {
    matched: true,
    capa_code: top.capa_code,
    confidence: Math.min(0.999, Math.max(0.90, top.retrieval_score)),
    candidates
  };
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

async function loadCandidates(env, candidates, timings) {
  const topScore = Number(timings.retrieval_top1);
  const margin = Number(timings.retrieval_margin);
  const focused = Number.isFinite(topScore) && topScore >= FOCUSED_MIN_SCORE &&
    Number.isFinite(margin) && margin >= FOCUSED_MIN_MARGIN;
  const selected = focused ? candidates.slice(0, FOCUSED_CANDIDATES) : candidates;

  timings.gemini_candidate_mode = focused ? 'focused-4' : 'full-8';
  const started = Date.now();
  const loaded = await Promise.all(selected.map(candidate => loadCandidateImage(env, candidate)));
  const usable = loaded.filter(Boolean);
  timings.r2_candidates_ms = Date.now() - started;
  timings.candidate_count = usable.length;
  timings.candidate_cache_hits = usable.filter(item => item.cacheHit).length;
  timings.candidate_bytes = usable.reduce((sum, item) => sum + item.bytes.byteLength, 0);

  if (!usable.length) throw new Error('As imagens candidatas não foram encontradas no R2');
  return usable;
}

function buildParts(image, uploadBytes, usable) {
  const parts = [{
    text: `Você é o verificador visual interno da NISTI PRINT. Sua tarefa é identificar a ARTE-BASE exata da capa fotografada comparando-a SOMENTE com as candidatas fornecidas.

REGRAS IMPORTANTES:
- Isto NÃO é uma tarefa de OCR. Nomes, palavras, iniciais, datas e qualquer texto personalizado podem ser completamente diferentes entre a foto e a referência. NÃO use texto diferente como motivo para rejeitar uma capa.
- Ignore Wire-O, espiral, furos, tassel, elástico, miolo, acabamento, plataforma, mãos, mesa, piso, sombra, reflexo, brilho, perspectiva, corte e iluminação.
- Uma candidata pode ser um mockup de marketplace e a foto pode ser a capa física real.
- Mesmo tema, mesma paleta, flores, borboletas, elementos delicados ou estilo parecido NÃO significam que seja a mesma capa.
- Exija correspondência estrutural da arte: mesmos elementos decorativos principais, mesmas ilustrações e posição relativa essencialmente igual.
- Compare especialmente molduras, quantidade e posição de flores/folhagens/borboletas, personagens, objetos, formas geométricas, brasões, padrões de fundo e distribuição dos elementos.
- Se a composição principal for diferente, retorne matched=false mesmo que as duas capas sejam visualmente parecidas.
- Se uma candidata tiver claramente a mesma arte-base, retorne matched=true e o CAPA_CODE dela, mesmo que o nome/texto personalizado seja diferente.
- Na dúvida entre duas candidatas, prefira matched=false em vez de adivinhar.
- Nunca invente CAPA_CODE e nunca escolha um código fora da lista.`
  }];

  parts.push({ text: 'FOTO DA CAPA A IDENTIFICAR:' });
  parts.push({
    inline_data: {
      mime_type: image.type || 'image/jpeg',
      data: base64(uploadBytes)
    }
  });

  for (const candidate of usable) {
    parts.push({
      text: `CANDIDATA ${candidate.retrieval_rank}: CAPA_CODE=${candidate.capa_code}; retrieval_score=${candidate.retrieval_score.toFixed(6)}`
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

async function verifyWithGemini(env, image, uploadBytes, candidates, timings) {
  const usable = await loadCandidates(env, candidates, timings);
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const started = Date.now();

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: buildParts(image, uploadBytes, usable) }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 80,
        media_resolution: 'MEDIA_RESOLUTION_MEDIUM',
        thinkingConfig: { thinkingLevel: 'minimal' },
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            matched: { type: 'BOOLEAN' },
            capa_code: { type: 'STRING' },
            confidence: { type: 'NUMBER' }
          },
          required: ['matched', 'capa_code', 'confidence']
        }
      }
    })
  });

  timings.gemini_ms = Date.now() - started;
  timings.model = model;
  timings.media_resolution = 'MEDIA_RESOLUTION_MEDIUM';
  timings.verification_mode = `gemini-medium-${usable.length}`;

  if (!response.ok) throw new Error(`Gemini falhou (${response.status})`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new Error('Gemini não retornou resultado');

  const result = JSON.parse(text);
  const allowed = new Set(usable.map(candidate => candidate.capa_code));
  const capaCode = String(result?.capa_code || '').trim().toUpperCase();
  const modelConfidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  timings.gemini_confidence = modelConfidence;

  if (!result?.matched || !capaCode || !allowed.has(capaCode)) {
    return { matched: false, capa_code: '', confidence: modelConfidence, candidates: usable };
  }

  const selected = usable.find(candidate => candidate.capa_code === capaCode);
  const isTop1 = selected?.retrieval_rank === 1;
  const margin = Number(timings.retrieval_margin);
  const embeddingAgreement = Boolean(
    isTop1 &&
    Number(selected?.retrieval_score) >= AGREEMENT_MIN_SCORE &&
    Number.isFinite(margin) && margin >= AGREEMENT_MIN_MARGIN &&
    modelConfidence >= AGREEMENT_MIN_CONFIDENCE
  );
  const modelStrong = modelConfidence >= MODEL_MIN_CONFIDENCE;

  timings.accepted_by = modelStrong ? 'gemini-confidence' : embeddingAgreement ? 'gemini+embedding-agreement' : 'insufficient';

  if (!modelStrong && !embeddingAgreement) {
    return { matched: false, capa_code: '', confidence: modelConfidence, candidates: usable };
  }

  return { matched: true, capa_code: capaCode, confidence: modelConfidence, candidates: usable };
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

export async function fastIdentify(request, env) {
  const started = Date.now();
  const timings = {};

  try {
    const formStarted = Date.now();
    const form = await request.formData();
    timings.formdata_ms = Date.now() - formStarted;
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);
    timings.upload_bytes = image.size;

    const { uploadBytes, candidates } = await getCandidates(env, image, timings);
    if (!candidates.length) throw new Error('Nenhuma capa candidata encontrada no índice visual');

    const direct = ALLOW_DIRECT_EMBEDDING ? tryDirectEmbedding(candidates, timings) : null;
    if (!ALLOW_DIRECT_EMBEDDING) timings.embedding_direct_disabled = true;
    const ai = direct || await verifyWithGemini(env, image, uploadBytes, candidates, timings);

    if (!ai.matched || !ai.capa_code) {
      timings.total_ms = Date.now() - started;
      return json({
        error: 'Não encontrei uma correspondência segura para esta capa. Tente fotografar novamente de frente.',
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
        performance: timings
      }, 422, { 'server-timing': timingHeader(timings) });
    }

    const selectedCandidate = ai.candidates.find(candidate => candidate.capa_code === capaCode);
    timings.total_ms = Date.now() - started;

    const identifiedBy = timings.verification_mode === 'embedding-direct'
      ? 'capa_embedding-direct'
      : `capa_embedding+${timings.verification_mode}`;

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
    return json({
      error: error?.message || 'Erro interno',
      performance: timings
    }, 400, { 'server-timing': timingHeader(timings) });
  }
}
