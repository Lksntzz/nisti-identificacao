import app from './ml-browser-capture-router.js';
import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const FREE_D1_LIMIT_BYTES = 500 * 1024 * 1024;
const PAID_D1_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;
let usageTableReady = false;

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

function saoPauloDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function ensureUsageTable(env) {
  if (usageTableReady) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      day TEXT PRIMARY KEY,
      identify_requests INTEGER NOT NULL DEFAULT 0,
      identify_errors INTEGER NOT NULL DEFAULT 0,
      embedding_requests INTEGER NOT NULL DEFAULT 0,
      generation_requests INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  usageTableReady = true;
}

async function recordUsage(env, values = {}) {
  try {
    await ensureUsageTable(env);
    const row = {
      identifyRequests: Number(values.identifyRequests || 0),
      identifyErrors: Number(values.identifyErrors || 0),
      embeddingRequests: Number(values.embeddingRequests || 0),
      generationRequests: Number(values.generationRequests || 0),
      promptTokens: Number(values.promptTokens || 0),
      outputTokens: Number(values.outputTokens || 0),
      totalTokens: Number(values.totalTokens || 0)
    };
    await env.DB.prepare(`
      INSERT INTO ai_usage_daily (
        day,identify_requests,identify_errors,embedding_requests,generation_requests,
        prompt_tokens,output_tokens,total_tokens,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(day) DO UPDATE SET
        identify_requests=ai_usage_daily.identify_requests+excluded.identify_requests,
        identify_errors=ai_usage_daily.identify_errors+excluded.identify_errors,
        embedding_requests=ai_usage_daily.embedding_requests+excluded.embedding_requests,
        generation_requests=ai_usage_daily.generation_requests+excluded.generation_requests,
        prompt_tokens=ai_usage_daily.prompt_tokens+excluded.prompt_tokens,
        output_tokens=ai_usage_daily.output_tokens+excluded.output_tokens,
        total_tokens=ai_usage_daily.total_tokens+excluded.total_tokens,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      saoPauloDay(),
      row.identifyRequests,
      row.identifyErrors,
      row.embeddingRequests,
      row.generationRequests,
      row.promptTokens,
      row.outputTokens,
      row.totalTokens
    ).run();
  } catch {
    // Telemetria nunca pode impedir a identificação visual.
  }
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

  const promptTokens = Number(payload?.usageMetadata?.promptTokenCount || 0);
  await recordUsage(env, {
    embeddingRequests: 1,
    promptTokens,
    totalTokens: promptTokens
  });

  return { model, values };
}

async function getTopCoverCandidates(env, uploadedFile, limit = TOP_K_COVERS) {
  const uploadBytes = new Uint8Array(await uploadedFile.arrayBuffer());
  const { values: queryEmbedding } = await embedImage(env, uploadBytes, uploadedFile.type || 'image/jpeg');
  const { results } = await env.DB.prepare(`
    SELECT capa_code,image_key,embedding_model,dimensions,embedding_json
    FROM cover_embeddings
  `).all();

  if (!results?.length) throw new Error('Índice visual vazio. As referências visuais ainda não estão disponíveis.');

  const scored = [];
  for (const row of results) {
    try {
      const vector = JSON.parse(row.embedding_json);
      const score = cosineSimilarity(queryEmbedding, vector);
      if (Number.isFinite(score)) {
        scored.push({
          capa_code: row.capa_code,
          image_key: row.image_key,
          retrieval_score: score
        });
      }
    } catch {
      // Uma referência corrompida é simplesmente ignorada nesta consulta.
    }
  }

  scored.sort((a, b) => b.retrieval_score - a.retrieval_score);
  return { uploadBytes, candidates: scored.slice(0, Math.max(1, limit)) };
}

async function verifyCoverWithGemini(env, uploadedFile, uploadBytes, candidates) {
  if (!candidates.length) throw new Error('Nenhuma capa candidata encontrada no índice visual');

  const parts = [{
    text: `Você é o verificador visual interno da NISTI PRINT. A FOTO DA EXPEDIÇÃO mostra somente a capa do produto, que pode estar solta, sem Wire-O, tassel ou elástico. Compare somente a ARTE-BASE DA CAPA com as CAPAS CANDIDATAS abaixo. Ignore nomes personalizados impressos, acabamento, miolo, plataforma e acessórios. Escolha somente um CAPA_CODE da lista se a correspondência visual for forte. Se nenhuma candidata corresponder com segurança, responda matched=false e capa_code="". Os retrieval_score servem apenas como pré-seleção e não substituem sua verificação visual.`
  }];

  const usableCandidates = [];
  for (const candidate of candidates) {
    const obj = await env.PRODUCT_IMAGES.get(candidate.image_key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    usableCandidates.push(candidate);
    parts.push({
      text: `CAPA CANDIDATA: CAPA_CODE=${candidate.capa_code}; retrieval_score=${candidate.retrieval_score.toFixed(6)}`
    });
    parts.push({
      inline_data: {
        mime_type: obj.httpMetadata?.contentType || 'image/jpeg',
        data: base64(bytes)
      }
    });
  }

  if (!usableCandidates.length) throw new Error('As imagens candidatas não foram encontradas no R2');

  parts.push({ text: 'FOTO DA CAPA A IDENTIFICAR:' });
  parts.push({
    inline_data: {
      mime_type: uploadedFile.type || 'image/jpeg',
      data: base64(uploadBytes)
    }
  });

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
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
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            matched: { type: 'BOOLEAN' },
            capa_code: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
            reason: { type: 'STRING' }
          },
          required: ['matched', 'capa_code', 'confidence', 'reason']
        }
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini falhou (${response.status})`);
  const payload = await response.json();
  const usage = payload?.usageMetadata || {};
  const promptTokens = Number(usage.promptTokenCount || 0);
  const outputTokens = Number(usage.candidatesTokenCount || 0) + Number(usage.thoughtsTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || (promptTokens + outputTokens));
  await recordUsage(env, {
    generationRequests: 1,
    promptTokens,
    outputTokens,
    totalTokens
  });

  const text = payload.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new Error('Gemini não retornou resultado');

  const result = JSON.parse(text);
  const allowedCodes = new Set(usableCandidates.map(candidate => String(candidate.capa_code).trim().toUpperCase()));
  const selectedCode = String(result?.capa_code || '').trim().toUpperCase();
  if (result?.matched && (!selectedCode || !allowedCodes.has(selectedCode))) {
    return {
      matched: false,
      capa_code: '',
      confidence: 0,
      reason: 'Gemini retornou capa fora do Top-K',
      candidates: usableCandidates
    };
  }

  return { ...result, capa_code: selectedCode, candidates: usableCandidates };
}

async function identifyCoverWithGemini(env, uploadedFile) {
  const { uploadBytes, candidates } = await getTopCoverCandidates(env, uploadedFile, TOP_K_COVERS);
  return verifyCoverWithGemini(env, uploadedFile, uploadBytes, candidates);
}

async function handleIdentify(request, env) {
  await recordUsage(env, { identifyRequests: 1 });
  try {
    const form = await request.formData();
    const image = form.get('image');
    if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);

    const ai = await identifyCoverWithGemini(env, image);
    if (!ai.matched || !ai.capa_code || ai.confidence < 0.85) {
      return json({ error: 'Correspondência visual da capa insuficiente. Tire outra foto.' }, 422);
    }

    const capaCode = String(ai.capa_code).trim().toUpperCase();
    const { results: matches } = await env.DB.prepare(`
      SELECT id,sku FROM products WHERE capa_code=? ORDER BY id ASC
    `).bind(capaCode).all();

    if (!matches?.length) return json({ error: 'A IA identificou uma capa que não existe no banco.' }, 422);
    if (matches.length > 1) {
      return json({
        error: `Capa ${capaCode} identificada, mas existem ${matches.length} SKUs cadastrados com essa mesma capa. Não é possível determinar o SKU apenas pela foto da capa.`
      }, 422);
    }

    const product = await env.DB.prepare(`
      SELECT p.*,
        (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
        (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
      FROM products p
      WHERE p.id=?
      LIMIT 1
    `).bind(matches[0].id).first();

    if (!product) return json({ error: 'Produto não encontrado no banco.' }, 422);

    const parsed = parseSku(product.sku);
    const selectedCandidate = ai.candidates?.find(candidate =>
      String(candidate.capa_code).trim().toUpperCase() === capaCode
    );

    return json({
      product: {
        ...product,
        wireo: parsed.wireo,
        tassel: parsed.tassel,
        elastico: parsed.elastico,
        image_url: product.image_key ? `/api/images/${product.id}` : null
      },
      confidence: ai.confidence,
      retrieval_score: selectedCandidate?.retrieval_score ?? null,
      identified_by: 'capa_embedding_topk+gemini'
    });
  } catch (error) {
    await recordUsage(env, { identifyErrors: 1 });
    return json({ error: error?.message || 'Erro ao identificar produto' }, 400);
  }
}

