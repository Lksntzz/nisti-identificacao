import { parseSku } from './sku.js';
import { structuralFallbackIdentifyV4 } from './structural-fallback-v4.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const COVER_LIMIT = 6;
const REFERENCES_PER_COVER = 2;
const MIN_CONFIDENCE = 0.95;
const PRIMARY_TIMEOUT_MS = 9000;
const RETRY_TIMEOUT_MS = 6500;
const TOTAL_BUDGET_MS = 22000;

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

function coversFromTicket(ticket) {
  const codes = Array.isArray(ticket?.codes) ? ticket.codes : [];
  const scores = ticket?.scores && typeof ticket.scores === 'object' ? ticket.scores : {};
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
    if (covers.length >= COVER_LIMIT) break;
  }
  return covers;
}

function inheritTicketPerformance(performance, ticket) {
  const source = ticket?.performance && typeof ticket.performance === 'object' ? ticket.performance : {};
  const fields = [
    'embedding_ms', 'vectorize_ms', 'retrieval_top1', 'retrieval_top1_code',
    'retrieval_top2', 'retrieval_top2_code', 'retrieval_margin', 'vector_top_k',
    'reference_candidate_count', 'cover_candidate_count', 'candidate_lookup_ms', 'model'
  ];
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) performance[field] = source[field];
  }
  performance.candidate_generation_ms = Number(source.total_ms || 0);
}

async function loadCoverGroups(env, covers) {
  const codes = covers.map(item => item.capa_code);
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE active=1 AND image_key IS NOT NULL AND capa_code IN (${placeholders})
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
    const chosen = [];
    for (const meta of cover.references || []) {
      const row = byId.get(meta.reference_id);
      if (!row || row.capa_code !== cover.capa_code || chosen.some(item => item.id === row.id)) continue;
      chosen.push({ ...row, exact_retrieval_reference: true });
      if (chosen.length >= REFERENCES_PER_COVER) break;
    }
    if (chosen.length < REFERENCES_PER_COVER) {
      for (const row of byCode.get(cover.capa_code) || []) {
        if (chosen.some(item => item.id === row.id)) continue;
        chosen.push({ ...row, exact_retrieval_reference: false });
        if (chosen.length >= REFERENCES_PER_COVER) break;
      }
    }

    const loaded = (await Promise.all(chosen.map(async ref => {
      const object = await env.PRODUCT_IMAGES.get(ref.image_key);
      if (!object) return null;
      return {
        ...ref,
        bytes: new Uint8Array(await object.arrayBuffer()),
        mimeType: object.httpMetadata?.contentType || 'image/jpeg'
      };
    }))).filter(Boolean);

    if (loaded.length) groups.push({ cover, references: loaded });
  }
  return groups;
}

function parseStructuredJson(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!cleaned) throw new Error('empty');
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('invalid_json');
}

function pairParts(photoBytes, photoMime, group) {
  const parts = [{
    text: `Você verifica UMA capa específica. A decisão é binária: a FOTO e as REFERÊNCIAS possuem exatamente a mesma ARTE-BASE?\n\nIGNORE nome, inicial, datas, Wire-O/espiral, tassel, elástico, brilho, reflexo, mesa, mão, perspectiva, recorte e iluminação. NÃO decida pela cor. Compare estrutura do fundo, faixas/molduras, distribuição dos elementos, ilustrações/padrões e assinatura gráfica. Se qualquer elemento estrutural importante divergir, same_base_art=false. Não procure o item mais parecido: confirme somente identidade estrutural desta capa.`
  }, {
    text: 'FOTO A IDENTIFICAR:'
  }, {
    inline_data: { mime_type: photoMime || 'image/jpeg', data: base64(photoBytes) }
  }];

  for (const ref of group.references) {
    parts.push({ text: `REFERÊNCIA CAPA_CODE=${group.cover.capa_code}; reference_id=${ref.id}` });
    parts.push({ inline_data: { mime_type: ref.mimeType, data: base64(ref.bytes) } });
  }
  return parts;
}

