import { parseSku } from './sku.js';
import { structuralFallbackIdentifyV4 } from './structural-fallback-v4.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const COVER_LIMIT = 6;
const REFERENCES_PER_COVER = 2;
const MIN_PAIR_CONFIDENCE = 0.95;
const TOTAL_BUDGET_MS = 24_000;

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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function base64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function textBytes(value) { return new TextEncoder().encode(String(value || '')); }

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
    const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(signature), textBytes(encoded));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded)));
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function remainingMs(deadlineAt) { return Math.max(0, Number(deadlineAt || 0) - Date.now()); }

async function fetchBeforeDeadline(url, options, deadlineAt, label) {
  const remaining = remainingMs(deadlineAt);
  if (remaining < 500) throw new FallbackError(`${label} excedeu o tempo disponível.`, 503, 'fallback_timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('deadline'), remaining);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') throw new FallbackError(`${label} excedeu o tempo disponível.`, 503, 'fallback_timeout');
    throw new FallbackError(`${label} indisponível: ${error?.message || 'falha de rede'}`, 503, 'upstream_unavailable');
  } finally { clearTimeout(timer); }
}

function coversFromTicket(ticket) {
  const codes = Array.isArray(ticket?.codes) ? ticket.codes : [];
  const scores = ticket?.scores && typeof ticket.scores === 'object' ? ticket.scores : {};
  const refs = Array.isArray(ticket?.references) ? ticket.references : [];
  const covers = [];
  for (const raw of codes) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code || covers.some(item => item.capa_code === code)) continue;
    const references = refs
      .filter(item => String(item?.capa_code || '').trim().toUpperCase() === code)
      .map(item => ({
        reference_id: Number(item?.reference_id || 0),
        vector_rank: Number(item?.vector_rank || 0),
        retrieval_score: Number(item?.retrieval_score ?? scores[code] ?? -1)
      }))
      .filter(item => Number.isInteger(item.reference_id) && item.reference_id > 0)
      .sort((a, b) => (a.vector_rank || 999999) - (b.vector_rank || 999999));
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
  for (const field of ['embedding_ms','vectorize_ms','retrieval_top1','retrieval_top1_code','retrieval_top2','retrieval_top2_code','retrieval_margin','vector_top_k','reference_candidate_count','cover_candidate_count','candidate_lookup_ms','model']) {
    if (source[field] !== undefined && source[field] !== null) performance[field] = source[field];
  }
  performance.candidate_generation_ms = Number(source.total_ms || 0);
}

async function loadCoverReferences(env, covers) {
  const codes = covers.map(item => item.capa_code);
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
    const selected = [];
    for (const meta of cover.references || []) {
      const row = byId.get(meta.reference_id);
      if (!row || row.capa_code !== cover.capa_code || selected.some(item => item.id === row.id)) continue;
      selected.push({ ...row, retrieval_score: meta.retrieval_score, vector_rank: meta.vector_rank, exact_retrieval_reference: true });
      if (selected.length >= REFERENCES_PER_COVER) break;
    }
    if (selected.length < REFERENCES_PER_COVER) {
      for (const row of byCode.get(cover.capa_code) || []) {
        if (selected.some(item => item.id === row.id)) continue;
        selected.push({ ...row, retrieval_score: cover.retrieval_score, vector_rank: null, exact_retrieval_reference: false });
        if (selected.length >= REFERENCES_PER_COVER) break;
      }
    }
    const loaded = (await Promise.all(selected.map(async ref => {
      const object = await env.PRODUCT_IMAGES.get(ref.image_key);
      if (!object) return null;
      return { ...ref, bytes: new Uint8Array(await object.arrayBuffer()), mimeType: object.httpMetadata?.contentType || 'image/jpeg' };
    }))).filter(Boolean);
    if (loaded.length) groups.push({ cover, references: loaded });
  }
  return groups;
}

function structuredText(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  return parts.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim();
}

function parseStructuredJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!cleaned) throw new Error('empty');
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('invalid_json');
}

function pairParts(imageBytes, mimeType, group) {
  const parts = [{
    text: `Compare a FOTO com as REFERÊNCIAS de UMA ÚNICA capa da NISTI PRINT. Sua tarefa é binária: decidir se a FOTO e as referências compartilham exatamente a mesma ARTE-BASE.\n\nIGNORE nome personalizado, inicial/letra, datas, Wire-O/espiral, tassel, elástico, brilho, reflexo, mesa, mão, perspectiva, corte e iluminação. NÃO use somente cor. Exija coincidência da estrutura do fundo, faixas/molduras, distribuição dos elementos, ilustrações/padrões e assinatura gráfica. Se qualquer elemento estrutural importante divergir, same_base_art=false. Não tente escolher o candidato mais parecido; responda apenas se esta capa específica é a mesma arte-base.`
  }, { text: 'FOTO:' }, { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64(imageBytes) } }];
  for (const ref of group.references) {
    parts.push({ text: `REFERÊNCIA DA CAPA ${group.cover.capa_code}; reference_id=${ref.id}` });
    parts.push({ inline_data: { mime_type: ref.mimeType, data: base64(ref.bytes) } });
  }
  return parts;
}

