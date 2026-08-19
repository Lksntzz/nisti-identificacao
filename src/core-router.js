import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_REFERENCES = 24;
const BULK_IMPORT_LIMIT = 100;
const EXTRA_REFERENCE_LIMIT = 6;
const MAX_REFERENCE_UPLOAD_BYTES = 10 * 1024 * 1024;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeCapaCode(value) {
  return String(value || '').trim().toUpperCase();
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function referenceImageUrl(reference) {
  if (!reference?.id || !reference?.image_key) return null;
  const version = String(reference.image_key).split('/').pop() || 'current';
  return `/api/reference-images/${reference.id}?v=${encodeURIComponent(version)}`;
}

async function embedImage(env, bytes, mimeType) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
    {
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
    }
  );
  if (!response.ok) throw new Error(`Gemini Embedding falhou (${response.status})`);
  const payload = await response.json();
  const values = payload?.embedding?.values || payload?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error('Gemini Embedding não retornou vetor válido');
  }
  return { model, values };
}

async function ensureVisualReference(env, {
  capaCode,
  imageKey,
  sourceProductId = null,
  referenceKind = 'product'
}) {
  const code = normalizeCapaCode(capaCode);
  if (!code || !imageKey) throw new Error('Referência visual inválida');

  await env.DB.prepare(`
    INSERT INTO cover_visual_references (
      capa_code,image_key,source_product_id,reference_kind,active,updated_at
    ) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(capa_code,image_key) DO UPDATE SET
      source_product_id=COALESCE(excluded.source_product_id,cover_visual_references.source_product_id),
      reference_kind=excluded.reference_kind,
      active=1,
      updated_at=CURRENT_TIMESTAMP
  `).bind(code, imageKey, sourceProductId, referenceKind).run();

  return env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind,active,created_at,updated_at
    FROM cover_visual_references
    WHERE capa_code=? AND image_key=?
    LIMIT 1
  `).bind(code, imageKey).first();
}

async function storeReferenceEmbedding(env, reference, bytes, mimeType) {
  if (!reference?.id) throw new Error('Referência visual não encontrada');
  const { model, values } = await embedImage(env, bytes, mimeType);

  await env.DB.prepare(`
    INSERT INTO cover_reference_embeddings (
      reference_id,embedding_model,dimensions,embedding_json,updated_at
    ) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(reference_id) DO UPDATE SET
      embedding_model=excluded.embedding_model,
      dimensions=excluded.dimensions,
      embedding_json=excluded.embedding_json,
      updated_at=CURRENT_TIMESTAMP
  `).bind(reference.id, model, values.length, JSON.stringify(values)).run();

  // Compatibilidade temporária com os módulos legados. O pipeline novo usa
  // cover_visual_references + cover_reference_embeddings, mas manter um vetor
  // principal por capa evita regressão nos fallbacks antigos durante a migração.
  if (reference.reference_kind === 'product') {
    await env.DB.prepare(`
      INSERT INTO cover_embeddings (
        capa_code,image_key,embedding_model,dimensions,embedding_json,updated_at
      ) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(capa_code) DO UPDATE SET
        image_key=excluded.image_key,
        embedding_model=excluded.embedding_model,
        dimensions=excluded.dimensions,
        embedding_json=excluded.embedding_json,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      reference.capa_code,
      reference.image_key,
      model,
      values.length,
      JSON.stringify(values)
    ).run();
  }

  return { model, values };
}

async function cleanupStaleProductReferences(env, productId, keepImageKey) {
  const { results } = await env.DB.prepare(`
    SELECT id,image_key
    FROM cover_visual_references
    WHERE source_product_id=? AND image_key<>?
  `).bind(productId, keepImageKey).all();

  const removed = [];
  for (const row of results || []) {
    await env.DB.prepare('DELETE FROM cover_reference_embeddings WHERE reference_id=?')
      .bind(row.id).run();
    await env.DB.prepare('DELETE FROM cover_visual_references WHERE id=?')
      .bind(row.id).run();
    removed.push({ id: Number(row.id), image_key: row.image_key });
  }
  return removed;
}

