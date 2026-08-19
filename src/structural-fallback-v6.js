import { parseSku } from './sku.js';
import { structuralFallbackIdentifyV4 } from './structural-fallback-v4.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const COVER_LIMIT = 6;
const BATCH_SIZE = 3;
const MIN_FINAL_CONFIDENCE = 0.95;
const TOTAL_BUDGET_MS = 24_000;
const COARSE_BUDGET_MS = 9_000;

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
  const material = await crypto.subtle.digest('SHA-256', textBytes(`nisti-local-vision:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
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
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded)));
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function remainingMs(deadlineAt) {
  return Math.max(0, Number(deadlineAt || 0) - Date.now());
}

async function fetchBeforeDeadline(url, options, deadlineAt, label) {
  const remaining = remainingMs(deadlineAt);
  if (remaining < 300) throw new FallbackError(`${label} excedeu o tempo disponível.`, 503, 'fallback_timeout');
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

function coversFromTicket(ticket) {
  const codes = Array.isArray(ticket?.codes) ? ticket.codes : [];
  const scores = ticket?.scores && typeof ticket.scores === 'object' ? ticket.scores : {};
  const ticketReferences = Array.isArray(ticket?.references) ? ticket.references : [];
  const covers = [];
  const seen = new Set();

  for (const raw of codes) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const references = ticketReferences
      .filter(item => String(item?.capa_code || '').trim().toUpperCase() === code)
      .map(item => ({
        reference_id: Number(item?.reference_id || 0),
        vector_rank: Number(item?.vector_rank || 0),
        retrieval_score: Number(item?.retrieval_score ?? scores[code] ?? -1)
      }))
      .filter(item => Number.isInteger(item.reference_id) && item.reference_id > 0)
      .sort((a, b) => (a.vector_rank || Number.MAX_SAFE_INTEGER) - (b.vector_rank || Number.MAX_SAFE_INTEGER))
      .filter((item, index, list) => list.findIndex(other => other.reference_id === item.reference_id) === index);

    covers.push({
      capa_code: code,
      retrieval_rank: covers.length + 1,
      retrieval_score: Number(scores[code] ?? references[0]?.retrieval_score ?? -1),
      references
    });
    if (covers.length >= COVER_LIMIT) break;
  }
  return covers;
}

function inheritTicketPerformance(performance, ticket) {
  const source = ticket?.performance && typeof ticket.performance === 'object' ? ticket.performance : {};
  const fields = [
    'embedding_ms', 'vectorize_ms', 'retrieval_top1', 'retrieval_top1_code',
    'retrieval_top2', 'retrieval_top2_code', 'retrieval_margin', 'vector_top_k',
    'reference_candidate_count', 'cover_candidate_count', 'multi_reference_candidates',
    'candidate_lookup_ms', 'read_photo_ms', 'model'
  ];
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) performance[field] = source[field];
  }
  performance.candidate_generation_ms = Number(source.total_ms || 0);
}

async function loadDiverseReferences(env, covers) {
  const codes = covers.map(item => item.capa_code);
  if (!codes.length) throw new FallbackError('Nenhuma capa candidata disponível.', 422, 'no_candidates');

  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE active=1
      AND image_key IS NOT NULL
      AND capa_code IN (${placeholders})
    ORDER BY CASE WHEN reference_kind='product' THEN 0 ELSE 1 END, id ASC
  `).bind(...codes).all();

  const byId = new Map();
  const byCode = new Map(codes.map(code => [code, []]));
  for (const row of results || []) {
    const code = String(row.capa_code || '').trim().toUpperCase();
    const normalized = {
      id: Number(row.id),
      capa_code: code,
      image_key: row.image_key,
      source_product_id: Number(row.source_product_id || 0) || null,
      reference_kind: row.reference_kind || 'product'
    };
    byId.set(normalized.id, normalized);
    if (byCode.has(code)) byCode.get(code).push(normalized);
  }

  const selected = [];
  for (const cover of covers) {
    let row = null;
    let exact = false;
    let referenceMeta = null;

    for (const candidate of cover.references || []) {
      const candidateRow = byId.get(Number(candidate.reference_id));
      if (!candidateRow || candidateRow.capa_code !== cover.capa_code) continue;
      row = candidateRow;
      referenceMeta = candidate;
      exact = true;
      break;
    }

    if (!row) {
      row = (byCode.get(cover.capa_code) || [])[0] || null;
      referenceMeta = row ? {
        reference_id: row.id,
        vector_rank: null,
        retrieval_score: cover.retrieval_score
      } : null;
    }
    if (!row || !referenceMeta) continue;

    selected.push({
      ...row,
      retrieval_rank: cover.retrieval_rank,
      retrieval_score: Number(referenceMeta.retrieval_score ?? cover.retrieval_score ?? 0),
      vector_rank: referenceMeta.vector_rank || null,
      exact_retrieval_reference: exact
    });
  }

  const loaded = await Promise.all(selected.map(async reference => {
    const object = await env.PRODUCT_IMAGES.get(reference.image_key);
    if (!object) return null;
    return {
      ...reference,
      bytes: new Uint8Array(await object.arrayBuffer()),
      mimeType: object.httpMetadata?.contentType || 'image/jpeg'
    };
  }));

  const references = loaded.filter(Boolean);
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
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('invalid_json');
}

