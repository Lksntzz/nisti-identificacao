import { parseSku } from './sku.js';

const COOKIE_NAME = 'nisti_recognition_ticket';
const COVER_LIMIT = 6;
const REFERENCES_PER_COVER = 1;
const MIN_CONFIDENCE = 0.97;
const VERIFY_TIMEOUT_MS = 14_000;

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

function inheritTicketPerformance(performance, ticket) {
  const source = ticket?.performance && typeof ticket.performance === 'object'
    ? ticket.performance
    : {};
  const fields = [
    'embedding_ms', 'vectorize_ms', 'retrieval_top1', 'retrieval_top1_code',
    'retrieval_top2', 'retrieval_top2_code', 'retrieval_margin', 'vector_top_k',
    'reference_candidate_count', 'cover_candidate_count', 'candidate_lookup_ms', 'model'
  ];
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) {
      performance[field] = source[field];
    }
  }
  performance.candidate_generation_ms = Number(source.total_ms || 0);
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

async function loadReferences(env, covers) {
  const codes = covers.map(item => item.capa_code);
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE active=1 AND image_key IS NOT NULL
      AND capa_code IN (${placeholders})
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

    if (loaded.length) {
      groups.push({
        cover,
        references: loaded
      });
    }
  }

  return groups;
}

function parseStructuredJson(payload) {
  const candidate = payload?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .map(part => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) throw new Error('empty_response');
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('invalid_json');
}

function verificationParts(photoBytes, photoMime, groups) {
  const allowedCodes = groups.map(group => group.cover.capa_code).join(', ');
  const parts = [{
    text: `Você é o classificador visual final da NISTI PRINT. Identifique a ARTE-BASE exata da FOTO usando SOMENTE as referências fornecidas.\n\nCAPA_CODE permitidos: ${allowedCodes}. Se nenhuma referência for identidade exata, selected_capa_code deve ser NONE.\n\nREGRAS OBRIGATÓRIAS:\n1. Avalie TODAS as candidatas de forma independente antes de selecionar qualquer uma.\n2. NÃO escolha a mais parecida. Similaridade genérica não é identidade.\n3. Ignore SOMENTE personalização variável: nome próprio do cliente, inicial/letra personalizada e datas personalizadas.\n4. NÃO ignore texto fixo da arte/produto. Títulos e frases como "Caderneta de Vacinação", "Caderneta de Saúde", "Edição Executiva", "Minhas contas organizadas", "controle financeiro" e equivalentes são evidência forte. Se houver texto fixo claramente conflitante entre FOTO e referência, essa candidata DEVE falhar.\n5. Compare fundo/textura, faixas e molduras, posição e proporção dos blocos, linhas, ícones/ilustrações, tipografia fixa e assinatura gráfica.\n6. Cor isolada, fundo preto/cinza/branco, Wire-O, elástico, tassel, brilho, reflexo, mão, mesa, corte e perspectiva NÃO provam identidade.\n7. Uma candidata só pode ser aprovada se houver múltiplos elementos distintivos concordantes e nenhum conflito estrutural importante.\n8. selected_capa_code só pode ser um CAPA_CODE permitido quando EXATAMENTE UMA candidata for aprovada. Caso contrário retorne NONE.`
  }, {
    text: 'FOTO A IDENTIFICAR:'
  }, {
    inline_data: {
      mime_type: photoMime || 'image/jpeg',
      data: base64(photoBytes)
    }
  }];

  for (const group of groups) {
    const code = group.cover.capa_code;
    parts.push({ text: `INÍCIO REFERÊNCIA CAPA_CODE=${code}; retrieval_rank=${group.cover.retrieval_rank}; retrieval_score=${group.cover.retrieval_score}` });
    for (const ref of group.references) {
      parts.push({ text: `IMAGEM DE REFERÊNCIA CAPA_CODE=${code}; reference_id=${ref.id}` });
      parts.push({
        inline_data: {
          mime_type: ref.mimeType,
          data: base64(ref.bytes)
        }
      });
    }
    parts.push({ text: `FIM REFERÊNCIA CAPA_CODE=${code}` });
  }

  return parts;
}