async function saveProductImage(env, id, fileBytes, contentType) {
  const product = await env.DB.prepare(`
    SELECT id,capa_code,image_key FROM products WHERE id=?
  `).bind(id).first();
  if (!product) throw new Error('Produto não encontrado');

  const key = `products/${id}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key, fileBytes, { httpMetadata: { contentType } });
  await env.DB.prepare(`
    UPDATE products SET image_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).bind(key, id).run();

  const reference = await ensureVisualReference(env, {
    capaCode: product.capa_code,
    imageKey: key,
    sourceProductId: id,
    referenceKind: 'product'
  });

  let indexed = false;
  let indexError = null;
  let removedReferences = [];
  try {
    await storeReferenceEmbedding(env, reference, new Uint8Array(fileBytes), contentType);
    indexed = true;
    removedReferences = await cleanupStaleProductReferences(env, id, key);
    for (const stale of removedReferences) {
      if (stale.image_key && stale.image_key !== key) {
        await env.PRODUCT_IMAGES.delete(stale.image_key).catch(() => {});
      }
    }
  } catch (error) {
    indexError = error?.message || 'Falha ao indexar capa';
    // A referência nova fica pendente para /api/admin/reindex-cover-embeddings.
    // Mantemos a referência anterior ativa até a nova ser indexada com sucesso.
  }

  return {
    indexed,
    index_error: indexError,
    reference_id: Number(reference?.id || 0),
    removed_reference_ids: removedReferences.map(item => Number(item.id))
  };
}

async function upsertCatalogProduct(env, row) {
  const parsed = parseSku(row?.sku);
  const nome = clean(row?.nome);
  const variacao = clean(row?.variacao);
  const platform = clean(row?.platform)?.toUpperCase() || null;
  const link = clean(row?.link);

  let product = await env.DB.prepare(`SELECT id,image_key FROM products WHERE sku=?`)
    .bind(parsed.sku).first();
  let created = false;

  if (!product) {
    const result = await env.DB.prepare(`
      INSERT INTO products (
        sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao
      ) VALUES (?,?,?,?,?,?,?,?,?)
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
    const existing = await env.DB.prepare(`
      SELECT id FROM product_platforms
      WHERE product_id=? AND platform=? ORDER BY id ASC LIMIT 1
    `).bind(product.id, platform).first();
    if (existing) {
      if (link) {
        await env.DB.prepare(`UPDATE product_platforms SET link=? WHERE id=?`)
          .bind(link, existing.id).run();
      }
    } else {
      await env.DB.prepare(`
        INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)
      `).bind(product.id, platform, link).run();
    }
  }

  return {
    id: product.id,
    sku: parsed.sku,
    capa_code: parsed.capaCode,
    created,
    has_image: Boolean(product.image_key)
  };
}

async function listCoverReferences(env, capaCode) {
  const { results } = await env.DB.prepare(`
    SELECT
      r.id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,r.active,
      r.created_at,r.updated_at,
      e.embedding_model,e.dimensions,e.updated_at AS embedding_updated_at
    FROM cover_visual_references r
    LEFT JOIN cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.capa_code=? AND r.active=1
    ORDER BY CASE WHEN r.reference_kind='product' THEN 0 ELSE 1 END, r.id ASC
  `).bind(normalizeCapaCode(capaCode)).all();

  return (results || []).map(reference => ({
    ...reference,
    id: Number(reference.id),
    source_product_id: reference.source_product_id ? Number(reference.source_product_id) : null,
    indexed: Number(reference.dimensions || 0) === EMBEDDING_DIMENSIONS,
    image_url: referenceImageUrl(reference)
  }));
}

async function addCoverReference(env, capaCode, file, kind) {
  const code = normalizeCapaCode(capaCode);
  const exists = await env.DB.prepare(`SELECT id FROM products WHERE capa_code=? LIMIT 1`)
    .bind(code).first();
  if (!exists) throw new Error('CAPA_CODE não encontrado no catálogo');

  if (!(file instanceof File)) throw new Error('Imagem de referência obrigatória');
  if (!String(file.type || '').startsWith('image/')) throw new Error('Arquivo deve ser uma imagem');
  if (Number(file.size || 0) > MAX_REFERENCE_UPLOAD_BYTES) {
    throw new Error('Imagem de referência excede 10 MB');
  }

  const extraCount = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM cover_visual_references
    WHERE capa_code=? AND active=1 AND reference_kind<>'product'
  `).bind(code).first();
  if (Number(extraCount?.total || 0) >= EXTRA_REFERENCE_LIMIT) {
    throw new Error(`Máximo de ${EXTRA_REFERENCE_LIMIT} referências adicionais por capa`);
  }

  const referenceKind = ['real', 'perspective', 'personalized', 'difficult']
    .includes(String(kind || '').trim().toLowerCase())
    ? String(kind).trim().toLowerCase()
    : 'real';

  const key = `cover-references/${encodeURIComponent(code)}/${crypto.randomUUID()}`;
  const bytes = await file.arrayBuffer();
  await env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: file.type || 'image/jpeg' } });

  const reference = await ensureVisualReference(env, {
    capaCode: code,
    imageKey: key,
    sourceProductId: null,
    referenceKind
  });

  let indexed = false;
  let indexError = null;
  try {
    await storeReferenceEmbedding(env, reference, new Uint8Array(bytes), file.type || 'image/jpeg');
    indexed = true;
  } catch (error) {
    indexError = error?.message || 'Falha ao indexar referência';
  }

  return {
    ...reference,
    id: Number(reference.id),
    indexed,
    embedding_error: indexError,
    image_url: referenceImageUrl(reference)
  };
}

