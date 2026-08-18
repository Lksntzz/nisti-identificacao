import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const VECTOR_TOP_K = 8;
const COVER_LIMIT = 5;
const MIN_FINAL_CONFIDENCE = 0.97;
const TOTAL_BUDGET_MS = 18_000;

class FallbackError extends Error {
  constructor(message, status = 400, code = 'fallback_error') {
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

function remainingMs(deadlineAt) {
  return Math.max(0, deadlineAt - Date.now());
}

async function fetchBeforeDeadline(url, options, deadlineAt, label) {
  const remaining = remainingMs(deadlineAt);
  if (remaining < 250) throw new FallbackError(`${label} excedeu o tempo disponível.`, 503, 'fallback_timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('deadline'), remaining);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new FallbackError(`${label} excedeu o tempo disponível.`, 503, 'fallback_timeout');
    }
    throw new FallbackError(`${label} indisponível: ${error?.message || 'falha de rede'}`, 503, 'upstream_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

async function embedImage(env, bytes, mimeType, deadlineAt) {
  if (!env.GEMINI_API_KEY) throw new FallbackError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
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
          parts: [{ inline_data: { mime_type: mimeType || 'image/jpeg', data: base64(bytes) } }]
        },
        output_dimensionality: EMBEDDING_DIMENSIONS
      })
    },
    deadlineAt,
    'Gemini Embedding'
  );
  if (!response.ok) throw new FallbackError(`Gemini Embedding falhou (${response.status})`, 503, 'embedding_failed');
  const payload = await response.json();
  const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new FallbackError('Gemini Embedding não retornou vetor válido.', 502, 'embedding_empty');
  }
  return values;
}

function codeFromVectorMatch(match) {
  const metadataCode = String(match?.metadata?.capa_code || '').trim().toUpperCase();
  if (metadataCode) return metadataCode;
  const id = String(match?.id || '');
  return id.startsWith('cover:') ? id.slice(6).trim().toUpperCase() : '';
}

async function vectorCandidates(env, vector) {
  if (!env.COVER_VECTORS?.query) throw new FallbackError('Vectorize não configurado.', 503, 'vectorize_not_configured');
  const result = await env.COVER_VECTORS.query(vector, {
    topK: VECTOR_TOP_K,
    returnValues: false,
    returnMetadata: 'all'
  });
  const seen = new Set();
  const covers = [];
  for (const match of result?.matches || []) {
    const capaCode = codeFromVectorMatch(match);
    if (!capaCode || seen.has(capaCode)) continue;
    seen.add(capaCode);
    covers.push({
      capa_code: capaCode,
      retrieval_rank: covers.length + 1,
      retrieval_score: Number(match?.score || 0)
    });
    if (covers.length >= COVER_LIMIT) break;
  }
  if (!covers.length) throw new FallbackError('Vectorize não encontrou capas candidatas.', 422, 'no_candidates');
  return covers;
}