function normalizeUsage(row) {
  return {
    identify_requests: Number(row?.identify_requests || 0),
    identify_errors: Number(row?.identify_errors || 0),
    embedding_requests: Number(row?.embedding_requests || 0),
    generation_requests: Number(row?.generation_requests || 0),
    prompt_tokens: Number(row?.prompt_tokens || 0),
    output_tokens: Number(row?.output_tokens || 0),
    total_tokens: Number(row?.total_tokens || 0)
  };
}

async function handleSystemMetrics(env) {
  await ensureUsageTable(env);

  const productsProbe = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN image_key IS NOT NULL THEN 1 ELSE 0 END) AS with_image
    FROM products
  `).all();
  const productStats = productsProbe.results?.[0] || {};
  const sizeBytes = Number(productsProbe.meta?.size_after || 0);

  const embeddingStats = await env.DB.prepare(`SELECT COUNT(*) AS total FROM cover_embeddings`).first();
  const today = saoPauloDay();
  const usageToday = normalizeUsage(await env.DB.prepare(`SELECT * FROM ai_usage_daily WHERE day=?`).bind(today).first());
  const usageTotal = normalizeUsage(await env.DB.prepare(`
    SELECT
      SUM(identify_requests) AS identify_requests,
      SUM(identify_errors) AS identify_errors,
      SUM(embedding_requests) AS embedding_requests,
      SUM(generation_requests) AS generation_requests,
      SUM(prompt_tokens) AS prompt_tokens,
      SUM(output_tokens) AS output_tokens,
      SUM(total_tokens) AS total_tokens
    FROM ai_usage_daily
  `).first());
  const firstUsage = await env.DB.prepare(`SELECT MIN(day) AS day FROM ai_usage_daily`).first();

  const configuredLimitMb = Number(env.D1_DATABASE_LIMIT_MB || 0);
  const configuredLimitBytes = configuredLimitMb > 0 ? Math.round(configuredLimitMb * 1024 * 1024) : null;
  const freePercent = sizeBytes ? (sizeBytes / FREE_D1_LIMIT_BYTES) * 100 : 0;
  const configuredPercent = configuredLimitBytes && sizeBytes ? (sizeBytes / configuredLimitBytes) * 100 : null;
  const avgTokens = usageToday.identify_requests > 0
    ? Math.round(usageToday.total_tokens / usageToday.identify_requests)
    : 0;

  return json({
    ok: true,
    measured_at: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    database: {
      status: 'online',
      used_bytes: sizeBytes,
      products: Number(productStats.total || 0),
      products_with_image: Number(productStats.with_image || 0),
      cover_embeddings: Number(embeddingStats?.total || 0),
      configured_limit_bytes: configuredLimitBytes,
      configured_percent: configuredPercent,
      documented_limits: {
        workers_free_bytes: FREE_D1_LIMIT_BYTES,
        workers_paid_bytes: PAID_D1_LIMIT_BYTES
      },
      percent_of_free_limit: freePercent,
      plan_detected: false,
      plan_note: 'O Worker não recebe da Cloudflare qual é o plano da conta. O painel mostra o uso real e os dois limites oficiais.'
    },
    gemini: {
      configured: Boolean(env.GEMINI_API_KEY),
      model: env.GEMINI_MODEL || 'gemini-3.5-flash',
      embedding_model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
      today: usageToday,
      since_monitoring: usageTotal,
      monitoring_started_on: firstUsage?.day || today,
      average_tokens_per_identification_today: avgTokens,
      active_quota_available_via_api: false,
      quota_note: 'Os limites ativos de RPM, TPM e RPD do projeto não são retornados pela API key. Eles precisam ser conferidos no Google AI Studio.'
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/identify' && request.method === 'POST') {
      return handleIdentify(request, env);
    }

    if (url.pathname === '/api/admin/system-metrics' && request.method === 'GET') {
      try {
        return await handleSystemMetrics(env);
      } catch (error) {
        return json({ error: error?.message || 'Falha ao ler métricas do sistema' }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