function buildParts(imageBytes, mimeType, references, phase) {
  const coarse = phase === 'coarse';
  const instruction = coarse
    ? `Você é a etapa de pré-seleção visual da NISTI PRINT. Compare a FOTO com somente estas REFERÊNCIAS e indique qual CAPA_CODE é a mais compatível com a mesma ARTE-BASE. Esta etapa apenas cria um finalista; não é autorização para retornar SKU.\n\nIGNORE nome personalizado, inicial/letra, datas, Wire-O/espiral, tassel, elástico, brilho, reflexo, mesa, mão, perspectiva, corte e iluminação. Compare fundo, faixas/molduras, distribuição, ilustrações, padrões e assinatura gráfica. Se nenhuma for convincente, matched=false, mas ainda retorne em capa_code a referência visualmente mais próxima quando houver alguma.\n\nResponda somente no JSON solicitado.`
    : `Você é o verificador visual FINAL da NISTI PRINT. Compare a FOTO somente com os FINALISTAS fornecidos e confirme a mesma ARTE-BASE.\n\nIGNORE completamente nome personalizado, inicial/letra personalizada, datas, Wire-O/espiral, tassel, elástico, brilho, reflexo, mesa, mão, perspectiva, corte e iluminação. NÃO escolha apenas por cor. Exija coincidência estrutural do fundo, faixas/molduras, distribuição dos elementos, ilustrações/padrões e assinatura gráfica. matched=true somente quando a correspondência for inequívoca; em dúvida, matched=false.\n\nResponda somente no JSON solicitado.`;

  const parts = [{ text: instruction }, { text: 'FOTO A IDENTIFICAR:' }, {
    inline_data: { mime_type: mimeType || 'image/jpeg', data: base64(imageBytes) }
  }];

  for (const ref of references) {
    parts.push({
      text: `${coarse ? 'CANDIDATA' : 'FINALISTA'} ${ref.retrieval_rank}: CAPA_CODE=${ref.capa_code}; reference_id=${ref.id}; score=${Number(ref.retrieval_score || 0).toFixed(6)}`
    });
    parts.push({ inline_data: { mime_type: ref.mimeType, data: base64(ref.bytes) } });
  }
  return parts;
}

