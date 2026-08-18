import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const MIN_CONFIDENCE = 0.85;
const GEMINI_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_MEDIUM';
const CANDIDATE_CACHE_LIMIT = 32;
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
  const uploadStarted = Date.now();
  const uploadBytes = new Uint8Array(await image.arrayBuffer());
  timings.read_photo_ms = Date.now() - uploadStarted;

  const embeddingStarted = Date.now();
  const embeddingPromise = embedImage(env, uploadBytes, image.type || 'image/jpeg');

  const d1Started = Date.now();
  const indexPromise = env.DB.prepare(`
    SELECT capa_code,image_key,embedding_json
    FROM cover_embeddings
  `).all();

  const [queryEmbedding, indexData] = await Promise.all([embeddingPromise, indexPromise]);
  timings.embedding_ms = Date.now() - embeddingStarted;
  timings.d1_index_ms = Date.now() - d1Started;

  const results = indexData?.results || [];
  if (!results.length) throw new Error('Índice visual vazio. Indexe as imagens das capas antes de identificar.');

  const scoringStarted = Date.now();
  const scored = [];
  for (const row of results) {
    try {
      const vector = JSON.parse(row.embedding_json);
      const score = cosineSimilarity(queryEmbedding, vector);
      if (Number.isFinite(score)) scored.push({
        capa_code: row.capa_code,
        image_key: row.image_key,
        retrieval_score: score
      });
    } catch {}
  }
  scored.sort((a, b) => b.retrieval_score - a.retrieval_score);
  timings.score_ms = Date.now() - scoringStarted;
  timings.index_size = scored.length;
  return { uploadBytes, candidates: scored.slice(0, TOP_K_COVERS) };
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

  const obj = await env.PRODUCT_IMAGES.get(candidate.image_key);
  if (!obj) return null;
  const value = {
    bytes: new Uint8Array(await obj.arrayBuffer()),
    mimeType: obj.httpMetadata?.contentType || 'image/jpeg'
  };
  rememberCandidateImage(candidate.image_key, value);
  return { ...candidate, ...value, cacheHit: false };
}

async function verify(env, image, uploadBytes, candidates, timings) {
  if (!candidates.length) throw new Error('Nenhuma capa candidata encontrada no índice visual');

  const r2Started = Date.now();
  const loaded = await Promise.all(candidates.map(candidate => loadCandidateImage(env, candidate)));
  const usable = loaded.filter(Boolean);
  timings.r2_candidates_ms = Date.now() - r2Started;
  timings.candidate_count = usable.length;
  timings.candidate_cache_hits = usable.filter(item => item.cacheHit).length;
  timings.candidate_bytes = usable.reduce((sum, item) => sum + item.bytes.byteLength, 0);
  if (!usable.length) throw new Error('As imagens candidatas não foram encontradas no R2');

  const parts = [{
    text: 'Você é o verificador visual interno da NISTI PRINT. A FOTO mostra somente a capa do produto, que pode estar solta, sem Wire-O, tassel ou elástico. Compare somente a ARTE-BASE DA CAPA com as CAPAS CANDIDATAS. Ignore nomes personalizados impressos, acabamento, miolo, plataforma e acessórios. Escolha somente um CAPA_CODE da lista se a correspondência visual for forte. Se nenhuma candidata corresponder com segurança, responda matched=false e capa_code="". Os retrieval_score servem apenas como pré-seleção e não substituem sua verificação visual.'
  }];

  for (const candidate of usable) {
    parts.push({
      text: `CAPA CANDIDATA: CAPA_CODE=${candidate.capa_code}; retrieval_score=${candidate.retrieval_score.toFixed(6)}`
    });
    parts.push({
      inline_data: {
        mime_type: candidate.mimeType,
        data: base64(candidate.bytes)
      }
    });
  }
  parts.push({ text: 'FOTO DA CAPA A IDENTIFICAR:' });
  parts.push({
    inline_data: {
      mime_type: image.type || 'image/jpeg',
      data: base64(uploadBytes)
    }
  });

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const geminiStarted = Date.now();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 128,
        media_resolution: GEMINI_MEDIA_RESOLUTION,
        thinkingConfig: {
          thinkingLevel: 'minimal'
        },
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
  timings.gemini_ms = Date.now() - geminiStarted;
  timings.model = model;
  timings.media_resolution = GEMINI_MEDIA_RESOLUTION;
  if (!response.ok) throw new Error(`Gemini falhou (${response.status})`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new Error('Gemini não retornou resultado');

  const result = JSON.parse(text);
  const allowed = new Set(usable.map(candidate => String(candidate.capa_code).trim().toUpperCase()));
  const capaCode = String(result?.capa_code || '').trim().toUpperCase();
  if (result?.matched && (!capaCode || !allowed.has(capaCode))) {
    return { matched: false, capa_code: '', confidence: 0, candidates: usable };
  }
  return { ...result, capa_code: capaCode, candidates: usable };
}

function timingHeader(timings) {
  const entries = [
    ['embedding', timings.embedding_ms],
    ['d1', timings.d1_index_ms],
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
    const ai = await verify(env, image, uploadBytes, candidates, timings);
    if (!ai.matched || !ai.capa_code || Number(ai.confidence) < MIN_CONFIDENCE) {
      timings.total_ms = Date.now() - started;
      return json({
        error: 'Correspondência visual da capa insuficiente. Tire outra foto.',
        performance: timings
      }, 422, { 'server-timing': timingHeader(timings) });
    }

    const capaCode = String(ai.capa_code).trim().toUpperCase();
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
        error: 'A IA identificou uma capa que não existe no banco.',
        performance: timings
      }, 422, { 'server-timing': timingHeader(timings) });
    }

    const selectedCandidate = ai.candidates.find(candidate =>
      String(candidate.capa_code).trim().toUpperCase() === capaCode
    );

    timings.total_ms = Date.now() - started;

    if (results.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: capaCode,
        products: results.map(productPayload),
        confidence: ai.confidence,
        retrieval_score: selectedCandidate?.retrieval_score ?? null,
        identified_by: 'capa_embedding_topk+gemini-parallel+human-sku-selection',
        performance: timings
      }, 200, { 'server-timing': timingHeader(timings) });
    }

    return json({
      product: productPayload(results[0]),
      confidence: ai.confidence,
      retrieval_score: selectedCandidate?.retrieval_score ?? null,
      identified_by: 'capa_embedding_topk+gemini-parallel',
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