async function verifyAll(env, photoBytes, photoMime, groups) {
  if (!env.GEMINI_API_KEY) {
    throw new RecognitionError('GEMINI_API_KEY não configurada', 503, 'gemini_not_configured');
  }

  const model = env.GEMINI_VERIFIER_MODEL || 'gemini-3.5-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('verification-timeout'), VERIFY_TIMEOUT_MS);
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
            parts: verificationParts(photoBytes, photoMime, groups)
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 900,
            media_resolution: 'MEDIA_RESOLUTION_HIGH',
            thinkingConfig: { thinkingLevel: 'minimal' },
            response_mime_type: 'application/json',
            response_schema: {
              type: 'OBJECT',
              properties: {
                selected_capa_code: { type: 'STRING' },
                unique_match: { type: 'BOOLEAN' },
                assessments: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      capa_code: { type: 'STRING' },
                      same_base_art: { type: 'BOOLEAN' },
                      permanent_text_compatible: { type: 'BOOLEAN' },
                      layout_match: { type: 'BOOLEAN' },
                      distinctive_graphics_match: { type: 'BOOLEAN' },
                      disqualifying_conflict: { type: 'BOOLEAN' },
                      confidence: { type: 'NUMBER' }
                    },
                    required: [
                      'capa_code',
                      'same_base_art',
                      'permanent_text_compatible',
                      'layout_match',
                      'distinctive_graphics_match',
                      'disqualifying_conflict',
                      'confidence'
                    ]
                  }
                }
              },
              required: ['selected_capa_code', 'unique_match', 'assessments']
            }
          }
        })
      }
    );

    if (!response.ok) {
      throw new RecognitionError(`Gemini verificador falhou (${response.status})`, 503, 'gemini_verifier_failed');
    }

    const result = parseStructuredJson(await response.json());
    const allowed = new Set(groups.map(group => group.cover.capa_code));
    const assessments = Array.isArray(result?.assessments)
      ? result.assessments.map(item => ({
          capa_code: String(item?.capa_code || '').trim().toUpperCase(),
          same_base_art: item?.same_base_art === true,
          permanent_text_compatible: item?.permanent_text_compatible === true,
          layout_match: item?.layout_match === true,
          distinctive_graphics_match: item?.distinctive_graphics_match === true,
          disqualifying_conflict: item?.disqualifying_conflict === true,
          confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0))
        })).filter(item => allowed.has(item.capa_code))
      : [];

    const passed = assessments.filter(item =>
      item.same_base_art === true &&
      item.permanent_text_compatible === true &&
      item.layout_match === true &&
      item.distinctive_graphics_match === true &&
      item.disqualifying_conflict !== true &&
      item.confidence >= MIN_CONFIDENCE
    );

    const proposedCode = String(result?.selected_capa_code || '').trim().toUpperCase();
    const accepted =
      result?.unique_match === true &&
      passed.length === 1 &&
      allowed.has(proposedCode) &&
      passed[0].capa_code === proposedCode;

    return {
      accepted,
      selected_capa_code: accepted ? proposedCode : null,
      proposed_capa_code: proposedCode || null,
      unique_match: result?.unique_match === true,
      assessments,
      passed_codes: passed.map(item => item.capa_code),
      confidence: accepted ? passed[0].confidence : Math.max(0, ...assessments.map(item => item.confidence)),
      elapsed_ms: Date.now() - started,
      model
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new RecognitionError('Gemini verificador excedeu o tempo disponível.', 503, 'gemini_verifier_timeout');
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

function finalizePerformance(performance, started) {
  const verifierMs = Date.now() - started;
  performance.fallback_ms = verifierMs;
  performance.total_ms = Math.max(0, Number(performance.candidate_generation_ms || 0)) + verifierMs;
}

export async function structuralFinalIdentifyV1(request, env) {
  const started = Date.now();
  const performance = {
    pipeline_version: 'vectorize-multiref+gemini-final-v1',
    verification_mode: 'single-strict-comparative-classifier',
    retrieval_source: 'vectorize-ticket-reuse',
    reused_candidates: true
  };

  try {
    const ticket = await readSignedTicket(env, cookieValue(request, COOKIE_NAME));
    if (!ticket) {
      throw new RecognitionError('Ticket de candidatos ausente ou expirado. Refaça a foto.', 409, 'candidate_ticket_missing');
    }

    inheritTicketPerformance(performance, ticket);
    const covers = coversFromTicket(ticket);
    if (!covers.length) {
      throw new RecognitionError('Nenhuma capa candidata disponível.', 422, 'no_candidates');
    }

    performance.candidate_count = covers.length;
    performance.candidate_codes = covers.map(item => item.capa_code);

    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) {
      throw new RecognitionError('Foto da capa obrigatória.', 400, 'image_required');
    }

    const photoBytes = new Uint8Array(await image.arrayBuffer());
    const photoMime = image.type || 'image/jpeg';
    performance.upload_bytes = image.size;

    const referenceStarted = Date.now();
    const groups = await loadReferences(env, covers);
    performance.reference_load_ms = Date.now() - referenceStarted;
    performance.reference_candidate_count = groups.reduce((sum, group) => sum + group.references.length, 0);
    performance.reference_ids = groups.flatMap(group => group.references.map(ref => ref.id));

    if (!groups.length) {
      throw new RecognitionError('As referências visuais não estão disponíveis.', 503, 'reference_images_missing');
    }

    const decision = await verifyAll(env, photoBytes, photoMime, groups);
    performance.gemini_ms = decision.elapsed_ms;
    performance.model = decision.model;
    performance.assessments = decision.assessments;
    performance.passed_codes = decision.passed_codes;
    performance.proposed_code = decision.proposed_capa_code;
    performance.confidence = decision.confidence;

    if (!decision.accepted || !decision.selected_capa_code) {
      performance.accepted_by = 'strict-classifier-rejected';
      finalizePerformance(performance, started);
      return json({
        error: 'Não encontrei uma correspondência visual única e segura para esta capa.',
        confidence: decision.confidence,
        identified_by: decision.passed_codes.length > 1
          ? 'strict-classifier-ambiguous'
          : 'strict-classifier-no-match',
        performance
      }, 422);
    }

    const products = await productsForCover(env, decision.selected_capa_code);
    if (!products.length) {
      throw new RecognitionError(
        'A capa foi reconhecida, mas não existe produto correspondente no banco.',
        422,
        'product_missing'
      );
    }

    performance.accepted_by = 'strict-comparative-unique-winner';
    performance.winner_code = decision.selected_capa_code;
    finalizePerformance(performance, started);

    if (products.length > 1) {
      return json({
        needs_selection: true,
        selection_reason: 'same_cover_multiple_skus',
        capa_code: decision.selected_capa_code,
        products: products.map(productPayload),
        confidence: decision.confidence,
        identified_by: 'strict-classifier+human-sku-selection',
        performance
      });
    }

    return json({
      product: productPayload(products[0]),
      capa_code: decision.selected_capa_code,
      confidence: decision.confidence,
      identified_by: 'strict-classifier-unique-winner',
      performance
    });
  } catch (error) {
    finalizePerformance(performance, started);
    return json({
      error: error?.message || 'Falha no reconhecimento visual.',
      technical_error: error?.code || 'recognition_error',
      performance
    }, Number(error?.status) || 500);
  }
}