async function verifyWithGemini(env, imageBytes, mimeType, references, deadlineAt, phase) {
  if (!env.GEMINI_API_KEY) throw new FallbackError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const mediaResolution = phase === 'coarse' ? 'MEDIA_RESOLUTION_LOW' : 'MEDIA_RESOLUTION_MEDIUM';
  const response = await fetchBeforeDeadline(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: buildParts(imageBytes, mimeType, references, phase) }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 192,
          media_resolution: mediaResolution,
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
            required: ['matched', 'capa_code', 'background_structure', 'layout_structure', 'decorative_structure', 'signature_elements', 'confidence']
          }
        }
      })
    },
    deadlineAt,
    phase === 'coarse' ? 'Gemini pré-seleção' : 'Gemini confirmação final'
  );

  if (!response.ok) throw new FallbackError(`Gemini falhou (${response.status})`, 503, 'gemini_failed');
  const payload = await response.json();
  const { text, finishReason } = structuredText(payload);
  if (!text) throw new FallbackError('Gemini não retornou conteúdo.', 502, 'gemini_empty');

  let result;
  try {
    result = parseStructuredJson(text);
  } catch {
    throw new FallbackError(`Gemini retornou JSON inválido${finishReason ? ` (${finishReason})` : ''}.`, 502, 'gemini_invalid_json');
  }

  const allowed = new Set(references.map(item => item.capa_code));
  const capaCode = String(result?.capa_code || '').trim().toUpperCase();
  const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  const structuralPass = result?.background_structure === true && result?.layout_structure === true && result?.decorative_structure === true && result?.signature_elements === true;
  const proposed = allowed.has(capaCode) ? capaCode : '';
  const matched = phase === 'final' && result?.matched === true && Boolean(proposed) && structuralPass && confidence >= MIN_FINAL_CONFIDENCE;

  return {
    matched,
    capa_code: matched ? proposed : '',
    proposed_capa_code: proposed,
    confidence,
    model,
    finishReason,
    structuralPass,
    background_structure: result?.background_structure === true,
    layout_structure: result?.layout_structure === true,
    decorative_structure: result?.decorative_structure === true,
    signature_elements: result?.signature_elements === true
  };
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function finalistForBatch(batch, result) {
  if (result?.proposed_capa_code) {
    const proposed = batch.find(item => item.capa_code === result.proposed_capa_code);
    if (proposed) return proposed;
  }
  return batch[0] || null;
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

function finalizePerformance(performance, started) {
  const fallbackMs = Date.now() - started;
  performance.fallback_ms = fallbackMs;
  performance.total_ms = Math.max(0, Number(performance.candidate_generation_ms || 0)) + fallbackMs;
}

export async function structuralFallbackIdentifyV6(request, env) {
  const ticketToken = cookieValue(request, COOKIE_NAME);
  const ticket = await readSignedTicket(env, ticketToken);
  const covers = coversFromTicket(ticket);
  if (!ticket || !covers.length) return structuralFallbackIdentifyV4(request, env);

  const started = Date.now();
  const deadlineAt = started + TOTAL_BUDGET_MS;
  const performance = {
    pipeline_version: 'vectorize-batched-ticket+gemini-structural-v6',
    verification_mode: 'gemini-parallel-coarse+strict-final',
    retrieval_source: 'vectorize-ticket-batched-reuse',
    reused_candidates: true
  };

  try {
    inheritTicketPerformance(performance, ticket);
    performance.candidate_count = covers.length;
    performance.candidate_codes = covers.map(item => item.capa_code);

    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);
    const bytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    const referenceStarted = Date.now();
    const references = await loadDiverseReferences(env, covers);
    performance.reference_load_ms = Date.now() - referenceStarted;
    performance.reference_count = references.length;
    performance.reference_candidate_count = references.length;
    performance.reference_ids = references.map(item => item.id);
    performance.reference_codes = references.map(item => item.capa_code);
    performance.exact_retrieval_reference_count = references.filter(item => item.exact_retrieval_reference).length;

    const batches = chunks(references, BATCH_SIZE);
    performance.coarse_batch_count = batches.length;
    const coarseStarted = Date.now();
    const coarseDeadlineAt = Math.min(deadlineAt, coarseStarted + COARSE_BUDGET_MS);
    const coarseResults = await Promise.all(batches.map(batch => verifyWithGemini(
      env,
      bytes,
      image.type || 'image/jpeg',
      batch,
      coarseDeadlineAt,
      'coarse'
    )));
    performance.coarse_ms = Date.now() - coarseStarted;
    performance.coarse_results = coarseResults.map((result, index) => ({
      batch: index + 1,
      proposed_capa_code: result.proposed_capa_code || null,
      confidence: result.confidence,
      structural_pass: result.structuralPass
    }));

    const finalists = [];
    coarseResults.forEach((result, index) => {
      const finalist = finalistForBatch(batches[index], result);
      if (finalist && !finalists.some(item => item.capa_code === finalist.capa_code)) finalists.push(finalist);
    });
    if (!finalists.length) throw new FallbackError('A pré-seleção não produziu finalistas válidos.', 422, 'no_finalists');

    performance.finalist_codes = finalists.map(item => item.capa_code);
    performance.final_reference_count = finalists.length;

    const finalStarted = Date.now();
    const verification = await verifyWithGemini(
      env,
      bytes,
      image.type || 'image/jpeg',
      finalists,
      deadlineAt,
      'final'
    );
    performance.final_gemini_ms = Date.now() - finalStarted;
    performance.gemini_ms = performance.coarse_ms + performance.final_gemini_ms;
    performance.model = verification.model;
    performance.gemini_finish_reason = verification.finishReason || null;
    performance.confidence = verification.confidence;
    performance.gemini_proposed_code = verification.proposed_capa_code || null;
    performance.gemini_background_structure = verification.background_structure;
    performance.gemini_layout_structure = verification.layout_structure;
    performance.gemini_decorative_structure = verification.decorative_structure;
    performance.gemini_signature_elements = verification.signature_elements;

    if (!verification.matched || !verification.capa_code) {
      finalizePerformance(performance, started);
      return json({
        error: 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: verification.confidence,
        identified_by: 'vectorize-ticket+gemini-batched-final',
        performance
      }, 422);
    }

    const products = await productsForCover(env, verification.capa_code);
    if (!products.length) throw new FallbackError('A capa foi reconhecida, mas não existe produto correspondente no banco.', 422, 'product_missing');

    performance.accepted_by = 'vectorize-ticket+gemini-batched-final';
    finalizePerformance(performance, started);

    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: verification.capa_code,
        products: products.map(productPayload),
        confidence: verification.confidence,
        identified_by: 'vectorize-ticket+gemini-batched-final+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      confidence: verification.confidence,
      identified_by: 'vectorize-ticket+gemini-batched-final',
      performance
    });
  } catch (error) {
    finalizePerformance(performance, started);
    return json({
      error: error?.message || 'Falha no verificador estrutural em lotes.',
      technical_error: error?.code || 'fallback_error',
      performance
    }, Number(error?.status) || 500);
  }
}