async function deleteExtraReference(env, referenceId) {
  const reference = await env.DB.prepare(`
    SELECT id,capa_code,image_key,source_product_id,reference_kind
    FROM cover_visual_references
    WHERE id=? AND active=1
    LIMIT 1
  `).bind(referenceId).first();
  if (!reference) throw new Error('Referência visual não encontrada');
  if (reference.reference_kind === 'product' || reference.source_product_id) {
    throw new Error('A referência principal do produto deve ser alterada pelo mockup do produto');
  }

  await env.DB.prepare('DELETE FROM cover_reference_embeddings WHERE reference_id=?')
    .bind(referenceId).run();
  await env.DB.prepare('DELETE FROM cover_visual_references WHERE id=?')
    .bind(referenceId).run();
  if (reference.image_key) {
    await env.PRODUCT_IMAGES.delete(reference.image_key).catch(() => {});
  }

  return {
    id: Number(reference.id),
    capa_code: normalizeCapaCode(reference.capa_code),
    vector_id: `ref:${Number(reference.id)}`
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'nisti-identificacao' });
      }

      if (url.pathname === '/api/sku/parse' && request.method === 'POST') {
        const { sku } = await request.json();
        return json(parseSku(sku));
      }

      if (url.pathname === '/api/products' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT
            p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,p.wireo_code,
            p.tassel_code,p.elastico_code,p.nome,p.variacao,p.image_key,p.created_at,
            (SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
            (SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link
          FROM products p
          ORDER BY p.id DESC
          LIMIT 1000
        `).all();
        return json({
          products: (results || []).map(product => ({
            ...product,
            image_url: product.image_key ? `/api/images/${product.id}` : null
          }))
        });
      }

      if (url.pathname === '/api/products' && request.method === 'POST') {
        const body = await request.json();
        const parsed = parseSku(body.sku);
        const result = await env.DB.prepare(`
          INSERT INTO products (
            sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao
          ) VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(
          parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode,
          parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode,
          body.nome || null, body.variacao || null
        ).run();
        const id = result.meta.last_row_id;
        if (body.platform) {
          await env.DB.prepare(`
            INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)
          `).bind(id, String(body.platform).trim().toUpperCase(), body.link || null).run();
        }
        return json({ ok: true, id, parsed }, 201);
      }

      if (url.pathname === '/api/admin/bulk-products' && request.method === 'POST') {
        const body = await request.json();
        const rows = Array.isArray(body?.rows) ? body.rows : [];
        if (!rows.length) return json({ error: 'Envie rows com pelo menos um produto' }, 400);
        if (rows.length > BULK_IMPORT_LIMIT) {
          return json({ error: `Máximo de ${BULK_IMPORT_LIMIT} produtos por lote` }, 400);
        }
        const imported = [];
        const errors = [];
        for (let i = 0; i < rows.length; i += 1) {
          try {
            imported.push({ row: i + 1, ...await upsertCatalogProduct(env, rows[i]) });
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

      const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
      if (imageUpload && request.method === 'POST') {
        const id = Number(imageUpload[1]);
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error: 'Imagem obrigatória' }, 400);
        if (!file.type.startsWith('image/')) return json({ error: 'Arquivo deve ser uma imagem' }, 400);
        const saved = await saveProductImage(env, id, await file.arrayBuffer(), file.type);
        return json({
          ok: true,
          image_url: `/api/images/${id}`,
          embedding_indexed: saved.indexed,
          embedding_error: saved.index_error,
          reference_id: saved.reference_id,
          removed_reference_ids: saved.removed_reference_ids
        });
      }

      const imageGet = url.pathname.match(/^\/api\/images\/(\d+)$/);
      if (imageGet && request.method === 'GET') {
        const product = await env.DB.prepare(`SELECT image_key FROM products WHERE id=?`)
          .bind(Number(imageGet[1])).first();
        if (!product?.image_key) return new Response('Not found', { status: 404 });
        const object = await env.PRODUCT_IMAGES.get(product.image_key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body, { headers });
      }

      const referenceImageGet = url.pathname.match(/^\/api\/reference-images\/(\d+)$/);
      if (referenceImageGet && request.method === 'GET') {
        const reference = await env.DB.prepare(`
          SELECT image_key FROM cover_visual_references WHERE id=? AND active=1
        `).bind(Number(referenceImageGet[1])).first();
        if (!reference?.image_key) return new Response('Not found', { status: 404 });
        const object = await env.PRODUCT_IMAGES.get(reference.image_key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set(
          'cache-control',
          url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'private, max-age=300'
        );
        return new Response(object.body, { headers });
      }

      const coverReferences = url.pathname.match(/^\/api\/admin\/covers\/([^/]+)\/references$/);
      if (coverReferences && request.method === 'GET') {
        const capaCode = decodeURIComponent(coverReferences[1]);
        return json({
          ok: true,
          capa_code: normalizeCapaCode(capaCode),
          references: await listCoverReferences(env, capaCode),
          max_extra_references: EXTRA_REFERENCE_LIMIT
        });
      }

      if (coverReferences && request.method === 'POST') {
        const capaCode = decodeURIComponent(coverReferences[1]);
        const form = await request.formData();
        const file = form.get('image');
        const kind = form.get('kind');
        const reference = await addCoverReference(env, capaCode, file, kind);
        return json({ ok: true, reference }, 201);
      }

      const deleteReference = url.pathname.match(/^\/api\/admin\/cover-references\/(\d+)$/);
      if (deleteReference && request.method === 'DELETE') {
        return json({
          ok: true,
          deleted: await deleteExtraReference(env, Number(deleteReference[1]))
        });
      }

      if (url.pathname === '/api/admin/cover-index' && request.method === 'GET') {
        const referenceCovers = await env.DB.prepare(`
          SELECT COUNT(DISTINCT capa_code) AS total FROM products WHERE image_key IS NOT NULL
        `).first();
        const referenceImages = await env.DB.prepare(`
          SELECT COUNT(*) AS total FROM cover_visual_references WHERE active=1
        `).first();
        const indexedReferences = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM cover_visual_references r
          JOIN cover_reference_embeddings e ON e.reference_id=r.id
          WHERE r.active=1 AND e.dimensions=? AND e.embedding_model=?
        `).bind(EMBEDDING_DIMENSIONS, env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2').first();
        const indexedCovers = await env.DB.prepare(`
          SELECT COUNT(DISTINCT r.capa_code) AS total
          FROM cover_visual_references r
          JOIN cover_reference_embeddings e ON e.reference_id=r.id
          WHERE r.active=1 AND e.dimensions=? AND e.embedding_model=?
        `).bind(EMBEDDING_DIMENSIONS, env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2').first();
        const pendingReferences = Math.max(
          0,
          Number(referenceImages?.total || 0) - Number(indexedReferences?.total || 0)
        );
        return json({
          reference_covers: Number(referenceCovers?.total || 0),
          reference_images: Number(referenceImages?.total || 0),
          indexed_references: Number(indexedReferences?.total || 0),
          indexed_covers: Number(indexedCovers?.total || 0),
          pending_references: pendingReferences,
          pending_covers: pendingReferences,
          embedding_model: env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
          embedding_dimensions: EMBEDDING_DIMENSIONS,
          top_k: TOP_K_REFERENCES
        });
      }

      if (url.pathname === '/api/admin/reindex-cover-embeddings' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const limit = Math.max(1, Math.min(20, Number(body.limit) || 8));
        const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
        const { results } = await env.DB.prepare(`
          SELECT
            r.id AS reference_id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind
          FROM cover_visual_references r
          LEFT JOIN cover_reference_embeddings e
            ON e.reference_id=r.id AND e.dimensions=? AND e.embedding_model=?
          WHERE r.active=1 AND e.reference_id IS NULL
          ORDER BY r.id ASC
          LIMIT ?
        `).bind(EMBEDDING_DIMENSIONS, model, limit).all();

        const processed = [];
        const errors = [];
        const removedReferenceIds = [];
        for (const reference of results || []) {
          try {
            const object = await env.PRODUCT_IMAGES.get(reference.image_key);
            if (!object) throw new Error('Imagem não encontrada no R2');
            await storeReferenceEmbedding(
              env,
              reference,
              new Uint8Array(await object.arrayBuffer()),
              object.httpMetadata?.contentType || 'image/jpeg'
            );
            processed.push({
              reference_id: Number(reference.reference_id),
              capa_code: reference.capa_code
            });

            if (reference.source_product_id) {
              const product = await env.DB.prepare(`SELECT image_key FROM products WHERE id=?`)
                .bind(reference.source_product_id).first();
              if (product?.image_key === reference.image_key) {
                const stale = await cleanupStaleProductReferences(
                  env,
                  Number(reference.source_product_id),
                  reference.image_key
                );
                removedReferenceIds.push(...stale.map(item => Number(item.id)));
                for (const item of stale) {
                  if (item.image_key && item.image_key !== reference.image_key) {
                    await env.PRODUCT_IMAGES.delete(item.image_key).catch(() => {});
                  }
                }
              }
            }
          } catch (error) {
            errors.push({
              reference_id: Number(reference.reference_id),
              capa_code: reference.capa_code,
              error: error?.message || 'Falha ao indexar'
            });
          }
        }

        const pending = await env.DB.prepare(`
          SELECT COUNT(*) AS total
          FROM cover_visual_references r
          LEFT JOIN cover_reference_embeddings e
            ON e.reference_id=r.id AND e.dimensions=? AND e.embedding_model=?
          WHERE r.active=1 AND e.reference_id IS NULL
        `).bind(EMBEDDING_DIMENSIONS, model).first();

        return json({
          ok: errors.length === 0,
          processed,
          errors,
          removed_reference_ids: removedReferenceIds,
          pending_references: Number(pending?.total || 0),
          pending_covers: Number(pending?.total || 0)
        });
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const message = error?.message || 'Erro interno';
      const status = /UNIQUE constraint/i.test(message) ? 409
        : /não encontrado|não encontrada/i.test(message) ? 404
          : /máximo|imagem|arquivo|referência|CAPA_CODE/i.test(message) ? 400
            : 400;
      return json({ error: message }, status);
    }
  }
};