async function verifyPair(env, imageBytes, mimeType, group, deadlineAt) {
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const response = await fetchBeforeDeadline(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: pairParts(imageBytes, mimeType, group) }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 160,
        media_resolution: 'MEDIA_RESOLUTION_MEDIUM',
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
          required: ['same_base_art','background_structure','layout_structure','decorative_structure','signature_elements','confidence']
        }
      }
    })
  }, deadlineAt, `Gemini comparação ${group.cover.capa_code}`);
  if (!response.ok) throw new FallbackError(`Gemini falhou (${response.status}) para ${group.cover.capa_code}`, 503, 'gemini_failed');
  const result = parseStructuredJson(structuredText(await response.json()));
  const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  const structuralPass = result?.background_structure === true && result?.layout_structure === true && result?.decorative_structure === true && result?.signature_elements === true;
  const passed = result?.same_base_art === true && structuralPass && confidence >= MIN_PAIR_CONFIDENCE;
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
    model
  };
}

function productPayload(product) {
  const parsed = parseSku(product.sku);
  const version = String(product.image_key || '').split('/').pop();
  return { ...product, wireo: parsed.wireo, tassel: parsed.tassel, elastico: parsed.elastico, image_url: product.image_key ? `/api/images/${product.id}${version ? `?v=${encodeURIComponent(version)}` : ''}` : null };
}

async function productsForCover(env, capaCode) {
  const { results } = await env.DB.prepare(`
    SELECT p.*,
      (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
      (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
    FROM products p WHERE p.capa_code=? ORDER BY p.id ASC
  `).bind(capaCode).all();
  return results || [];
}

function finalizePerformance(performance, started) {
  const fallbackMs = Date.now() - started;
  performance.fallback_ms = fallbackMs;
  performance.total_ms = Math.max(0, Number(performance.candidate_generation_ms || 0)) + fallbackMs;
}

export async function structuralFallbackIdentifyV8(request, env) {
  const ticket = await readSignedTicket(env, cookieValue(request, COOKIE_NAME));
  const covers = coversFromTicket(ticket);
  if (!ticket || !covers.length) return structuralFallbackIdentifyV4(request, env);

  const started = Date.now();
  const deadlineAt = started + TOTAL_BUDGET_MS;
  const performance = {
    pipeline_version: 'vectorize-multiref+gemini-pairwise-v8',
    verification_mode: 'parallel-pairwise-gemini-unique-winner',
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
    const bytes = new Uint8Array(await image.arrayBuffer());
    performance.upload_bytes = image.size;

    const referenceStarted = Date.now();
    const groups = await loadCoverReferences(env, covers);
    performance.reference_load_ms = Date.now() - referenceStarted;
    performance.reference_candidate_count = groups.reduce((sum, group) => sum + group.references.length, 0);
    performance.reference_ids = groups.flatMap(group => group.references.map(item => item.id));
    if (!groups.length) throw new FallbackError('As referências visuais não estão disponíveis.', 503, 'reference_images_missing');

    const geminiStarted = Date.now();
    const pairResults = await Promise.all(groups.map(group => verifyPair(env, bytes, image.type || 'image/jpeg', group, deadlineAt)));
    performance.gemini_ms = Date.now() - geminiStarted;
    performance.model = pairResults[0]?.model || env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    performance.pairwise_results = pairResults.map(item => ({ capa_code: item.capa_code, passed: item.passed, confidence: item.confidence, retrieval_rank: item.retrieval_rank, reference_ids: item.reference_ids }));

    const winners = pairResults.filter(item => item.passed).sort((a, b) => b.confidence - a.confidence || a.retrieval_rank - b.retrieval_rank);
    performance.pairwise_pass_count = winners.length;
    performance.confidence = winners[0]?.confidence ?? Math.max(0, ...pairResults.map(item => item.confidence));

    if (winners.length !== 1) {
      performance.accepted_by = winners.length > 1 ? 'rejected-ambiguous-pairwise' : 'rejected-no-pairwise-match';
      finalizePerformance(performance, started);
      return json({
        error: winners.length > 1
          ? 'Mais de uma capa passou na verificação estrutural. Produto não identificado com segurança.'
          : 'Não encontrei uma correspondência visual segura para esta capa.',
        confidence: performance.confidence,
        identified_by: performance.accepted_by,
        performance
      }, 422);
    }

    const winner = winners[0];
    const products = await productsForCover(env, winner.capa_code);
    if (!products.length) throw new FallbackError('A capa foi reconhecida, mas não existe produto correspondente no banco.', 422, 'product_missing');

    performance.accepted_by = 'unique-pairwise-gemini-match';
    performance.selected_code = winner.capa_code;
    performance.selected_confidence = winner.confidence;
    finalizePerformance(performance, started);

    if (products.length > 1) {
      return json({ needs_selection: true, selection_reason: 'same_cover_multiple_skus', capa_code: winner.capa_code, products: products.map(productPayload), confidence: winner.confidence, identified_by: 'vectorize+gemini-pairwise+human-sku-selection', performance });
    }

    return json({ product: productPayload(products[0]), capa_code: winner.capa_code, confidence: winner.confidence, identified_by: 'vectorize+gemini-pairwise', performance });
  } catch (error) {
    finalizePerformance(performance, started);
    return json({ error: error?.message || 'Falha no verificador visual pareado.', technical_error: error?.code || 'fallback_error', performance }, Number(error?.status) || 500);
  }
}
