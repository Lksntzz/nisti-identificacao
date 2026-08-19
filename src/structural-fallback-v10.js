import { parseSku } from './sku.js';
import { structuralFallbackIdentifyV9 } from './structural-fallback-v9.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const REFERENCES_PER_COVER = 2;
const MAX_ADJUDICATION_COVERS = 3;
const MIN_ADJUDICATION_CONFIDENCE = 0.97;
const ADJUDICATION_TIMEOUT_MS = 10_000;

class AdjudicationError extends Error {
  constructor(message, status = 503, code = 'adjudication_error') {
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

function parseStructuredJson(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
    : [];
  const text = parts
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) throw new Error('empty');
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return JSON.parse(cleaned.slice(first, last + 1));
  }
  throw new Error('invalid_json');
}

async function loadWinnerGroups(env, ticket, winnerCodes) {
  const normalizedCodes = winnerCodes
    .map(code => String(code || '').trim().toUpperCase())
    .filter(Boolean);
  const placeholders = normalizedCodes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE active=1 AND image_key IS NOT NULL
      AND capa_code IN (${placeholders})
    ORDER BY id ASC
  `).bind(...normalizedCodes).all();

  const byId = new Map();
  const byCode = new Map(normalizedCodes.map(code => [code, []]));
  for (const row of results || []) {
    const normalized = {
      id: Number(row.id),
      capa_code: String(row.capa_code || '').trim().toUpperCase(),
      image_key: row.image_key,
      source_product_id: Number(row.source_product_id || 0) || null,
      reference_kind: row.reference_kind || 'product'
    };
    byId.set(normalized.id, normalized);
    if (byCode.has(normalized.capa_code)) {
      byCode.get(normalized.capa_code).push(normalized);
    }
  }

  const ticketRefs = Array.isArray(ticket?.references) ? ticket.references : [];
  const groups = [];

  for (const code of normalizedCodes) {
    const chosen = [];
    const exactRefs = ticketRefs
      .filter(item => String(item?.capa_code || '').trim().toUpperCase() === code)
      .sort((a, b) => Number(a?.vector_rank || 999999) - Number(b?.vector_rank || 999999));

    for (const meta of exactRefs) {
      const row = byId.get(Number(meta?.reference_id || 0));
      if (!row || row.capa_code !== code || chosen.some(item => item.id === row.id)) continue;
      chosen.push({ ...row, exact_retrieval_reference: true });
      if (chosen.length >= REFERENCES_PER_COVER) break;
    }

    if (chosen.length < REFERENCES_PER_COVER) {
      for (const row of byCode.get(code) || []) {
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

    if (loaded.length) groups.push({ capa_code: code, references: loaded });
  }

  return groups;
}

function adjudicationParts(photoBytes, photoMime, groups) {
  const codes = groups.map(group => group.capa_code).join(', ');
  const parts = [{
    text: `Você é o adjudicador final de identificação visual da NISTI PRINT. As capas candidatas abaixo JÁ passaram por uma verificação binária individual, mas houve mais de uma vencedora. Agora sua tarefa é eliminar falsos positivos e decidir se existe UMA ÚNICA capa que corresponde exatamente à ARTE-BASE da FOTO.\n\nCANDIDATAS PERMITIDAS: ${codes}. Você só pode retornar um desses CAPA_CODE ou NONE.\n\nREGRAS CRÍTICAS:\n1. NÃO escolha a capa "mais parecida". Se não houver identidade estrutural única, retorne NONE.\n2. IGNORE somente personalização variável do cliente: nome próprio, inicial/letra personalizada e datas.\n3. NÃO ignore textos fixos do produto ou da arte. Frases/títulos fixos como categoria, finalidade, edição, controle financeiro, vacinação etc. são elementos fortes de identidade quando aparecem na arte-base.\n4. Compare rigorosamente: estrutura do fundo, textura/padrão, faixas diagonais, molduras, linhas, distribuição espacial, ilustrações, ícones, textos fixos, tipografia fixa e assinatura gráfica.\n5. Cor isolada nunca prova identidade. Fundo preto/cinza/branco genérico também não.\n6. Se duas candidatas compartilham estilo genérico mas divergem em texto fixo, faixas, composição ou elementos gráficos, descarte a divergente.\n7. Só marque unique_match=true quando uma única candidata se sustenta por múltiplos elementos distintivos independentes.`
  }, {
    text: 'FOTO A IDENTIFICAR:'
  }, {
    inline_data: {
      mime_type: photoMime || 'image/jpeg',
      data: base64(photoBytes)
    }
  }];

  for (const group of groups) {
    parts.push({ text: `INÍCIO CANDIDATA CAPA_CODE=${group.capa_code}` });
    for (const ref of group.references) {
      parts.push({ text: `REFERÊNCIA ${group.capa_code}; reference_id=${ref.id}` });
      parts.push({
        inline_data: {
          mime_type: ref.mimeType,
          data: base64(ref.bytes)
        }
      });
    }
    parts.push({ text: `FIM CANDIDATA CAPA_CODE=${group.capa_code}` });
  }

  return parts;
}

async function adjudicate(env, photoBytes, photoMime, groups) {
  if (!env.GEMINI_API_KEY) {
    throw new AdjudicationError(
      'GEMINI_API_KEY não configurada',
      503,
      'gemini_not_configured'
    );
  }

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort('adjudication-timeout'),
    ADJUDICATION_TIMEOUT_MS
  );
  const started = Date.now();

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
          contents: [{
            role: 'user',
            parts: adjudicationParts(photoBytes, photoMime, groups)
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 180,
            media_resolution: 'MEDIA_RESOLUTION_MEDIUM',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                selected_capa_code: { type: 'STRING' },
                unique_match: { type: 'BOOLEAN' },
                base_art_match: { type: 'BOOLEAN' },
                permanent_text_match: { type: 'BOOLEAN' },
                layout_match: { type: 'BOOLEAN' },
                distinctive_elements_match: { type: 'BOOLEAN' },
                disqualifying_conflict: { type: 'BOOLEAN' },
                confidence: { type: 'NUMBER' }
              },
              required: [
                'selected_capa_code',
                'unique_match',
                'base_art_match',
                'permanent_text_match',
                'layout_match',
                'distinctive_elements_match',
                'disqualifying_conflict',
                'confidence'
              ]
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new AdjudicationError(
        `Gemini adjudicação falhou (${response.status})`,
        503,
        'gemini_adjudication_failed'
      );
    }

    const result = parseStructuredJson(await response.json());
    const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
    const selectedCode = String(result?.selected_capa_code || '')
      .trim()
      .toUpperCase();
    const allowed = new Set(groups.map(group => group.capa_code));

    const accepted =
      allowed.has(selectedCode) &&
      result?.unique_match === true &&
      result?.base_art_match === true &&
      result?.permanent_text_match === true &&
      result?.layout_match === true &&
      result?.distinctive_elements_match === true &&
      result?.disqualifying_conflict !== true &&
      confidence >= MIN_ADJUDICATION_CONFIDENCE;

    return {
      selected_capa_code: accepted ? selectedCode : null,
      proposed_capa_code: selectedCode || null,
      accepted,
      confidence,
      unique_match: result?.unique_match === true,
      base_art_match: result?.base_art_match === true,
      permanent_text_match: result?.permanent_text_match === true,
      layout_match: result?.layout_match === true,
      distinctive_elements_match: result?.distinctive_elements_match === true,
      disqualifying_conflict: result?.disqualifying_conflict === true,
      model,
      elapsed_ms: Date.now() - started
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new AdjudicationError(
        'Gemini adjudicação excedeu o tempo disponível.',
        503,
        'gemini_adjudication_timeout'
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
      (SELECT pp.platform FROM product_platforms pp
       WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
      (SELECT pp.link FROM product_platforms pp
       WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
    FROM products p
    WHERE p.capa_code=?
    ORDER BY p.id ASC
  `).bind(capaCode).all();
  return results || [];
}