async function fetchWithTimeout(url, options, timeoutMs, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('pair-timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new FallbackError(`${label} excedeu ${timeoutMs} ms.`, 503, 'pair_timeout');
    }
    throw new FallbackError(`${label} indisponível: ${error?.message || 'falha de rede'}`, 503, 'pair_unavailable');
  } finally {
    clearTimeout(timer);
  }
}

async function verifyPair(env, photoBytes, photoMime, group, timeoutMs, mediaResolution) {
  if (!env.GEMINI_API_KEY) throw new FallbackError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const started = Date.now();
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: pairParts(photoBytes, photoMime, group) }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
          media_resolution: mediaResolution,
          thinkingConfig: { thinkingLevel: 'minimal' },
          response_mime_type: 'application/json',
          response_schema: {
            type: 'OBJECT',
            properties: {
              same_base_art: { type: 'BOOLEAN' },
              background_structure: { type: 'BOOLEAN' },
              layout_structure: { type: 'BOOLEAN' },
              decorative_structure: { type: 'BOOLEAN' },
              signature_elements: { type: 'BOOLEAN' },
              confidence: { type: 'NUMBER' }
            },
            required: [
              'same_base_art', 'background_structure', 'layout_structure',
              'decorative_structure', 'signature_elements', 'confidence'
            ]
          }
        }
      })
    },
    timeoutMs,
    `Gemini comparação ${group.cover.capa_code}`
  );

  if (!response.ok) {
    throw new FallbackError(`Gemini falhou (${response.status}) para ${group.cover.capa_code}`, 503, 'gemini_failed');
  }

  const result = parseStructuredJson(await response.json());
  const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  const structuralPass = result?.background_structure === true &&
    result?.layout_structure === true &&
    result?.decorative_structure === true &&
    result?.signature_elements === true;
  const passed = result?.same_base_art === true && structuralPass && confidence >= MIN_CONFIDENCE;

  return {
    capa_code: group.cover.capa_code,
    retrieval_rank: group.cover.retrieval_rank,
    retrieval_score: group.cover.retrieval_score,
    passed,
    confidence,
    same_base_art: result?.same_base_art === true,
    background_structure: result?.background_structure === true,
    layout_structure: result?.layout_structure === true,
    decorative_structure: result?.decorative_structure === true,
    signature_elements: result?.signature_elements === true,
    reference_ids: group.references.map(item => item.id),
    model,
    elapsed_ms: Date.now() - started,
    media_resolution: mediaResolution
  };
}