async function loadReferences(env, covers) {
  const codes = covers.map(item => item.capa_code);
  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,sku,capa_code,image_key
    FROM products
    WHERE capa_code IN (${placeholders}) AND image_key IS NOT NULL
    ORDER BY id DESC
  `).bind(...codes).all();

  const coverByCode = new Map(covers.map(item => [item.capa_code, item]));
  const firstByCode = new Map();
  for (const row of results || []) {
    const code = String(row.capa_code || '').trim().toUpperCase();
    if (!coverByCode.has(code) || firstByCode.has(code)) continue;
    firstByCode.set(code, row);
  }

  const references = [];
  for (const cover of covers) {
    const product = firstByCode.get(cover.capa_code);
    if (!product?.image_key) continue;
    const object = await env.PRODUCT_IMAGES.get(product.image_key);
    if (!object) continue;
    references.push({
      ...cover,
      product_id: Number(product.id),
      sku: product.sku,
      image_key: product.image_key,
      bytes: new Uint8Array(await object.arrayBuffer()),
      mimeType: object.httpMetadata?.contentType || 'image/jpeg'
    });
  }
  if (!references.length) throw new FallbackError('As referências visuais não estão disponíveis.', 503, 'reference_images_missing');
  return references;
}

function structuredText(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim();
  return { text, finishReason: String(candidate?.finishReason || '') };
}

function parseStructuredJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty');
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {}
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(withoutFence.slice(first, last + 1));
  throw new Error('invalid_json');
}

function buildParts(imageBytes, mimeType, references) {
  const parts = [{
    text: `Você é o verificador visual final da NISTI PRINT. Compare a FOTO somente com as REFERÊNCIAS enviadas e identifique a MESMA ARTE-BASE.

IGNORE nome personalizado, inicial/letra personalizada, datas, Wire-O/espiral, tassel, elástico, brilho, reflexo, mesa, mão, perspectiva, corte e iluminação.

NÃO escolha apenas pela cor. Para matched=true, a arte-base deve coincidir de forma inequívoca nos elementos permanentes: fundo, molduras/faixas, distribuição visual, elementos decorativos e assinatura gráfica. Se houver dúvida, matched=false.

A resposta deve obedecer ao JSON solicitado e não deve conter Markdown.`
  }, {
    text: 'FOTO A IDENTIFICAR:'
  }, {
    inline_data: {
      mime_type: mimeType || 'image/jpeg',
      data: base64(imageBytes)
    }
  }];

  for (const ref of references) {
    parts.push({
      text: `REFERÊNCIA ${ref.retrieval_rank}: CAPA_CODE=${ref.capa_code}; score_vectorize=${ref.retrieval_score.toFixed(6)}`
    });
    parts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: base64(ref.bytes)
      }
    });
  }
  return parts;
}

async function verifyWithGemini(env, imageBytes, mimeType, references, deadlineAt) {
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const response = await fetchBeforeDeadline(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: buildParts(imageBytes, mimeType, references) }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 384,
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
              confidence: { type: 'NUMBER' }
            },
            required: [
              'matched',
              'capa_code',
              'background_structure',
              'layout_structure',
              'decorative_structure',
              'signature_elements',
              'confidence'
            ]
          }
        }
      })
    },
    deadlineAt,
    'Gemini estrutural'
  );

  if (!response.ok) throw new FallbackError(`Gemini falhou (${response.status})`, 503, 'gemini_failed');
  const payload = await response.json();
  const { text, finishReason } = structuredText(payload);
  if (!text) throw new FallbackError('Gemini não retornou conteúdo.', 502, 'gemini_empty');

  let result;
  try {
    result = parseStructuredJson(text);
  } catch {
    const suffix = finishReason ? ` (${finishReason})` : '';
    throw new FallbackError(`Gemini retornou JSON inválido${suffix}.`, 502, 'gemini_invalid_json');
  }

  const allowed = new Set(references.map(item => item.capa_code));
  const capaCode = String(result?.capa_code || '').trim().toUpperCase();
  const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  const structuralPass = result?.background_structure === true &&
    result?.layout_structure === true &&
    result?.decorative_structure === true &&
    result?.signature_elements === true;
  const matched = result?.matched === true && allowed.has(capaCode) && structuralPass && confidence >= MIN_FINAL_CONFIDENCE;

  return { matched, capa_code: matched ? capaCode : '', confidence, model, finishReason };
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  return {
    ...product,
    wireo: parsed.wireo,
    tassel: parsed.tassel,
    elastico: parsed.elastico,
    image_url: product.image_key ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}` : null
  };
}

async function productsForCover(env, capaCode) {
  const { results } = await env.DB.prepare(`
    SELECT p.*,
      (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
      (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
    FROM products p
    WHERE p.capa_code=?
    ORDER BY p.id ASC
  `).bind(capaCode).all();
  return results || [];
}

export async function structuralFallbackIdentify(request, env) {
  const started = Date.now();
  const deadlineAt = started + TOTAL_BUDGET_MS;
  const performance = {
    pipeline_version: 'vectorize+gemini-structural-v2',
    retrieval_source: 'vectorize',
    verification_mode: 'gemini-structured-json'
  };

  try {
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);
    const bytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    const embeddingStarted = Date.now();
    const vector = await embedImage(env, bytes, image.type || 'image/jpeg', deadlineAt);
    performance.embedding_ms = Date.now() - embeddingStarted;

    const vectorStarted = Date.now();
    const covers = await vectorCandidates(env, vector);
    performance.vectorize_ms = Date.now() - vectorStarted;
    performance.retrieval_top1_code = covers[0]?.capa_code || null;
    performance.retrieval_top1 = covers[0]?.retrieval_score ?? null;
    performance.candidate_count = covers.length;

    const referenceStarted = Date.now();
    const references = await loadReferences(env, covers);
    performance.reference_load_ms = Date.now() - referenceStarted;

    const geminiStarted = Date.now();
    const verification = await verifyWithGemini(env, bytes, image.type || 'image/jpeg', references, deadlineAt);
    performance.gemini_ms = Date.now() - geminiStarted;
    performance.model = verification.model;
    performance.gemini_finish_reason = verification.finishReason || null;
    performance.confidence = verification.confidence;

    if (!verification.matched || !verification.capa_code) {
      performance.total_ms = Date.now() - started;
      return json({
        error: 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: verification.confidence,
        identified_by: 'vectorize+gemini-structural',
        performance
      }, 422);
    }

    const products = await productsForCover(env, verification.capa_code);
    if (!products.length) throw new FallbackError('A capa foi reconhecida, mas não existe produto correspondente no banco.', 422, 'product_missing');

    performance.total_ms = Date.now() - started;
    performance.accepted_by = 'vectorize+gemini-structural';
    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: verification.capa_code,
        products: products.map(productPayload),
        confidence: verification.confidence,
        identified_by: 'vectorize+gemini-structural+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      confidence: verification.confidence,
      identified_by: 'vectorize+gemini-structural',
      performance
    });
  } catch (error) {
    performance.total_ms = Date.now() - started;
    return json({
      error: error?.message || 'Falha no verificador estrutural.',
      technical_error: error?.code || 'fallback_error',
      performance
    }, Number(error?.status) || 500);
  }
}