export async function structuralFallbackIdentifyV10(request, env) {
  const v9Response = await structuralFallbackIdentifyV9(request.clone(), env);
  if (v9Response.status !== 422) return v9Response;

  const v9Data = await v9Response.clone().json().catch(() => null);
  if (v9Data?.identified_by !== 'pairwise-independent-ambiguous') {
    return v9Response;
  }

  const winnerCodes = Array.isArray(v9Data?.performance?.winner_codes)
    ? v9Data.performance.winner_codes
        .map(code => String(code || '').trim().toUpperCase())
        .filter(Boolean)
    : [];

  if (winnerCodes.length < 2 || winnerCodes.length > MAX_ADJUDICATION_COVERS) {
    return v9Response;
  }

  const ticket = await readSignedTicket(env, cookieValue(request, COOKIE_NAME));
  if (!ticket) return v9Response;

  const performance = {
    ...(v9Data.performance || {}),
    pipeline_version: 'vectorize-multiref+gemini-pairwise+adjudication-v10',
    verification_mode: 'pairwise-independent+comparative-adjudication',
    adjudication_candidates: winnerCodes
  };

  try {
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return v9Response;
    const photoBytes = new Uint8Array(await image.arrayBuffer());
    const photoMime = image.type || 'image/jpeg';

    const groupsStarted = Date.now();
    const groups = await loadWinnerGroups(env, ticket, winnerCodes);
    performance.adjudication_reference_load_ms = Date.now() - groupsStarted;
    performance.adjudication_reference_ids = groups.flatMap(group =>
      group.references.map(ref => ref.id)
    );

    if (groups.length !== winnerCodes.length) {
      return v9Response;
    }

    const decision = await adjudicate(env, photoBytes, photoMime, groups);
    performance.adjudication_ms = decision.elapsed_ms;
    performance.adjudication_model = decision.model;
    performance.adjudication_proposed_code = decision.proposed_capa_code;
    performance.adjudication_confidence = decision.confidence;
    performance.adjudication_unique_match = decision.unique_match;
    performance.adjudication_permanent_text_match = decision.permanent_text_match;
    performance.adjudication_layout_match = decision.layout_match;
    performance.adjudication_distinctive_elements_match = decision.distinctive_elements_match;
    performance.adjudication_disqualifying_conflict = decision.disqualifying_conflict;
    performance.total_ms = Number(performance.total_ms || 0) +
      Number(performance.adjudication_reference_load_ms || 0) +
      Number(performance.adjudication_ms || 0);

    if (!decision.accepted || !decision.selected_capa_code) {
      performance.accepted_by = 'comparative-adjudication-rejected';
      return json({
        error: 'As capas candidatas continuam ambíguas após a comparação final. Produto não identificado com segurança.',
        confidence: decision.confidence,
        identified_by: 'comparative-adjudication-no-unique-match',
        performance
      }, 422);
    }

    const products = await productsForCover(env, decision.selected_capa_code);
    if (!products.length) {
      throw new AdjudicationError(
        'A capa foi reconhecida, mas não existe produto correspondente no banco.',
        422,
        'product_missing'
      );
    }

    performance.accepted_by = 'comparative-adjudication-unique-winner';
    performance.winner_code = decision.selected_capa_code;
    performance.confidence = decision.confidence;

    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: decision.selected_capa_code,
        products: products.map(productPayload),
        confidence: decision.confidence,
        identified_by: 'pairwise+comparative-adjudication+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      capa_code: decision.selected_capa_code,
      confidence: decision.confidence,
      identified_by: 'pairwise+comparative-adjudication-unique-winner',
      performance
    });
  } catch (error) {
    performance.adjudication_error = error?.message || 'Falha na adjudicação final';
    return json({
      error: error?.message || 'Falha na adjudicação final.',
      technical_error: error?.code || 'adjudication_error',
      performance
    }, Number(error?.status) || 503);
  }
}
