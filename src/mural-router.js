import { WIREO_COLORS, ACCESSORY_COLORS } from './sku.js';
import { productTypeLabel } from './product-display.js';
import { broadcastMuralPush } from './web-push.js';

const MURAL_PUBLIC_RELEASED = false;

const TAB_KIND = Object.freeze({
  all: null,
  products: 'product',
  collections: 'collection',
  notices: 'notice'
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function cleanUserId(request) {
  return String(request.headers.get('x-user-id') || 'anonymous').trim().slice(0, 100) || 'anonymous';
}

function clampLimit(value) {
  const parsed = Number(value || 20);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(50, parsed)) : 20;
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(atob(String(value).replace(/-/g, '+').replace(/_/g, '/')));
    const id = Number(parsed?.id || 0);
    if (!Number.isInteger(id) || id < 1) return null;
    return {
      featured: Number(parsed?.featured || 0) === 1 ? 1 : 0,
      priority: Number(parsed?.priority || 0),
      published_at: String(parsed?.published_at || ''),
      id
    };
  } catch {
    return null;
  }
}

function encodeCursor(row) {
  if (!row) return null;
  return btoa(JSON.stringify({
    featured: Number(row.featured || 0) === 1 ? 1 : 0,
    priority: Number(row.priority || 0),
    published_at: row.published_at,
    id: Number(row.id)
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function finishLabels(row) {
  return {
    wireo: WIREO_COLORS[row?.wireo_code] || row?.wireo_code || null,
    tassel: row?.tassel_code === 'X'
      ? 'Sem tassel'
      : ACCESSORY_COLORS[row?.tassel_code] || row?.tassel_code || null,
    elastico: ACCESSORY_COLORS[row?.elastico_code] || row?.elastico_code || null
  };
}

async function unreadCount(userId, env) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM mural_posts mp
    LEFT JOIN mural_post_reads mr
      ON mr.post_id = mp.id
     AND mr.user_id = ?
    WHERE mp.status = 'published'
      AND mp.published_at IS NOT NULL
      AND datetime(mp.published_at) <= CURRENT_TIMESTAMP
      AND (mp.expires_at IS NULL OR datetime(mp.expires_at) > CURRENT_TIMESTAMP)
      AND mr.post_id IS NULL
  `).bind(userId).first();

  return Number(row?.total || 0);
}

function mapFeedRow(row, collectionPreviews = new Map()) {
  const productId = row.product_id ? Number(row.product_id) : null;
  const collectionId = row.collection_id ? Number(row.collection_id) : null;
  const collectionPreview = collectionId ? collectionPreviews.get(collectionId) : null;
  const labels = finishLabels(row);
  const productAvailable = row.kind !== 'product' || Boolean(productId && row.sku);

  return {
    id: Number(row.id),
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle || null,
    body: row.body || null,
    badge: row.badge || null,
    badge_tone: row.badge_tone || null,
    featured: Number(row.featured || 0) === 1,
    priority: Number(row.priority || 0),
    published_at: row.published_at || null,
    expires_at: row.expires_at || null,
    is_read: Boolean(row.is_read),
    image_url: row.image_key
      ? `/api/mural/images/${Number(row.id)}?v=${encodeURIComponent(row.image_key)}`
      : productId && row.product_image_key
        ? `/api/images/${productId}?v=${encodeURIComponent(row.product_image_key)}`
        : collectionId && row.collection_image_key
          ? `/api/mural/collections/${encodeURIComponent(row.collection_slug)}/image?v=${encodeURIComponent(row.collection_image_key)}`
          : null,
    product_available: productAvailable,
    product: row.kind === 'product'
      ? {
          id: productId,
          sku: row.sku || null,
          type: productTypeLabel(row),
          collection: row.product_collection_name || null,
          wireo: labels.wireo,
          tassel: labels.tassel,
          elastico: labels.elastico
        }
      : null,
    collection: row.kind === 'collection' && collectionId
      ? {
          id: collectionId,
          slug: row.collection_slug,
          name: row.collection_name,
          year: row.collection_year ? Number(row.collection_year) : null,
          product_count: Number(collectionPreview?.count || 0),
          preview_products: collectionPreview?.items || []
        }
      : null,
    notice_level: row.notice_level || null
  };
}

async function listMuralFeed(request, url, env) {
  const tab = String(url.searchParams.get('tab') || 'all').trim().toLowerCase();
  if (!(tab in TAB_KIND)) return json({ error: 'Filtro do Mural inválido.' }, 400);

  const limit = clampLimit(url.searchParams.get('limit'));
  const cursorValue = url.searchParams.get('cursor');
  const cursor = decodeCursor(cursorValue);
  if (cursorValue && !cursor) return json({ error: 'Cursor do Mural inválido.' }, 400);
  const userId = cleanUserId(request);
  const clauses = [
    "mp.status = 'published'",
    'mp.published_at IS NOT NULL',
    'datetime(mp.published_at) <= CURRENT_TIMESTAMP',
    '(mp.expires_at IS NULL OR datetime(mp.expires_at) > CURRENT_TIMESTAMP)'
  ];
  const bindings = [userId];

  const kind = TAB_KIND[tab];
  if (kind) {
    clauses.push('mp.kind = ?');
    bindings.push(kind);
  }

  if (cursor) {
    clauses.push(`(
      mp.featured < ?
      OR (mp.featured = ? AND mp.priority < ?)
      OR (mp.featured = ? AND mp.priority = ? AND mp.published_at < ?)
      OR (mp.featured = ? AND mp.priority = ? AND mp.published_at = ? AND mp.id < ?)
    )`);
    bindings.push(
      cursor.featured,
      cursor.featured, cursor.priority,
      cursor.featured, cursor.priority, cursor.published_at,
      cursor.featured, cursor.priority, cursor.published_at, cursor.id
    );
  }

  const { results } = await env.DB.prepare(`
    SELECT
      mp.id,mp.kind,mp.title,mp.subtitle,mp.body,mp.badge,mp.badge_tone,
      mp.featured,mp.priority,mp.published_at,mp.expires_at,mp.image_key,
      mp.notice_level,
      p.id AS product_id,p.sku,p.miolo_code,p.nome AS product_name,
      p.wireo_code,p.tassel_code,p.elastico_code,p.image_key AS product_image_key,
      (
        SELECT mc2.name
        FROM mural_collection_products mcp2
        INNER JOIN mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,mc.year AS collection_year,mc.image_key AS collection_image_key,
      CASE WHEN mr.post_id IS NULL THEN 0 ELSE 1 END AS is_read
    FROM mural_posts mp
    LEFT JOIN products p ON p.id = mp.product_id
    LEFT JOIN mural_collections mc ON mc.id = mp.collection_id
    LEFT JOIN mural_post_reads mr ON mr.post_id = mp.id AND mr.user_id = ?
    WHERE ${clauses.join('\n      AND ')}
    ORDER BY mp.featured DESC,mp.priority DESC,mp.published_at DESC,mp.id DESC
    LIMIT ?
  `).bind(...bindings, limit + 1).all();

  const rows = results || [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const collectionIds = [...new Set(
    page
      .filter(row => row.kind === 'collection' && row.collection_id)
      .map(row => Number(row.collection_id))
  )];
  const collectionPreviews = new Map();

  if (collectionIds.length) {
    const placeholders = collectionIds.map(() => '?').join(',');
    const previewResult = await env.DB.prepare(`
      SELECT
        mcp.collection_id,mcp.sort_order,
        p.id,p.sku,p.nome,p.variacao,p.miolo_code,p.image_key
      FROM mural_collection_products mcp
      INNER JOIN products p ON p.id=mcp.product_id
      WHERE mcp.collection_id IN (${placeholders})
      ORDER BY mcp.collection_id ASC,mcp.sort_order ASC,p.sku ASC,p.id ASC
    `).bind(...collectionIds).all();

    for (const row of previewResult.results || []) {
      const collectionId = Number(row.collection_id);
      const current = collectionPreviews.get(collectionId) || { count:0, items:[] };
      current.count += 1;
      if (current.items.length < 3) {
        current.items.push({
          id:Number(row.id),
          sku:row.sku || null,
          type:productTypeLabel({ product_name:row.nome, ...row }),
          name:row.nome || null,
          image_url:row.image_key ? `/api/images/${Number(row.id)}?v=${encodeURIComponent(row.image_key)}` : null
        });
      }
      collectionPreviews.set(collectionId,current);
    }
  }

  return json({
    items: page.map(row => mapFeedRow(row, collectionPreviews)),
    next_cursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
    unread_count: await unreadCount(userId, env)
  });
}

async function markRead(postId, userId, env) {
  const post = await env.DB.prepare(`
    SELECT id
    FROM mural_posts
    WHERE id = ?
      AND status = 'published'
      AND published_at IS NOT NULL
      AND datetime(published_at) <= CURRENT_TIMESTAMP
      AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
    LIMIT 1
  `).bind(postId).first();

  if (!post) return json({ error: 'Publicação do Mural não encontrada.' }, 404);

  await env.DB.prepare(`
    INSERT INTO mural_post_reads (post_id,user_id,read_at)
    VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(post_id,user_id) DO UPDATE SET read_at=excluded.read_at
  `).bind(postId, userId).run();

  return json({ ok: true, unread_count: await unreadCount(userId, env) });
}

async function markAllRead(userId, env) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO mural_post_reads (post_id,user_id,read_at)
    SELECT id,?,CURRENT_TIMESTAMP
    FROM mural_posts
    WHERE status = 'published'
      AND published_at IS NOT NULL
      AND datetime(published_at) <= CURRENT_TIMESTAMP
      AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
  `).bind(userId).run();

  return json({ ok: true, unread_count: 0 });
}

async function collectionDetail(slug, env) {
  const collection = await env.DB.prepare(`
    SELECT id,slug,name,year,description,image_key,status
    FROM mural_collections
    WHERE slug = ? AND status = 'active'
    LIMIT 1
  `).bind(slug).first();

  if (!collection) return json({ error: 'Coleção não encontrada.' }, 404);

  const { results } = await env.DB.prepare(`
    SELECT
      p.id,p.sku,p.miolo_code,p.nome,p.variacao,p.wireo_code,p.tassel_code,p.elastico_code,p.image_key,
      mcp.sort_order
    FROM mural_collection_products mcp
    INNER JOIN products p ON p.id = mcp.product_id
    WHERE mcp.collection_id = ?
    ORDER BY mcp.sort_order ASC,p.sku ASC,p.id ASC
  `).bind(collection.id).all();

  return json({
    collection: {
      id: Number(collection.id),
      slug: collection.slug,
      name: collection.name,
      year: collection.year ? Number(collection.year) : null,
      description: collection.description || null,
      image_url: collection.image_key ? `/api/mural/collections/${encodeURIComponent(collection.slug)}/image?v=${encodeURIComponent(collection.image_key)}` : null,
      products: (results || []).map(row => {
        const labels = finishLabels(row);
        return {
          id: Number(row.id),
          sku: row.sku,
          type: productTypeLabel({ product_name: row.nome, ...row }),
          name: row.nome || null,
          variation: row.variacao || null,
          wireo: labels.wireo,
          tassel: labels.tassel,
          elastico: labels.elastico,
          image_url: row.image_key ? `/api/images/${Number(row.id)}?v=${encodeURIComponent(row.image_key)}` : null,
          sort_order: Number(row.sort_order || 0)
        };
      })
    }
  });
}

const ADMIN_KINDS = new Set(['product', 'collection', 'notice']);
const ADMIN_STATUSES = new Set(['draft', 'published', 'archived']);
const NOTICE_LEVELS = new Set(['important', 'attention', 'info']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_EDITORIAL_IMAGE_BYTES = 5 * 1024 * 1024;

const MURAL_IMAGE_BUDGETS = Object.freeze({
  hero: 250 * 1024,
  product: 120 * 1024,
  collection: 180 * 1024,
  first_fold: Math.round(1.5 * 1024 * 1024)
});
const MURAL_REQUIRED_TABLES = Object.freeze([
  'mural_collections',
  'mural_collection_products',
  'mural_posts',
  'mural_post_reads'
]);

function nullableText(value, max) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function requiredText(value, max, label) {
  const text = nullableText(value, max);
  if (!text) throw new Error(`${label} é obrigatório.`);
  return text;
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value) {
  const text = nullableText(value, 40);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error('Data inválida.');
  return date.toISOString();
}

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('Content-Type deve ser application/json.');
  return request.json();
}

function validatePostPayload(input, current = {}) {
  const kind = String(input.kind ?? current.kind ?? '').trim();
  if (!ADMIN_KINDS.has(kind)) throw new Error('Tipo de publicação inválido.');

  const productId = kind === 'product' ? integerOrNull(input.product_id ?? current.product_id) : null;
  const collectionId = kind === 'collection' ? integerOrNull(input.collection_id ?? current.collection_id) : null;
  const noticeLevel = kind === 'notice' ? String(input.notice_level ?? current.notice_level ?? '').trim() : null;
  if (kind === 'product' && !productId) throw new Error('Selecione um produto.');
  if (kind === 'collection' && !collectionId) throw new Error('Selecione uma coleção.');
  if (kind === 'notice' && !NOTICE_LEVELS.has(noticeLevel)) throw new Error('Prioridade visual do aviso inválida.');

  const priority = Number(input.priority ?? current.priority ?? 0);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new Error('Prioridade deve estar entre 0 e 100.');

  const publishedAt = normalizeDate(input.published_at ?? current.published_at);
  const expiresAt = normalizeDate(input.expires_at ?? current.expires_at);
  if (publishedAt && expiresAt && new Date(expiresAt) <= new Date(publishedAt)) {
    throw new Error('Expiração deve ser posterior à publicação.');
  }

  return {
    kind,
    title: requiredText(input.title ?? current.title, 90, 'Título'),
    subtitle: nullableText(input.subtitle ?? current.subtitle, 120),
    body: nullableText(input.body ?? current.body, 700),
    badge: nullableText(input.badge ?? current.badge, 18),
    badge_tone: nullableText(input.badge_tone ?? current.badge_tone, 30),
    product_id: productId,
    collection_id: collectionId,
    notice_level: noticeLevel,
    featured: (input.featured ?? current.featured) ? 1 : 0,
    priority,
    published_at: publishedAt,
    expires_at: expiresAt
  };
}

async function adminListPosts(url, env) {
  const status = String(url.searchParams.get('status') || '').trim();
  const kind = String(url.searchParams.get('kind') || '').trim();
  if (status && !ADMIN_STATUSES.has(status)) return json({ error: 'Status inválido.' }, 400);
  if (kind && !ADMIN_KINDS.has(kind)) return json({ error: 'Tipo inválido.' }, 400);
  const clauses = [];
  const bindings = [];
  if (status) { clauses.push('mp.status = ?'); bindings.push(status); }
  if (kind) { clauses.push('mp.kind = ?'); bindings.push(kind); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await env.DB.prepare(`
    SELECT mp.*,p.sku AS product_sku,p.nome AS product_name,p.miolo_code AS product_miolo_code,
      p.image_key AS product_image_key,p.wireo_code,p.tassel_code,p.elastico_code,
      (
        SELECT mc2.name
        FROM mural_collection_products mcp2
        INNER JOIN mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.name AS collection_name,mc.slug AS collection_slug
    FROM mural_posts mp
    LEFT JOIN products p ON p.id=mp.product_id
    LEFT JOIN mural_collections mc ON mc.id=mp.collection_id
    ${where}
    ORDER BY CASE mp.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
      COALESCE(mp.published_at,mp.created_at) DESC,mp.id DESC
    LIMIT 200
  `).bind(...bindings).all();
  return json({ items:(results || []).map(row=>{
    const labels=finishLabels(row);
    return {
      ...row,
      product_type:row.product_id ? productTypeLabel({ sku:row.product_sku, product_name:row.product_name, miolo_code:row.product_miolo_code }) : null,
      product_image_url:row.product_id && row.product_image_key ? `/api/images/${Number(row.product_id)}?v=${encodeURIComponent(row.product_image_key)}` : null,
      product_wireo:labels.wireo,
      product_tassel:labels.tassel,
      product_elastico:labels.elastico
    };
  }) });
}

async function adminGetPost(id, env) {
  const row = await env.DB.prepare('SELECT * FROM mural_posts WHERE id=?').bind(id).first();
  return row ? json({ item: row }) : json({ error: 'Publicação não encontrada.' }, 404);
}

async function adminCreatePost(request, env) {
  const payload = validatePostPayload(await readJson(request));
  if (payload.product_id) {
    const product = await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(payload.product_id).first();
    if (!product) return json({ error:'Produto selecionado não existe.' },422);
  }
  if (payload.collection_id) {
    const collection = await env.DB.prepare('SELECT id FROM mural_collections WHERE id=?').bind(payload.collection_id).first();
    if (!collection) return json({ error:'Coleção selecionada não existe.' },422);
  }
  const result = await env.DB.prepare(`
    INSERT INTO mural_posts
      (kind,status,title,subtitle,body,badge,badge_tone,product_id,collection_id,notice_level,featured,priority,published_at,expires_at,created_by,updated_at)
    VALUES (?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(
    payload.kind,payload.title,payload.subtitle,payload.body,payload.badge,payload.badge_tone,
    payload.product_id,payload.collection_id,payload.notice_level,payload.featured,payload.priority,
    payload.published_at,payload.expires_at,'admin'
  ).run();
  return json({ id: Number(result.meta.last_row_id), status: 'draft' }, 201);
}

async function adminUpdatePost(id, request, env) {
  const current = await env.DB.prepare('SELECT * FROM mural_posts WHERE id=?').bind(id).first();
  if (!current) return json({ error: 'Publicação não encontrada.' }, 404);
  const payload = validatePostPayload(await readJson(request), current);
  if (payload.product_id) {
    const product = await env.DB.prepare('SELECT id FROM products WHERE id=?').bind(payload.product_id).first();
    if (!product) return json({ error:'Produto selecionado não existe.' },422);
  }
  if (payload.collection_id) {
    const collection = await env.DB.prepare('SELECT id FROM mural_collections WHERE id=?').bind(payload.collection_id).first();
    if (!collection) return json({ error:'Coleção selecionada não existe.' },422);
  }
  await env.DB.prepare(`
    UPDATE mural_posts SET kind=?,title=?,subtitle=?,body=?,badge=?,badge_tone=?,
      product_id=?,collection_id=?,notice_level=?,featured=?,priority=?,published_at=?,expires_at=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    payload.kind,payload.title,payload.subtitle,payload.body,payload.badge,payload.badge_tone,
    payload.product_id,payload.collection_id,payload.notice_level,payload.featured,payload.priority,
    payload.published_at,payload.expires_at,id
  ).run();
  return json({ ok: true, id });
}

async function adminPublishPost(id, request, env) {
  const current = await env.DB.prepare('SELECT * FROM mural_posts WHERE id=?').bind(id).first();
  if (!current) return json({ error: 'Publicação não encontrada.' }, 404);
  let requested = {};
  if ((request.headers.get('content-type') || '').includes('application/json')) requested = await request.json();
  const scheduled = normalizeDate(requested.published_at ?? current.published_at);
  const publishedAt = scheduled || new Date().toISOString();
  if (current.expires_at && new Date(current.expires_at) <= new Date(publishedAt)) {
    return json({ error:'A expiração deve ser posterior à data de publicação.' },422);
  }
  await env.DB.prepare("UPDATE mural_posts SET status='published',published_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(publishedAt,id).run();
  return json({ ok: true, id, status: 'published', published_at: publishedAt });
}

async function adminArchivePost(id, env) {
  const result = await env.DB.prepare("UPDATE mural_posts SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  return result.meta.changes ? json({ ok: true, id, status: 'archived' }) : json({ error: 'Publicação não encontrada.' }, 404);
}

async function adminDuplicatePost(id, env) {
  const source = await env.DB.prepare('SELECT * FROM mural_posts WHERE id=?').bind(id).first();
  if (!source) return json({ error: 'Publicação não encontrada.' }, 404);
  const result = await env.DB.prepare(`
    INSERT INTO mural_posts
      (kind,status,title,subtitle,body,badge,badge_tone,image_key,product_id,collection_id,notice_level,featured,priority,published_at,expires_at,created_by,updated_at)
    VALUES (?,'draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
  `).bind(
    source.kind,`${source.title} (cópia)`.slice(0,90),source.subtitle,source.body,source.badge,source.badge_tone,
    source.image_key,source.product_id,source.collection_id,source.notice_level,source.featured,source.priority,
    null,null,'admin'
  ).run();
  return json({ id: Number(result.meta.last_row_id), status: 'draft' }, 201);
}

function detectImageType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}

async function uploadEditorialImage(request, env, owner, id) {
  if (!env.PRODUCT_IMAGES) return json({ error: 'Armazenamento de imagens indisponível.' }, 503);
  const form = await request.formData();
  const file = form.get('image');
  if (!(file instanceof File)) return json({ error: 'Envie o campo image.' }, 400);
  if (file.size < 1 || file.size > MAX_EDITORIAL_IMAGE_BYTES) return json({ error: 'Imagem deve ter no máximo 5 MB.' }, 400);
  if (!IMAGE_TYPES.has(file.type)) return json({ error: 'Formato permitido: JPEG, PNG ou WebP.' }, 400);
  const bytes = await file.arrayBuffer();
  const detected = detectImageType(bytes);
  if (!detected || detected !== file.type) return json({ error: 'Conteúdo da imagem não corresponde ao formato informado.' }, 400);
  const key = `mural/${owner}/${id}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key, bytes, { httpMetadata: { contentType: detected } });
  const table = owner === 'posts' ? 'mural_posts' : 'mural_collections';
  const existing = await env.DB.prepare(`SELECT image_key FROM ${table} WHERE id=?`).bind(id).first();
  if (!existing) { await env.PRODUCT_IMAGES.delete(key); return json({ error: 'Registro não encontrado.' }, 404); }
  await env.DB.prepare(`UPDATE ${table} SET image_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(key,id).run();
  if (existing.image_key && existing.image_key !== key) await env.PRODUCT_IMAGES.delete(existing.image_key);
  return json({ ok: true, image_key: key });
}

async function serveEditorialImage(key, env, { isPublic = true } = {}) {
  if (!key || !env.PRODUCT_IMAGES) return new Response(null, { status: 404 });
  const object = await env.PRODUCT_IMAGES.get(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', isPublic ? 'public, max-age=3600' : 'private, no-store');
  headers.set('x-content-type-options','nosniff');
  if (object.httpEtag) headers.set('etag',object.httpEtag);
  return new Response(object.body,{headers});
}

async function removeEditorialImage(env, owner, id) {
  if (!env.PRODUCT_IMAGES) return json({ error: 'Armazenamento de imagens indisponível.' }, 503);
  const table = owner === 'posts' ? 'mural_posts' : 'mural_collections';
  const existing = await env.DB.prepare(`SELECT image_key FROM ${table} WHERE id=?`).bind(id).first();
  if (!existing) return json({ error: 'Registro não encontrado.' }, 404);
  if (existing.image_key) await env.PRODUCT_IMAGES.delete(existing.image_key);
  await env.DB.prepare(`UPDATE ${table} SET image_key=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  return json({ ok:true });
}

async function adminListCollections(env) {
  const [collectionsResult, membershipResult] = await Promise.all([
    env.DB.prepare(`
      SELECT mc.*
      FROM mural_collections mc
      ORDER BY CASE mc.status WHEN 'active' THEN 0 ELSE 1 END,mc.year DESC,mc.name ASC
    `).all(),
    env.DB.prepare(`
      SELECT collection_id,product_id,sort_order
      FROM mural_collection_products
      ORDER BY collection_id ASC,sort_order ASC,product_id ASC
    `).all()
  ]);
  const membershipByCollection = new Map();
  for (const row of membershipResult.results || []) {
    const key = Number(row.collection_id);
    const list = membershipByCollection.get(key) || [];
    list.push(Number(row.product_id));
    membershipByCollection.set(key,list);
  }
  return json({
    items:(collectionsResult.results || []).map(row=>{
      const productIds = membershipByCollection.get(Number(row.id)) || [];
      return {
        ...row,
        product_count:productIds.length,
        product_ids:productIds.join(',')
      };
    })
  });
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
}

async function adminCreateCollection(request, env) {
  const input = await readJson(request);
  const name = requiredText(input.name,90,'Nome');
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error('Slug inválido.');
  const year = input.year ? Number(input.year) : null;
  const description = nullableText(input.description,700);
  try {
    const result = await env.DB.prepare(`
      INSERT INTO mural_collections (slug,name,year,description,status,updated_at)
      VALUES (?,?,?,?, 'active',CURRENT_TIMESTAMP)
    `).bind(slug,name,Number.isInteger(year) ? year : null,description).run();
    return json({ id:Number(result.meta.last_row_id),slug },201);
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return json({ error:'Já existe uma coleção com esse slug.' },409);
    throw error;
  }
}

async function adminUpdateCollection(id, request, env) {
  const current = await env.DB.prepare('SELECT * FROM mural_collections WHERE id=?').bind(id).first();
  if (!current) return json({ error:'Coleção não encontrada.' },404);
  const input = await readJson(request);
  const name = requiredText(input.name ?? current.name,90,'Nome');
  const slug = slugify(input.slug ?? current.slug);
  const status = String(input.status ?? current.status);
  if (!['active','archived'].includes(status)) throw new Error('Status de coleção inválido.');
  const yearValue = input.year ?? current.year;
  const year = yearValue ? Number(yearValue) : null;
  await env.DB.prepare(`
    UPDATE mural_collections SET slug=?,name=?,year=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).bind(slug,name,Number.isInteger(year)?year:null,nullableText(input.description ?? current.description,700),status,id).run();
  return json({ok:true,id,slug});
}

async function adminSetCollectionProducts(id, request, env) {
  const collection = await env.DB.prepare('SELECT id FROM mural_collections WHERE id=?').bind(id).first();
  if (!collection) return json({error:'Coleção não encontrada.'},404);
  const input = await readJson(request);
  const productIds = Array.isArray(input.product_ids)
    ? [...new Set(input.product_ids.map(Number).filter(value => Number.isInteger(value) && value > 0))]
    : [];
  if (productIds.length) {
    const placeholders = productIds.map(() => '?').join(',');
    const found = await env.DB.prepare(`SELECT id FROM products WHERE id IN (${placeholders})`).bind(...productIds).all();
    if ((found.results || []).length !== productIds.length) return json({error:'A coleção contém produto inexistente.'},422);
  }
  const statements = [env.DB.prepare('DELETE FROM mural_collection_products WHERE collection_id=?').bind(id)];
  productIds.forEach((productId,index) => statements.push(
    env.DB.prepare('INSERT INTO mural_collection_products (collection_id,product_id,sort_order) VALUES (?,?,?)').bind(id,productId,index)
  ));
  await env.DB.batch(statements);
  return json({ok:true,count:productIds.length});
}

async function adminMetrics(env) {
  const [publishedByMonth, readers, topReads, imageStats] = await Promise.all([
    env.DB.prepare(`SELECT substr(published_at,1,7) AS month,COUNT(*) AS total FROM mural_posts WHERE status='published' AND published_at IS NOT NULL GROUP BY substr(published_at,1,7) ORDER BY month DESC LIMIT 12`).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS total FROM mural_post_reads`).first(),
    env.DB.prepare(`SELECT mp.id,mp.title,COUNT(mr.user_id) AS reads FROM mural_posts mp JOIN mural_post_reads mr ON mr.post_id=mp.id GROUP BY mp.id,mp.title ORDER BY reads DESC,mp.id DESC LIMIT 10`).all(),
    env.PRODUCT_IMAGES ? env.PRODUCT_IMAGES.list({ prefix:'mural/', limit:1000 }).catch(() => ({ objects:[] })) : Promise.resolve({ objects:[] })
  ]);
  const editorialImages = imageStats?.objects || [];
  const totalImageBytes = editorialImages.reduce((sum,item) => sum + Number(item.size || 0),0);
  return json({
    published_by_month:(publishedByMonth.results||[]).map(row=>({month:row.month,total:Number(row.total||0)})),
    readers:Number(readers?.total||0),
    editorial_images:{ count:editorialImages.length, average_bytes:editorialImages.length ? Math.round(totalImageBytes/editorialImages.length) : 0 },
    top_reads:(topReads.results||[]).map(row=>({id:Number(row.id),title:row.title,reads:Number(row.reads||0)}))
  });
}


async function adminReadiness(env) {
  const placeholders = MURAL_REQUIRED_TABLES.map(() => '?').join(',');
  const tableResult = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`
  ).bind(...MURAL_REQUIRED_TABLES).all();
  const presentTables = new Set((tableResult.results || []).map(row => String(row.name)));
  const missingTables = MURAL_REQUIRED_TABLES.filter(name => !presentTables.has(name));

  if (missingTables.length) {
    return json({
      migration: { ok:false, present_tables:[...presentTables], missing_tables:missingTables },
      content: { ok:false, published_now:0, by_kind:{ product:0, collection:0, notice:0 } },
      images: {
        ok:false,
        available:Boolean(env.PRODUCT_IMAGES),
        first_fold_bytes:0,
        first_fold_budget_bytes:MURAL_IMAGE_BUDGETS.first_fold,
        items:[]
      },
      automated_ready:false
    });
  }

  const [contentRow, foldResult] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN kind='product' THEN 1 ELSE 0 END) AS products,
        SUM(CASE WHEN kind='collection' THEN 1 ELSE 0 END) AS collections,
        SUM(CASE WHEN kind='notice' THEN 1 ELSE 0 END) AS notices
      FROM mural_posts
      WHERE status='published'
        AND published_at IS NOT NULL
        AND datetime(published_at) <= CURRENT_TIMESTAMP
        AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
    `).first(),
    env.DB.prepare(`
      SELECT
        mp.id,mp.kind,mp.title,mp.featured,mp.priority,mp.published_at,
        mp.image_key,
        p.image_key AS product_image_key,
        mc.image_key AS collection_image_key
      FROM mural_posts mp
      LEFT JOIN products p ON p.id=mp.product_id
      LEFT JOIN mural_collections mc ON mc.id=mp.collection_id
      WHERE mp.status='published'
        AND mp.published_at IS NOT NULL
        AND datetime(mp.published_at) <= CURRENT_TIMESTAMP
        AND (mp.expires_at IS NULL OR datetime(mp.expires_at) > CURRENT_TIMESTAMP)
      ORDER BY mp.featured DESC,mp.priority DESC,mp.published_at DESC,mp.id DESC
      LIMIT 3
    `).all()
  ]);

  const foldRows = foldResult.results || [];
  const imageItems = await Promise.all(foldRows.map(async (row, index) => {
    const key = row.image_key
      || (row.kind === 'product' ? row.product_image_key : null)
      || (row.kind === 'collection' ? row.collection_image_key : null)
      || null;
    let bytes = null;
    if (key && env.PRODUCT_IMAGES?.head) {
      const object = await env.PRODUCT_IMAGES.head(key).catch(() => null);
      bytes = object ? Number(object.size || 0) : null;
    }
    const role = index === 0 && Number(row.featured || 0) === 1 ? 'hero' : row.kind;
    const budgetBytes = role === 'hero'
      ? MURAL_IMAGE_BUDGETS.hero
      : MURAL_IMAGE_BUDGETS[role] || null;
    const imageRequired = role === 'hero' || row.kind === 'product' || row.kind === 'collection';
    const missingRequiredImage = imageRequired && !key;
    return {
      id:Number(row.id),
      title:row.title,
      kind:row.kind,
      role,
      image_key:key,
      image_required:imageRequired,
      missing_required_image:missingRequiredImage,
      bytes,
      budget_bytes:budgetBytes,
      within_budget:missingRequiredImage ? false : bytes === null || budgetBytes === null ? null : bytes <= budgetBytes
    };
  }));

  const knownImageBytes = imageItems.reduce((sum, item) => sum + (Number.isFinite(item.bytes) ? item.bytes : 0), 0);
  const allResolvable = imageItems.every(item => !item.image_key || Number.isFinite(item.bytes));
  const itemBudgetsOk = imageItems.every(item => item.within_budget !== false);
  const firstFoldOk = allResolvable && knownImageBytes <= MURAL_IMAGE_BUDGETS.first_fold;
  const publishedNow = Number(contentRow?.total || 0);
  const contentOk = publishedNow >= 3;
  const migrationOk = missingTables.length === 0;
  const imagesOk = Boolean(env.PRODUCT_IMAGES) && firstFoldOk && itemBudgetsOk;

  return json({
    migration: {
      ok:migrationOk,
      present_tables:MURAL_REQUIRED_TABLES.filter(name => presentTables.has(name)),
      missing_tables:missingTables
    },
    content: {
      ok:contentOk,
      published_now:publishedNow,
      minimum_for_qa:3,
      by_kind: {
        product:Number(contentRow?.products || 0),
        collection:Number(contentRow?.collections || 0),
        notice:Number(contentRow?.notices || 0)
      }
    },
    images: {
      ok:imagesOk,
      available:Boolean(env.PRODUCT_IMAGES),
      first_fold_bytes:knownImageBytes,
      first_fold_budget_bytes:MURAL_IMAGE_BUDGETS.first_fold,
      all_resolvable:allResolvable,
      items:imageItems
    },
    automated_ready:migrationOk && contentOk && imagesOk
  });
}

async function adminProducts(url, env) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0,80);
  const like = `%${q}%`;
  const { results } = await env.DB.prepare(`
    SELECT p.id,p.sku,p.nome,p.variacao,p.image_key,p.wireo_code,p.tassel_code,p.elastico_code,p.miolo_code,
      (
        SELECT mc2.name
        FROM mural_collection_products mcp2
        INNER JOIN mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS collection_name
    FROM products p
    WHERE (?='' OR sku LIKE ? OR nome LIKE ? OR variacao LIKE ?)
    ORDER BY updated_at DESC,id DESC LIMIT 40
  `).bind(q,like,like,like).all();
  return json({items:(results||[]).map(row=>{ const labels=finishLabels(row); return {...row,...labels,type:productTypeLabel(row),image_url:row.image_key?`/api/images/${row.id}?v=${encodeURIComponent(row.image_key)}`:null}; })});
}

export async function suggestMuralProductDraft(env, productId) {
  const id = Number(productId);
  if (!env?.DB || !Number.isInteger(id) || id <= 0) return null;
  const product = await env.DB.prepare('SELECT id,sku,nome,variacao FROM products WHERE id=?').bind(id).first();
  if (!product) return null;
  const existing = await env.DB.prepare("SELECT id FROM mural_posts WHERE kind='product' AND product_id=? AND status<>'archived' ORDER BY id DESC LIMIT 1").bind(id).first();
  if (existing) return { id:Number(existing.id), created:false };
  const title = String(product.nome || product.variacao || product.sku || 'Novo produto').trim().slice(0,90);
  const subtitle = [product.sku,product.variacao].filter(Boolean).join(' · ').slice(0,120) || null;
  const result = await env.DB.prepare(`INSERT INTO mural_posts (kind,status,title,subtitle,badge,badge_tone,product_id,featured,priority,created_by,updated_at) VALUES ('product','draft',?,?,'NOVO','success',?,0,0,'system:suggestion',CURRENT_TIMESTAMP)`).bind(title,subtitle,id).run();
  return { id:Number(result.meta.last_row_id), created:true };
}

async function adminSendPush(id, env) {
  const post = await env.DB.prepare(`SELECT mp.id,mp.kind,mp.status,mp.title,mp.subtitle,mp.notice_level,mp.product_id,p.sku FROM mural_posts mp LEFT JOIN products p ON p.id=mp.product_id WHERE mp.id=?`).bind(id).first();
  if (!post) return json({error:'Publicação não encontrada.'},404);
  if (post.status !== 'published') return json({error:'Publique o conteúdo antes de enviar a notificação.'},409);
  const eligible = (post.kind === 'notice' && post.notice_level === 'important') || post.kind === 'product';
  if (!eligible) return json({error:'Push permitido somente para Aviso Importante ou lançamento de produto selecionado.'},422);
  const result = await broadcastMuralPush(env,{ postId:Number(post.id),title:post.title,body:post.subtitle || (post.kind==='notice'?'Aviso importante no Mural NISTI':post.sku || 'Novo produto no Mural NISTI') });
  return json({ok:true,...result});
}

export async function handleMuralRequest(request, env, { qaAuthorized = false } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === '/api/mural/access' && request.method === 'GET') {
      return json({ released: MURAL_PUBLIC_RELEASED, qa: Boolean(qaAuthorized) });
    }

    if (path.startsWith('/api/mural') && !MURAL_PUBLIC_RELEASED && !qaAuthorized) {
      return json({ error: 'Mural NISTI em breve.' }, 403);
    }

    if (path === '/api/mural' && request.method === 'GET') {
      return await listMuralFeed(request, url, env);
    }

    if (path === '/api/mural/unread-count' && request.method === 'GET') {
      return json({ unread_count: await unreadCount(cleanUserId(request), env) });
    }

    const read = path.match(/^\/api\/mural\/(\d+)\/read$/);
    if (read && request.method === 'POST') {
      return await markRead(Number(read[1]), cleanUserId(request), env);
    }

    if (path === '/api/mural/mark-all-read' && request.method === 'POST') {
      return await markAllRead(cleanUserId(request), env);
    }

    const postImage = path.match(/^\/api\/mural\/images\/(\d+)$/);
    if (postImage && request.method === 'GET') {
      const row = await env.DB.prepare(`SELECT image_key FROM mural_posts WHERE id=? AND status='published' AND published_at IS NOT NULL AND datetime(published_at)<=CURRENT_TIMESTAMP AND (expires_at IS NULL OR datetime(expires_at)>CURRENT_TIMESTAMP)`).bind(Number(postImage[1])).first();
      return serveEditorialImage(row?.image_key, env);
    }

    const collectionImage = path.match(/^\/api\/mural\/collections\/([^/]+)\/image$/);
    if (collectionImage && request.method === 'GET') {
      const row = await env.DB.prepare("SELECT image_key FROM mural_collections WHERE slug=? AND status='active'").bind(decodeURIComponent(collectionImage[1])).first();
      return serveEditorialImage(row?.image_key, env);
    }

    const collection = path.match(/^\/api\/mural\/collections\/([^/]+)$/);
    if (collection && request.method === 'GET') {
      return await collectionDetail(decodeURIComponent(collection[1]), env);
    }

    if (path === '/api/admin/mural/posts' && request.method === 'GET') return adminListPosts(url, env);
    if (path === '/api/admin/mural/posts' && request.method === 'POST') return adminCreatePost(request, env);
    if (path === '/api/admin/mural/products' && request.method === 'GET') return adminProducts(url, env);
    if (path === '/api/admin/mural/metrics' && request.method === 'GET') return adminMetrics(env);
    if (path === '/api/admin/mural/readiness' && request.method === 'GET') return adminReadiness(env);
    if (path === '/api/admin/mural/collections' && request.method === 'GET') return adminListCollections(env);
    if (path === '/api/admin/mural/collections' && request.method === 'POST') return adminCreateCollection(request, env);

    const adminPostImageView = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/image$/);
    if (adminPostImageView && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT image_key FROM mural_posts WHERE id=?').bind(Number(adminPostImageView[1])).first();
      return serveEditorialImage(row?.image_key, env, { isPublic:false });
    }
    const adminCollectionImageView = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/image$/);
    if (adminCollectionImageView && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT image_key FROM mural_collections WHERE id=?').bind(Number(adminCollectionImageView[1])).first();
      return serveEditorialImage(row?.image_key, env, { isPublic:false });
    }

    const adminPost = path.match(/^\/api\/admin\/mural\/posts\/(\d+)$/);
    if (adminPost && request.method === 'GET') return adminGetPost(Number(adminPost[1]), env);
    if (adminPost && request.method === 'PUT') return adminUpdatePost(Number(adminPost[1]), request, env);

    const removePostImage = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/image$/);
    if (removePostImage && request.method === 'DELETE') return removeEditorialImage(env,'posts',Number(removePostImage[1]));
    const removeCollectionImage = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/image$/);
    if (removeCollectionImage && request.method === 'DELETE') return removeEditorialImage(env,'collections',Number(removeCollectionImage[1]));

    const publish = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/publish$/);
    if (publish && request.method === 'POST') return adminPublishPost(Number(publish[1]), request, env);
    const archive = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/archive$/);
    if (archive && request.method === 'POST') return adminArchivePost(Number(archive[1]), env);
    const duplicate = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/duplicate$/);
    if (duplicate && request.method === 'POST') return adminDuplicatePost(Number(duplicate[1]), env);
    const postPush = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/push$/);
    if (postPush && request.method === 'POST') return adminSendPush(Number(postPush[1]), env);
    const postUpload = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/image$/);
    if (postUpload && request.method === 'POST') return uploadEditorialImage(request, env, 'posts', Number(postUpload[1]));

    const adminCollection = path.match(/^\/api\/admin\/mural\/collections\/(\d+)$/);
    if (adminCollection && request.method === 'PUT') return adminUpdateCollection(Number(adminCollection[1]), request, env);
    const collectionProducts = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/products$/);
    if (collectionProducts && request.method === 'PUT') return adminSetCollectionProducts(Number(collectionProducts[1]), request, env);
    const collectionUpload = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/image$/);
    if (collectionUpload && request.method === 'POST') return uploadEditorialImage(request, env, 'collections', Number(collectionUpload[1]));

    return null;
  } catch (error) {
    console.error('Falha no Mural NISTI.', { method: request.method, path, message: error?.message || String(error) });
    return json({ error: 'Falha ao processar a solicitação do Mural NISTI.' }, 500);
  }
}