async function verifyAllPairs(env, photoBytes, photoMime, groups, deadlineAt) {
  const first = await Promise.allSettled(
    groups.map(group => verifyPair(
      env,
      photoBytes,
      photoMime,
      group,
      PRIMARY_TIMEOUT_MS,
      'MEDIA_RESOLUTION_LOW'
    ))
  );

  const results = new Array(groups.length).fill(null);
  const retryIndexes = [];
  const errors = [];

  first.forEach((item, index) => {
    if (item.status === 'fulfilled') results[index] = item.value;
    else {
      retryIndexes.push(index);
      errors.push({
        capa_code: groups[index].cover.capa_code,
        phase: 'primary',
        error: item.reason?.message || 'falha'
      });
    }
  });

  if (retryIndexes.length && Date.now() < deadlineAt - 1000) {
    const retryTimeout = Math.min(RETRY_TIMEOUT_MS, Math.max(1500, deadlineAt - Date.now() - 500));
    const retried = await Promise.allSettled(
      retryIndexes.map(index => verifyPair(
        env,
        photoBytes,
        photoMime,
        groups[index],
        retryTimeout,
        'MEDIA_RESOLUTION_LOW'
      ))
    );

    retried.forEach((item, retryPosition) => {
      const index = retryIndexes[retryPosition];
      if (item.status === 'fulfilled') results[index] = item.value;
      else errors.push({
        capa_code: groups[index].cover.capa_code,
        phase: 'retry',
        error: item.reason?.message || 'falha'
      });
    });
  }

  const unresolved = groups
    .map((group, index) => results[index] ? null : group.cover.capa_code)
    .filter(Boolean);

  return {
    results: results.filter(Boolean),
    unresolved,
    errors
  };
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

export async function structuralFallbackIdentifyV9(request, env) {
  const ticket = await readSignedTicket(env, cookieValue(request, COOKIE_NAME));
  const covers = coversFromTicket(ticket);
  if (!ticket || !covers.length) return structuralFallbackIdentifyV4(request, env);

  const started = Date.now();
  const deadlineAt = started + TOTAL_BUDGET_MS;
  const performance = {
    pipeline_version: 'vectorize-multiref+gemini-pairwise-v9',
    verification_mode: 'pairwise-independent+targeted-timeout-retry+unique-winner',
    retrieval_source: 'vectorize-ticket-reuse',
    reused_candidates: true
  };

  try {
    inheritTicketPerformance(performance, ticket);
    performance.candidate_count = covers.length;
    performance.candidate_codes = covers.map(item => item.capa_code);

    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);
    const photoBytes = new Uint8Array(await image.arrayBuffer());
    const photoMime = image.type || 'image/jpeg';
    performance.upload_bytes = image.size;

    const referenceStarted = Date.now();
    const groups = await loadCoverGroups(env, covers);
    performance.reference_load_ms = Date.now() - referenceStarted;
    performance.reference_candidate_count = groups.reduce((sum, group) => sum + group.references.length, 0);
    performance.reference_ids = groups.flatMap(group => group.references.map(ref => ref.id));
    if (!groups.length) throw new FallbackError('As referências visuais não estão disponíveis.', 503, 'reference_images_missing');

    const geminiStarted = Date.now();
    const verification = await verifyAllPairs(env, photoBytes, photoMime, groups, deadlineAt);
    performance.gemini_ms = Date.now() - geminiStarted;
    performance.pairwise_results = verification.results.map(item => ({
      capa_code: item.capa_code,
      passed: item.passed,
      confidence: item.confidence,
      elapsed_ms: item.elapsed_ms,
      retrieval_rank: item.retrieval_rank,
      reference_ids: item.reference_ids
    }));
    performance.pairwise_errors = verification.errors;
    performance.unresolved_codes = verification.unresolved;
    performance.model = verification.results[0]?.model || env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

    if (verification.unresolved.length) {
      finalizePerformance(performance, started);
      return json({
        error: `Não foi possível concluir a comparação de ${verification.unresolved.join(', ')}. Tente novamente.`,
        technical_error: 'pairwise_incomplete',
        identified_by: 'pairwise-incomplete-safe-rejection',
        performance
      }, 503);
    }

    const winners = verification.results.filter(item => item.passed);
    performance.winner_codes = winners.map(item => item.capa_code);

    if (winners.length === 0) {
      finalizePerformance(performance, started);
      return json({
        error: 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: Math.max(0, ...verification.results.map(item => item.confidence || 0)),
        identified_by: 'pairwise-independent-no-match',
        performance
      }, 422);
    }

    if (winners.length > 1) {
      finalizePerformance(performance, started);
      return json({
        error: 'Mais de uma capa passou na verificação estrutural. Produto não identificado com segurança.',
        confidence: Math.max(...winners.map(item => item.confidence || 0)),
        identified_by: 'pairwise-independent-ambiguous',
        performance
      }, 422);
    }

    const winner = winners[0];
    const products = await productsForCover(env, winner.capa_code);
    if (!products.length) throw new FallbackError('A capa foi reconhecida, mas não existe produto correspondente no banco.', 422, 'product_missing');

    performance.accepted_by = 'unique-pairwise-structural-winner';
    performance.confidence = winner.confidence;
    performance.winner_code = winner.capa_code;
    finalizePerformance(performance, started);

    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: winner.capa_code,
        products: products.map(productPayload),
        confidence: winner.confidence,
        identified_by: 'pairwise-independent+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      capa_code: winner.capa_code,
      confidence: winner.confidence,
      identified_by: 'pairwise-independent-unique-winner',
      performance
    });
  } catch (error) {
    finalizePerformance(performance, started);
    return json({
      error: error?.message || 'Falha no verificador visual.',
      technical_error: error?.code || 'fallback_error',
      performance
    }, Number(error?.status) || 500);
  }
}
