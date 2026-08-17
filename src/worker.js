import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const BULK_IMPORT_LIMIT = 100;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
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
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
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
  return { model, values };
}

async function upsertCoverEmbedding(env, capaCode, imageKey, bytes, mimeType) {
  const { model, values } = await embedImage(env, bytes, mimeType);
  await env.DB.prepare(`
    INSERT INTO cover_embeddings (capa_code,image_key,embedding_model,dimensions,embedding_json,updated_at)
    VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(capa_code) DO UPDATE SET
      image_key=excluded.image_key,
      embedding_model=excluded.embedding_model,
      dimensions=excluded.dimensions,
      embedding_json=excluded.embedding_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(capaCode, imageKey, model, values.length, JSON.stringify(values)).run();
  return values;
}

async function getTopCoverCandidates(env, uploadedFile, limit = TOP_K_COVERS) {
  const uploadBytes = new Uint8Array(await uploadedFile.arrayBuffer());
  const { values: queryEmbedding } = await embedImage(env, uploadBytes, uploadedFile.type || 'image/jpeg');
  const { results } = await env.DB.prepare(`
    SELECT capa_code,image_key,embedding_model,dimensions,embedding_json
    FROM cover_embeddings
  `).all();

  if (!results?.length) throw new Error('Índice visual vazio. Indexe as imagens das capas antes de identificar.');

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
    } catch {
      // Ignora registros de índice corrompidos; podem ser refeitos pelo reindexador.
    }
  }

  scored.sort((a, b) => b.retrieval_score - a.retrieval_score);
  return { uploadBytes, candidates: scored.slice(0, Math.max(1, limit)) };
}

async function verifyCoverWithGemini(env, uploadedFile, uploadBytes, candidates) {
  if (!candidates.length) throw new Error('Nenhuma capa candidata encontrada no índice visual');

  const parts = [{ text: `Você é o verificador visual interno da NISTI PRINT. A FOTO DA EXPEDIÇÃO mostra somente a capa do produto, que pode estar solta, sem Wire-O, tassel ou elástico. Compare somente a ARTE-BASE DA CAPA com as CAPAS CANDIDATAS abaixo. Ignore nomes personalizados impressos, acabamento, miolo, plataforma e acessórios. Escolha somente um CAPA_CODE da lista se a correspondência visual for forte. Se nenhuma candidata corresponder com segurança, responda matched=false e capa_code="". Os retrieval_score servem apenas como pré-seleção e não substituem sua verificação visual.` }];

  const usableCandidates = [];
  for (const candidate of candidates) {
    const obj = await env.PRODUCT_IMAGES.get(candidate.image_key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    usableCandidates.push(candidate);
    parts.push({ text: `CAPA CANDIDATA: CAPA_CODE=${candidate.capa_code}; retrieval_score=${candidate.retrieval_score.toFixed(6)}` });
    parts.push({ inline_data: { mime_type: obj.httpMetadata?.contentType || 'image/jpeg', data: base64(bytes) } });
  }

  if (!usableCandidates.length) throw new Error('As imagens candidatas não foram encontradas no R2');

  parts.push({ text: 'FOTO DA CAPA A IDENTIFICAR:' });
  parts.push({ inline_data: { mime_type: uploadedFile.type || 'image/jpeg', data: base64(uploadBytes) } });

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
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
  const text = payload.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  if (!text) throw new Error('Gemini não retornou resultado');
  const result = JSON.parse(text);
  const allowedCodes = new Set(usableCandidates.map(c => String(c.capa_code).trim().toUpperCase()));
  const selectedCode = String(result?.capa_code || '').trim().toUpperCase();
  if (result?.matched && (!selectedCode || !allowedCodes.has(selectedCode))) {
    return { matched: false, capa_code: '', confidence: 0, reason: 'Gemini retornou capa fora do Top-K', candidates: usableCandidates };
  }
  return { ...result, capa_code: selectedCode, candidates: usableCandidates };
}

async function identifyCoverWithGemini(env, uploadedFile) {
  const { uploadBytes, candidates } = await getTopCoverCandidates(env, uploadedFile, TOP_K_COVERS);
  return verifyCoverWithGemini(env, uploadedFile, uploadBytes, candidates);
}

async function saveProductImage(env, id, fileBytes, contentType) {
  const product = await env.DB.prepare(`SELECT id,capa_code,image_key FROM products WHERE id=?`).bind(id).first();
  if (!product) throw new Error('Produto não encontrado');

  const key = `products/${id}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key, fileBytes, { httpMetadata: { contentType } });
  await env.DB.prepare(`UPDATE products SET image_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(key, id).run();

  let indexed = false;
  let index_error = null;
  try {
    await upsertCoverEmbedding(env, product.capa_code, key, new Uint8Array(fileBytes), contentType);
    indexed = true;
  } catch (error) {
    index_error = error?.message || 'Falha ao indexar capa';
  }

  if (product.image_key && product.image_key !== key) {
    await env.PRODUCT_IMAGES.delete(product.image_key).catch(() => {});
  }

  return { key, indexed, index_error };
}

async function upsertCatalogProduct(env, row) {
  const parsed = parseSku(row?.sku);
  const nome = clean(row?.nome);
  const variacao = clean(row?.variacao);
  const platform = clean(row?.platform)?.toUpperCase() || null;
  const link = clean(row?.link);

  let product = await env.DB.prepare(`SELECT id,image_key FROM products WHERE sku=?`).bind(parsed.sku).first();
  let created = false;

  if (!product) {
    const result = await env.DB.prepare(`
      INSERT INTO products (sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
      parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode, nome, variacao
    ).run();
    product = { id: result.meta.last_row_id, image_key: null };
    created = true;
  } else {
    await env.DB.prepare(`
      UPDATE products SET
        miolo_code=?,capa_code=?,acabamento_code=?,wireo_code=?,tassel_code=?,elastico_code=?,
        nome=COALESCE(?,nome),variacao=COALESCE(?,variacao),updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
      parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode,
      nome, variacao, product.id
    ).run();
  }

  if (platform) {
    const existingPlatform = await env.DB.prepare(`
      SELECT id FROM product_platforms WHERE product_id=? AND platform=? ORDER BY id ASC LIMIT 1
    `).bind(product.id, platform).first();
    if (existingPlatform) {
      if (link) await env.DB.prepare(`UPDATE product_platforms SET link=? WHERE id=?`).bind(link, existingPlatform.id).run();
    } else {
      await env.DB.prepare(`INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)`).bind(product.id, platform, link).run();
    }
  }

  return { id: product.id, sku: parsed.sku, capa_code: parsed.capaCode, created, has_image: Boolean(product.image_key) };
}

function isAllowedMarketplaceHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'shopee.com.br' || host.endsWith('.shopee.com.br') || host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br');
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMetaContent(html, key) {
  const escaped = escapeRegex(key);
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlAttr(match[1]);
  }
  return null;
}

async function previewMarketplaceListing(listingUrl) {
  let target;
  try {
    target = new URL(listingUrl);
  } catch {
    throw new Error('Link do anúncio inválido');
  }
  if (target.protocol !== 'https:' || !isAllowedMarketplaceHost(target.hostname)) {
    throw new Error('Prévia permitida apenas para links HTTPS da Shopee ou Mercado Livre');
  }

  const response = await fetch(target.toString(), {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; NISTI-Identificacao/1.0; +https://nisti.app)',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7'
    }
  });
  if (!response.ok) throw new Error(`Anúncio não pôde ser aberto (${response.status})`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('O link do anúncio não retornou HTML');
  const html = await response.text();
  const title = extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title') || null;
  const imageCandidates = [
    extractMetaContent(html, 'og:image'),
    extractMetaContent(html, 'og:image:secure_url'),
    extractMetaContent(html, 'twitter:image')
  ].filter(Boolean);

  return {
    listing_url: target.toString(),
    title,
    image_candidates: [...new Set(imageCandidates)].slice(0, 5)
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, service: 'nisti-identificacao' });

      if (url.pathname === '/api/sku/parse' && request.method === 'POST') {
        const { sku } = await request.json();
        return json(parseSku(sku));
      }

      if (url.pathname === '/api/products' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,p.wireo_code,p.tassel_code,p.elastico_code,
                 p.nome,p.variacao,p.image_key,p.created_at,
                 (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
                 (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
          FROM products p
          ORDER BY p.id DESC
          LIMIT 1000
        `).all();
        return json({ products: (results || []).map(p => ({ ...p, image_url: p.image_key ? `/api/images/${p.id}` : null })) });
      }

      if (url.pathname === '/api/products' && request.method === 'POST') {
        const body = await request.json();
        const parsed = parseSku(body.sku);
        const result = await env.DB.prepare(`INSERT INTO products (sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao) VALUES (?,?,?,?,?,?,?,?,?)`).bind(parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode, parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode, body.nome || null, body.variacao || null).run();
        const id = result.meta.last_row_id;
        if (body.platform) await env.DB.prepare(`INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)`).bind(id, String(body.platform).trim().toUpperCase(), body.link || null).run();
        return json({ ok: true, id, parsed }, 201);
      }

      if (url.pathname === '/api/admin/bulk-products' && request.method === 'POST') {
        const body = await request.json();
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (!rows.length) return json({ error: 'Envie rows com pelo menos um produto' }, 400);
        if (rows.length > BULK_IMPORT_LIMIT) return json({ error: `Máximo de ${BULK_IMPORT_LIMIT} produtos por lote` }, 400);

        const imported = [];
        const errors = [];
        for (let i = 0; i < rows.length; i++) {
          try {
            imported.push({ row: i + 1, ...(await upsertCatalogProduct(env, rows[i])) });
          } catch (error) {
            errors.push({ row: i + 1, sku: clean(rows[i]?.sku), error: error?.message || 'Falha ao importar' });
          }
        }
        return json({
          ok: errors.length === 0,
          received: rows.length,
          created: imported.filter(item => item.created).length,
          updated: imported.filter(item => !item.created).length,
          imported,
          errors
        });
      }

      if (url.pathname === '/api/admin/listing-preview' && request.method === 'POST') {
        const body = await request.json();
        return json(await previewMarketplaceListing(body?.url));
      }

      const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
      if (imageUpload && request.method === 'POST') {
        const id = Number(imageUpload[1]);
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error: 'Imagem obrigatória' }, 400);
        if (!file.type.startsWith('image/')) return json({ error: 'Arquivo deve ser uma imagem' }, 400);
        const bytes = await file.arrayBuffer();
        const saved = await saveProductImage(env, id, bytes, file.type);
        return json({
          ok: true,
          image_url: `/api/images/${id}`,
          embedding_indexed: saved.indexed,
          embedding_error: saved.index_error
        });
      }

      const imageFromUrl = url.pathname.match(/^\/api\/products\/(\d+)\/image-from-url$/);
      if (imageFromUrl && request.method === 'POST') {
        const id = Number(imageFromUrl[1]);
        const body = await request.json();
        let sourceUrl;
        try {
          sourceUrl = new URL(body.image_url);
        } catch {
          return json({ error: 'image_url inválida' }, 400);
        }
        if (sourceUrl.protocol !== 'https:') return json({ error: 'A imagem deve usar HTTPS' }, 400);
        const response = await fetch(sourceUrl.toString(), {
          headers: { 'user-agent': 'NISTI-Identificacao/1.0' }
        });
        if (!response.ok) return json({ error: `Não foi possível baixar a imagem (${response.status})` }, 400);
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return json({ error: 'O endereço não retornou uma imagem' }, 400);
        const bytes = await response.arrayBuffer();
        const saved = await saveProductImage(env, id, bytes, contentType);
        return json({
          ok: true,
          image_url: `/api/images/${id}`,
          embedding_indexed: saved.indexed,
          embedding_error: saved.index_error
        });
      }

      const imageGet = url.pathname.match(/^\/api\/images\/(\d+)$/);
      if (imageGet && request.method === 'GET') {
        const product = await env.DB.prepare(`SELECT image_key FROM products WHERE id=?`).bind(Number(imageGet[1])).first();
        if (!product?.image_key) return new Response('Not found', { status: 404 });
        const object = await env.PRODUCT_IMAGES.get(product.image_key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('cache-control', 'private, max-age=3600');
        return new Response(object.body, { headers });
      }

      if (url.pathname === '/api/admin/cover-index' && request.method === 'GET') {
        const refs = await env.DB.prepare(`SELECT COUNT(DISTINCT capa_code) AS total FROM products WHERE image_key IS NOT NULL`).first();
        const indexed = await env.DB.prepare(`SELECT COUNT(*) AS total FROM cover_embeddings`).first();
        const pending = await env.DB.prepare(`
          SELECT COUNT(*) AS total FROM (
            SELECT p.capa_code,p.image_key
            FROM products p
            JOIN (
              SELECT capa_code,MAX(id) AS id
              FROM products
              WHERE image_key IS NOT NULL
              GROUP BY capa_code
            ) latest ON latest.id=p.id
            LEFT JOIN cover_embeddings ce ON ce.capa_code=p.capa_code AND ce.image_key=p.image_key
            WHERE ce.capa_code IS NULL
          )
        `).first();
        return json({
          reference_covers: Number(refs?.total || 0),
          indexed_covers: Number(indexed?.total || 0),
          pending_covers: Number(pending?.total || 0),
          embedding_model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
          embedding_dimensions: EMBEDDING_DIMENSIONS,
          top_k: TOP_K_COVERS
        });
      }

      if (url.pathname === '/api/admin/reindex-cover-embeddings' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const limit = Math.max(1, Math.min(10, Number(body.limit) || 6));
        const { results } = await env.DB.prepare(`
          SELECT p.id,p.capa_code,p.image_key
          FROM products p
          JOIN (
            SELECT capa_code,MAX(id) AS id
            FROM products
            WHERE image_key IS NOT NULL
            GROUP BY capa_code
          ) latest ON latest.id=p.id
          LEFT JOIN cover_embeddings ce ON ce.capa_code=p.capa_code AND ce.image_key=p.image_key
          WHERE ce.capa_code IS NULL
          ORDER BY p.id ASC
          LIMIT ?
        `).bind(limit).all();

        const processed = [];
        const errors = [];
        for (const product of results || []) {
          try {
            const obj = await env.PRODUCT_IMAGES.get(product.image_key);
            if (!obj) throw new Error('Imagem não encontrada no R2');
            const bytes = new Uint8Array(await obj.arrayBuffer());
            await upsertCoverEmbedding(env, product.capa_code, product.image_key, bytes, obj.httpMetadata?.contentType || 'image/jpeg');
            processed.push(product.capa_code);
          } catch (error) {
            errors.push({ capa_code: product.capa_code, error: error?.message || 'Falha ao indexar' });
          }
        }

        const pending = await env.DB.prepare(`
          SELECT COUNT(*) AS total FROM (
            SELECT p.capa_code
            FROM products p
            JOIN (
              SELECT capa_code,MAX(id) AS id
              FROM products
              WHERE image_key IS NOT NULL
              GROUP BY capa_code
            ) latest ON latest.id=p.id
            LEFT JOIN cover_embeddings ce ON ce.capa_code=p.capa_code AND ce.image_key=p.image_key
            WHERE ce.capa_code IS NULL
          )
        `).first();

        return json({ ok: errors.length === 0, processed, errors, pending_covers: Number(pending?.total || 0) });
      }

      if (url.pathname === '/api/identify' && request.method === 'POST') {
        const form = await request.formData();
        const image = form.get('image');
        if (!(image instanceof File)) return json({ error: 'Foto da capa obrigatória' }, 400);

        const ai = await identifyCoverWithGemini(env, image);
        if (!ai.matched || !ai.capa_code || ai.confidence < 0.85) {
          return json({ error: 'Correspondência visual da capa insuficiente. Tire outra foto.' }, 422);
        }

        const capaCode = String(ai.capa_code).trim().toUpperCase();
        const { results: matches } = await env.DB.prepare(`SELECT id, sku FROM products WHERE capa_code=? ORDER BY id ASC`).bind(capaCode).all();

        if (!matches?.length) {
          return json({ error: 'A IA identificou uma capa que não existe no banco.' }, 422);
        }

        if (matches.length > 1) {
          return json({
            error: `Capa ${capaCode} identificada, mas existem ${matches.length} SKUs cadastrados com essa mesma capa. Não é possível determinar o SKU apenas pela foto da capa.`
          }, 422);
        }

        const product = await env.DB.prepare(`
          SELECT p.*,
                 (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
                 (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
          FROM products p WHERE p.id=? LIMIT 1
        `).bind(matches[0].id).first();
        if (!product) return json({ error: 'Produto não encontrado no banco.' }, 422);

        const parsed = parseSku(product.sku);
        const selectedCandidate = ai.candidates?.find(c => String(c.capa_code).trim().toUpperCase() === capaCode);
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
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const msg = error?.message || 'Erro interno';
      const status = /UNIQUE constraint/i.test(msg) ? 409 : 400;
      return json({ error: msg }, status);
    }
  }
};
