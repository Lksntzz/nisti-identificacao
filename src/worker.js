import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const BULK_IMPORT_LIMIT = 100;
const COVER_REVIEW_PAGE_SIZE = 12;
const MAX_LISTING_IMAGES = 30;
const MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

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

function isAllowedMarketplaceImageHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host.endsWith('.susercontent.com') ||
    host === 'susercontent.com' ||
    host.endsWith('.shopee.com.br') ||
    host === 'shopee.com.br' ||
    host.endsWith('.mlstatic.com') ||
    host === 'mlstatic.com' ||
    host.endsWith('.mercadolivre.com.br') ||
    host === 'mercadolivre.com.br';
}

function decodeHtmlAttr(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function decodeSerializedUrl(value) {
  return decodeHtmlAttr(String(value || ''))
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .trim();
}

function normalizeMarketplaceImageUrl(value) {
  let text = decodeSerializedUrl(value);
  if (!text) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  if (!text.startsWith('https://')) return null;
  try {
    const parsed = new URL(text);
    if (!isAllowedMarketplaceImageHost(parsed.hostname)) return null;
    const host = parsed.hostname.toLowerCase();
    const isImageCdn = host.endsWith('.susercontent.com') || host === 'susercontent.com' || host.endsWith('.mlstatic.com') || host === 'mlstatic.com';
    if (!isImageCdn && !/\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractAllMetaContents(html, key) {
  const out = [];
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (String(property || '').toLowerCase() !== String(key).toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) out.push(decodeHtmlAttr(content));
  }
  return out;
}

function collectJsonImages(value, output, depth = 0) {
  if (depth > 12 || output.size >= MAX_LISTING_IMAGES) return;
  if (typeof value === 'string') {
    const normalized = normalizeMarketplaceImageUrl(value);
    if (normalized) output.add(normalized);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonImages(item, output, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/image|picture|thumbnail|photo/i.test(key) || typeof item === 'object') {
        collectJsonImages(item, output, depth + 1);
      }
    }
  }
}

function extractJsonScriptImages(html, output) {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    if (output.size >= MAX_LISTING_IMAGES) break;
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (!body || body.length > 4_000_000) continue;
    if (/application\/ld\+json/i.test(script) || body.startsWith('{') || body.startsWith('[')) {
      try {
        collectJsonImages(JSON.parse(body), output);
      } catch {
        // Muitos marketplaces serializam estado JS que não é JSON estrito.
      }
    }
  }
}

function extractEmbeddedMarketplaceImages(html, output) {
  const decoded = decodeSerializedUrl(html);
  const urlRegex = /https:\/\/[^"'<>\\\s]+/gi;
  let match;
  while ((match = urlRegex.exec(decoded)) && output.size < MAX_LISTING_IMAGES) {
    const normalized = normalizeMarketplaceImageUrl(match[0]);
    if (normalized) output.add(normalized);
  }
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
      'user-agent': 'Mozilla/5.0 (compatible; NISTI-Identificacao/1.0)',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7'
    }
  });
  if (!response.ok) throw new Error(`Anúncio não pôde ser aberto (${response.status})`);
  const finalUrl = new URL(response.url || target.toString());
  if (!isAllowedMarketplaceHost(finalUrl.hostname)) throw new Error('O anúncio redirecionou para um domínio não permitido');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('O link do anúncio não retornou HTML');
  const html = await response.text();

  const title = extractAllMetaContents(html, 'og:title')[0] ||
    extractAllMetaContents(html, 'twitter:title')[0] ||
    null;

  const images = new Set();
  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
    for (const candidate of extractAllMetaContents(html, key)) {
      const normalized = normalizeMarketplaceImageUrl(candidate);
      if (normalized) images.add(normalized);
    }
  }
  extractJsonScriptImages(html, images);
  extractEmbeddedMarketplaceImages(html, images);

  return {
    listing_url: finalUrl.toString(),
    title,
    image_candidates: [...images].slice(0, MAX_LISTING_IMAGES)
  };
}

async function listCoverReviews(env, status, limit, offset) {
  const { results } = await env.DB.prepare(`
    SELECT p.id,p.sku,p.capa_code,p.nome,p.variacao,p.image_key,pp.platform,pp.link
    FROM products p
    LEFT JOIN product_platforms pp ON pp.product_id=p.id
    ORDER BY p.capa_code ASC,p.id ASC,pp.id ASC
  `).all();

  const grouped = new Map();
  for (const row of results || []) {
    const code = String(row.capa_code || '').trim().toUpperCase();
    if (!code) continue;
    if (!grouped.has(code)) {
      grouped.set(code, {
        capa_code: code,
        representative_id: row.id,
        image_url: null,
        sku_count: 0,
        skus: [],
        nome: row.nome || null,
        variacoes: [],
        links: [],
        _productIds: new Set(),
        _linkKeys: new Set()
      });
    }
    const cover = grouped.get(code);
    if (!cover._productIds.has(row.id)) {
      cover._productIds.add(row.id);
      cover.sku_count += 1;
      if (cover.skus.length < 8) cover.skus.push(row.sku);
      if (row.variacao && cover.variacoes.length < 8 && !cover.variacoes.includes(row.variacao)) cover.variacoes.push(row.variacao);
      if (row.image_key && !cover.image_url) {
        cover.representative_id = row.id;
        cover.image_url = `/api/images/${row.id}`;
      }
    }
    if (row.link) {
      const key = `${String(row.platform || '').toUpperCase()}|${row.link}`;
      if (!cover._linkKeys.has(key)) {
        cover._linkKeys.add(key);
        cover.links.push({ platform: row.platform || null, url: row.link });
      }
    }
  }

  const covers = [...grouped.values()].map(cover => {
    delete cover._productIds;
    delete cover._linkKeys;
    return cover;
  });
  const pending = covers.filter(cover => !cover.image_url);
  const ready = covers.filter(cover => cover.image_url);
  const selected = status === 'ready' ? ready : status === 'all' ? covers : pending;
  return {
    total_covers: covers.length,
    pending_covers: pending.length,
    ready_covers: ready.length,
    covers: selected.slice(offset, offset + limit)
  };
}

async function downloadMarketplaceImage(imageUrl) {
  let source;
  try {
    source = new URL(imageUrl);
  } catch {
    throw new Error('URL da imagem inválida');
  }
  if (source.protocol !== 'https:' || !isAllowedMarketplaceImageHost(source.hostname)) {
    throw new Error('A imagem precisa vir de um CDN permitido da Shopee ou Mercado Livre');
  }

  const response = await fetch(source.toString(), {
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; NISTI-Identificacao/1.0)' }
  });
  if (!response.ok) throw new Error(`Não foi possível baixar a imagem (${response.status})`);
  const finalUrl = new URL(response.url || source.toString());
  if (!isAllowedMarketplaceImageHost(finalUrl.hostname)) throw new Error('A imagem redirecionou para um domínio não permitido');

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('O endereço selecionado não retornou uma imagem');
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > MAX_REMOTE_IMAGE_BYTES) throw new Error('Imagem maior que 8 MB');

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('Imagem maior que 8 MB');
  return { bytes, contentType, finalUrl: finalUrl.toString() };
}

async function saveCoverImageFromUrl(env, capaCode, imageUrl) {
  const code = String(capaCode || '').trim().toUpperCase();
  if (!code) throw new Error('CAPA_CODE obrigatório');

  const { results: products } = await env.DB.prepare(`
    SELECT id,image_key FROM products WHERE capa_code=? ORDER BY id ASC
  `).bind(code).all();
  if (!products?.length) throw new Error(`Capa ${code} não encontrada no catálogo`);

  const previousKeys = [...new Set(products.map(item => item.image_key).filter(Boolean))];
  const downloaded = await downloadMarketplaceImage(imageUrl);
  const key = `covers/${encodeURIComponent(code)}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key, downloaded.bytes, { httpMetadata: { contentType: downloaded.contentType } });
  await env.DB.prepare(`
    UPDATE products SET image_key=?, updated_at=CURRENT_TIMESTAMP WHERE capa_code=?
  `).bind(key, code).run();

  let indexed = false;
  let index_error = null;
  try {
    await upsertCoverEmbedding(env, code, key, new Uint8Array(downloaded.bytes), downloaded.contentType);
    indexed = true;
  } catch (error) {
    index_error = error?.message || 'Falha ao indexar capa';
  }

  for (const oldKey of previousKeys) {
    if (oldKey !== key) await env.PRODUCT_IMAGES.delete(oldKey).catch(() => {});
  }

  return {
    capa_code: code,
    image_url: `/api/images/${products[0].id}`,
    updated_products: products.length,
    source_url: downloaded.finalUrl,
    embedding_indexed: indexed,
    embedding_error: index_error
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

      if (url.pathname === '/api/admin/cover-reviews' && request.method === 'GET') {
        const status = ['pending', 'ready', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
        const limit = Math.max(1, Math.min(30, Number(url.searchParams.get('limit')) || COVER_REVIEW_PAGE_SIZE));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
        return json(await listCoverReviews(env, status, limit, offset));
      }

      const coverImageFromUrl = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/image-from-url$/);
      if (coverImageFromUrl && request.method === 'POST') {
        const capaCode = decodeURIComponent(coverImageFromUrl[1]);
        const body = await request.json();
        return json({ ok: true, ...(await saveCoverImageFromUrl(env, capaCode, body?.image_url)) });
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
        const downloaded = await downloadMarketplaceImage(body?.image_url);
        const saved = await saveProductImage(env, id, downloaded.bytes, downloaded.contentType);
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
