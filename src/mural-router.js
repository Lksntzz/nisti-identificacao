import { WIREO_COLORS, ACCESSORY_COLORS } from './sku.js';
import { productTypeLabel } from './product-display.js';
import { PRODUCT_IMAGE_PROCESSOR_VERSION } from './product-image-processor-version.js';
import { broadcastMuralPush } from './web-push.js';
import {
  preferSupabaseRead,
  supabaseRpc,
  supabaseReserveMuralCollection,
  supabaseReserveMuralCollectionImage,
  supabaseReserveMuralFeed,
  supabaseReserveMuralPostImage,
  supabaseReserveMuralUnread
} from './supabase-read-store.js';
import { mirrorSupabaseRpc, supabasePrimaryWritesRequested } from './supabase-write-store.js';

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

function approvedMuralProductKey(row) {
  if (row?.mural_image_status !== 'approved' || row?.mural_image_reviewed_by !== 'admin') return null;
  if (row?.mural_image_processor_version !== PRODUCT_IMAGE_PROCESSOR_VERSION) return null;
  if (!row?.mural_processed_image_key || row?.mural_source_image_key !== row?.image_key) return null;
  return row.mural_processed_image_key;
}

function muralProductImageUrl(row) {
  const productId = Number(row?.id || row?.product_id || 0);
  if (!productId || !row?.image_key) return null;
  const processedKey = approvedMuralProductKey(row);
  return `/api/product-images/${productId}?v=${encodeURIComponent(processedKey || row.image_key)}`;
}

async function unreadCount(userId, env) {
  return preferSupabaseRead(
    env,
    () => supabaseReserveMuralUnread(env,userId),
    async () => {
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
    },
    'mural:unread'
  );
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
        ? muralProductImageUrl({
            id:productId,
            image_key:row.product_image_key,
            mural_image_status:row.mural_image_status,
            mural_image_reviewed_by:row.mural_image_reviewed_by,
            mural_source_image_key:row.mural_source_image_key,
            mural_processed_image_key:row.mural_processed_image_key,
            mural_image_processor_version:row.mural_image_processor_version
          })
        : collectionId && row.collection_image_key
          ? `/api/mural/collections/${encodeURIComponent(row.collection_slug)}/image?v=${encodeURIComponent(row.collection_image_key)}`
          : null,
    image_source: row.image_key
      ? 'post'
      : productId && row.product_image_key
        ? approvedMuralProductKey({
            image_key:row.product_image_key,
            mural_image_status:row.mural_image_status,
            mural_image_reviewed_by:row.mural_image_reviewed_by,
            mural_source_image_key:row.mural_source_image_key,
            mural_processed_image_key:row.mural_processed_image_key,
            mural_image_processor_version:row.mural_image_processor_version
          }) ? 'product-processed' : 'product'
        : collectionId && row.collection_image_key
          ? 'collection'
          : 'none',
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
          description: row.collection_description || null,
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
  const kind = TAB_KIND[tab];

  const payload = await preferSupabaseRead(
    env,
    () => supabaseReserveMuralFeed(env,{ userId,kind,limit,cursor }),
    async () => {
      const clauses = [
        "mp.status = 'published'",
        'mp.published_at IS NOT NULL',
        'datetime(mp.published_at) <= CURRENT_TIMESTAMP',
        '(mp.expires_at IS NULL OR datetime(mp.expires_at) > CURRENT_TIMESTAMP)'
      ];
      const bindings = [userId];

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
          cursor.featured,cursor.priority,
          cursor.featured,cursor.priority,cursor.published_at,
          cursor.featured,cursor.priority,cursor.published_at,cursor.id
        );
      }

      const { results } = await env.DB.prepare(`
        SELECT
          mp.id,mp.kind,mp.title,mp.subtitle,mp.body,mp.badge,mp.badge_tone,
          mp.featured,mp.priority,mp.published_at,mp.expires_at,mp.image_key,
          mp.notice_level,
          p.id AS product_id,p.sku,p.miolo_code,p.nome AS product_name,
          p.wireo_code,p.tassel_code,p.elastico_code,p.image_key AS product_image_key,
          mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,mpi.source_image_key AS mural_source_image_key,
          mpi.processed_image_key AS mural_processed_image_key,mpi.processor_version AS mural_image_processor_version,
          (
            SELECT mc2.name
            FROM mural_collection_products mcp2
            INNER JOIN mural_collections mc2 ON mc2.id=mcp2.collection_id
            WHERE mcp2.product_id=p.id AND mc2.status='active'
            ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
            LIMIT 1
          ) AS product_collection_name,
          mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,mc.year AS collection_year,mc.description AS collection_description,mc.image_key AS collection_image_key,
          CASE WHEN mr.post_id IS NULL THEN 0 ELSE 1 END AS is_read
        FROM mural_posts mp
        LEFT JOIN products p ON p.id = mp.product_id
        LEFT JOIN mural_product_images mpi ON mpi.product_id = p.id
        LEFT JOIN mural_collections mc ON mc.id = mp.collection_id
        LEFT JOIN mural_post_reads mr ON mr.post_id = mp.id AND mr.user_id = ?
        WHERE ${clauses.join('\n      AND ')}
        ORDER BY mp.featured DESC,mp.priority DESC,mp.published_at DESC,mp.id DESC
        LIMIT ?
      `).bind(...bindings,limit+1).all();

      const allRows=results || [];
      const page=allRows.slice(0,limit);
      const collectionIds=[...new Set(
        page.filter(row => row.kind === 'collection' && row.collection_id)
          .map(row => Number(row.collection_id))
      )];
      let previewRows=[];

      if (collectionIds.length) {
        const placeholders=collectionIds.map(() => '?').join(',');
        const preview=await env.DB.prepare(`
          SELECT
            mcp.collection_id,mcp.sort_order,
            p.id,p.sku,p.nome,p.variacao,p.miolo_code,p.image_key,
            mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,mpi.source_image_key AS mural_source_image_key,
            mpi.processed_image_key AS mural_processed_image_key,mpi.processor_version AS mural_image_processor_version
          FROM mural_collection_products mcp
          INNER JOIN products p ON p.id=mcp.product_id
          LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
          WHERE mcp.collection_id IN (${placeholders})
          ORDER BY mcp.collection_id ASC,mcp.sort_order ASC,p.sku ASC,p.id ASC
        `).bind(...collectionIds).all();
        previewRows=preview.results || [];
      }

      const unreadRow=await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM mural_posts mp
        LEFT JOIN mural_post_reads mr
          ON mr.post_id=mp.id AND mr.user_id=?
        WHERE mp.status='published'
          AND mp.published_at IS NOT NULL
          AND datetime(mp.published_at)<=CURRENT_TIMESTAMP
          AND (mp.expires_at IS NULL OR datetime(mp.expires_at)>CURRENT_TIMESTAMP)
          AND mr.post_id IS NULL
      `).bind(userId).first();

      return {
        rows:allRows,
        preview_rows:previewRows,
        unread_count:Number(unreadRow?.total || 0)
      };
    },
    'mural:feed'
  );

  const rows=Array.isArray(payload?.rows) ? payload.rows : [];
  const hasMore=rows.length > limit;
  const page=rows.slice(0,limit);
  const collectionPreviews=new Map();

  for (const row of Array.isArray(payload?.preview_rows) ? payload.preview_rows : []) {
    const collectionId=Number(row.collection_id);
    const current=collectionPreviews.get(collectionId) || { count:0,items:[] };
    current.count += 1;
    if (current.items.length < 3) {
      current.items.push({
        id:Number(row.id),
        sku:row.sku || null,
        type:productTypeLabel({ product_name:row.nome, ...row }),
        name:row.nome || null,
        image_url:muralProductImageUrl(row),
        image_source:approvedMuralProductKey(row) ? 'product-processed' : 'product'
      });
    }
    collectionPreviews.set(collectionId,current);
  }

  return json({
    items:page.map(row => mapFeedRow(row,collectionPreviews)),
    next_cursor:hasMore ? encodeCursor(page[page.length-1]) : null,
    unread_count:Number(payload?.unread_count || 0)
  });
}

async function markRead(postId, userId, env) {
  if (supabasePrimaryWritesRequested(env)) {
    const result = await mirrorSupabaseRpc(
      env,
      'nisti_mark_mural_post_read_v1',
      { p_post_id:postId, p_user_id:userId },
      `mural read ${postId}`
    );
    const unreadCount = Number(result?.value ?? -1);
    if (unreadCount < 0) return json({ error: 'Publicação do Mural não encontrada.' }, 404);
    return json({ ok: true, unread_count: unreadCount });
  }

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
  if (supabasePrimaryWritesRequested(env)) {
    await mirrorSupabaseRpc(
      env,
      'nisti_mark_all_mural_posts_read_v1',
      { p_user_id:userId },
      'mark all mural posts read'
    );
    return json({ ok: true, unread_count: 0 });
  }

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
  const payload = await preferSupabaseRead(
    env,
    () => supabaseReserveMuralCollection(env,slug),
    async () => {
      const collection = await env.DB.prepare(`
        SELECT id,slug,name,year,description,image_key,status
        FROM mural_collections
        WHERE slug = ? AND status = 'active'
        LIMIT 1
      `).bind(slug).first();
      if (!collection) return null;

      const { results } = await env.DB.prepare(`
        SELECT
          p.id,p.sku,p.miolo_code,p.nome,p.variacao,p.wireo_code,p.tassel_code,p.elastico_code,p.image_key,
          mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,mpi.source_image_key AS mural_source_image_key,
          mpi.processed_image_key AS mural_processed_image_key,mpi.processor_version AS mural_image_processor_version,
          mcp.sort_order
        FROM mural_collection_products mcp
        INNER JOIN products p ON p.id = mcp.product_id
        LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
        WHERE mcp.collection_id = ?
        ORDER BY mcp.sort_order ASC,p.sku ASC,p.id ASC
      `).bind(collection.id).all();

      return { collection,products:results || [] };
    },
    'mural:collection'
  );

  if (!payload?.collection) return json({ error:'Coleção não encontrada.' },404);
  const collection=payload.collection;
  const products=Array.isArray(payload.products) ? payload.products : [];

  return json({
    collection:{
      id:Number(collection.id),
      slug:collection.slug,
      name:collection.name,
      year:collection.year ? Number(collection.year) : null,
      description:collection.description || null,
      image_url:collection.image_key ? `/api/mural/collections/${encodeURIComponent(collection.slug)}/image?v=${encodeURIComponent(collection.image_key)}` : null,
      products:products.map(row => {
        const labels=finishLabels(row);
        return {
          id:Number(row.id),
          sku:row.sku,
          type:productTypeLabel({ product_name:row.nome, ...row }),
          name:row.nome || null,
          variation:row.variacao || null,
          wireo:labels.wireo,
          tassel:labels.tassel,
          elastico:labels.elastico,
          image_url:muralProductImageUrl(row),
          image_source:approvedMuralProductKey(row) ? 'product-processed' : 'product',
          sort_order:Number(row.sort_order || 0)
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
const MAX_MURAL_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;

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
  'mural_post_reads',
  'mural_product_images'
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
  if (supabasePrimaryWritesRequested(env)) {
    const rows=await supabaseRpc(env,'nisti_admin_mural_posts_v1',{p_status:status||null,p_kind:kind||null});
    return json({items:(Array.isArray(rows)?rows:[]).map(row=>{
      const labels=finishLabels(row);
      return {
        ...row,
        product_type:row.product_id ? productTypeLabel({sku:row.product_sku,product_name:row.product_name,miolo_code:row.product_miolo_code}) : null,
        product_image_url:row.product_id && row.product_image_key ? `/api/images/${Number(row.product_id)}?v=${encodeURIComponent(row.product_image_key)}` : null,
        collection_image_url:row.collection_id && row.collection_image_key ? `/api/admin/mural/collections/${Number(row.collection_id)}/image?v=${encodeURIComponent(row.collection_image_key)}` : null,
        product_wireo:labels.wireo,product_tassel:labels.tassel,product_elastico:labels.elastico
      };
    })});
  }
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
      mc.name AS collection_name,mc.slug AS collection_slug,mc.image_key AS collection_image_key
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
      collection_image_url:row.collection_id && row.collection_image_key
        ? `/api/admin/mural/collections/${Number(row.collection_id)}/image?v=${encodeURIComponent(row.collection_image_key)}`
        : null,
      product_wireo:labels.wireo,
      product_tassel:labels.tassel,
      product_elastico:labels.elastico
    };
  }) });
}

async function adminGetPost(id, env) {
  if (supabasePrimaryWritesRequested(env)) {
    const row=await supabaseRpc(env,'nisti_admin_mural_post_v1',{p_id:id});
    return row ? json({item:row}) : json({error:'Publicação não encontrada.'},404);
  }
  const row = await env.DB.prepare('SELECT * FROM mural_posts WHERE id=?').bind(id).first();
  return row ? json({ item: row }) : json({ error: 'Publicação não encontrada.' }, 404);
}

async function adminCreatePost(request, env) {
  const payload = validatePostPayload(await readJson(request));
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_post_write_v1',{
      p_action:'create',p_id:null,p_payload:payload
    },'create mural post primary');
    const value=result?.value || {};
    if(value.status==='product_not_found') return json({error:'Produto selecionado não existe.'},422);
    if(value.status==='collection_not_found') return json({error:'Coleção selecionada não existe.'},422);
    if(value.status!=='ok') return json({error:'Não foi possível criar a publicação.'},422);
    return json({id:Number(value.id),status:'draft'},201);
  }
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
  if (supabasePrimaryWritesRequested(env)) {
    const current=await supabaseRpc(env,'nisti_admin_mural_post_v1',{p_id:id});
    if(!current) return json({error:'Publicação não encontrada.'},404);
    const payload=validatePostPayload(await readJson(request),current);
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_post_write_v1',{
      p_action:'update',p_id:id,p_payload:payload
    },`update mural post ${id}`);
    const value=result?.value || {};
    if(value.status==='product_not_found') return json({error:'Produto selecionado não existe.'},422);
    if(value.status==='collection_not_found') return json({error:'Coleção selecionada não existe.'},422);
    if(value.status!=='ok') return json({error:'Não foi possível atualizar a publicação.'},422);
    return json({ok:true,id});
  }
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
  if (supabasePrimaryWritesRequested(env)) {
    const current=await supabaseRpc(env,'nisti_admin_mural_post_v1',{p_id:id});
    if(!current) return json({error:'Publicação não encontrada.'},404);
    let requested={};
    if((request.headers.get('content-type')||'').includes('application/json')) requested=await request.json();
    const scheduled=normalizeDate(requested.published_at ?? current.published_at);
    const publishedAt=scheduled || new Date().toISOString();
    if(current.expires_at && new Date(current.expires_at)<=new Date(publishedAt)) {
      return json({error:'A expiração deve ser posterior à data de publicação.'},422);
    }
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_post_write_v1',{
      p_action:'publish',p_id:id,p_payload:{published_at:publishedAt}
    },`publish mural post ${id}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({error:'Publicação não encontrada.'},404);
    if(value.status==='invalid_expiration') return json({error:'A expiração deve ser posterior à data de publicação.'},422);
    return json({ok:true,id,status:'published',published_at:value.published_at || publishedAt});
  }
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
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_post_write_v1',{
      p_action:'archive',p_id:id,p_payload:{}
    },`archive mural post ${id}`);
    if(result?.value?.status==='not_found') return json({error:'Publicação não encontrada.'},404);
    return json({ok:true,id,status:'archived'});
  }
  const result = await env.DB.prepare("UPDATE mural_posts SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  return result.meta.changes ? json({ ok: true, id, status: 'archived' }) : json({ error: 'Publicação não encontrada.' }, 404);
}

async function adminDuplicatePost(id, env) {
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_post_write_v1',{
      p_action:'duplicate',p_id:id,p_payload:{}
    },`duplicate mural post ${id}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({error:'Publicação não encontrada.'},404);
    return json({id:Number(value.id),status:'draft'},201);
  }
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

async function adminDeletePost(id, env) {
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_post_write_v1',{
      p_action:'delete',p_id:id,p_payload:{}
    },`delete mural post ${id}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({ error:'Publicação não encontrada.' },404);
    if(value.status!=='ok') return json({ error:'Não foi possível excluir a publicação.' },422);
    if(value.image_key && Number(value.image_references || 0)===0 && env.PRODUCT_IMAGES) {
      await env.PRODUCT_IMAGES.delete(value.image_key).catch(()=>{});
    }
    return json({ok:true,id});
  }

  const current = await env.DB.prepare('SELECT id,image_key FROM mural_posts WHERE id=?').bind(id).first();
  if (!current) return json({ error:'Publicação não encontrada.' },404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM mural_post_reads WHERE post_id=?').bind(id),
    env.DB.prepare('DELETE FROM mural_posts WHERE id=?').bind(id)
  ]);

  if (current.image_key && env.PRODUCT_IMAGES) {
    const references = await env.DB.prepare(`
      SELECT (
        (SELECT COUNT(*) FROM mural_posts WHERE image_key = ?)
        + (SELECT COUNT(*) FROM mural_collections WHERE image_key = ?)
      ) AS total
    `).bind(current.image_key,current.image_key).first();

    if (Number(references?.total || 0) === 0) {
      await env.PRODUCT_IMAGES.delete(current.image_key);
    }
  }

  return json({ ok:true, id });
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

  if (supabasePrimaryWritesRequested(env)) {
    try {
      const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_editorial_image_v1',{
        p_owner:owner,p_id:id,p_image_key:key
      },`mural ${owner} image ${id}`);
      const value=result?.value || {};
      if(value.status==='not_found') {
        await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
        return json({error:'Registro não encontrado.'},404);
      }
      if(value.status!=='ok') {
        await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
        return json({error:'Não foi possível salvar a imagem.'},422);
      }
      if(value.old_image_key && value.old_image_key!==key) {
        await env.PRODUCT_IMAGES.delete(value.old_image_key).catch(()=>{});
      }
      return json({ok:true,image_key:key});
    } catch(error) {
      await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
      throw error;
    }
  }

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

  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_editorial_image_v1',{
      p_owner:owner,p_id:id,p_image_key:null
    },`remove mural ${owner} image ${id}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({error:'Registro não encontrado.'},404);
    if(value.status!=='ok') return json({error:'Não foi possível remover a imagem.'},422);
    if(value.old_image_key) await env.PRODUCT_IMAGES.delete(value.old_image_key).catch(()=>{});
    return json({ok:true});
  }

  const table = owner === 'posts' ? 'mural_posts' : 'mural_collections';
  const existing = await env.DB.prepare(`SELECT image_key FROM ${table} WHERE id=?`).bind(id).first();
  if (!existing) return json({ error: 'Registro não encontrado.' }, 404);
  if (existing.image_key) await env.PRODUCT_IMAGES.delete(existing.image_key);
  await env.DB.prepare(`UPDATE ${table} SET image_key=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
  return json({ ok:true });
}

async function adminListCollections(env) {
  if (supabasePrimaryWritesRequested(env)) {
    const rows=await supabaseRpc(env,'nisti_admin_mural_collections_v1',{});
    return json({items:Array.isArray(rows)?rows:[]});
  }
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
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_collection_write_v1',{
      p_action:'create',p_id:null,p_payload:{
        slug,name,year:Number.isInteger(year)?year:null,description
      }
    },'create mural collection primary');
    const value=result?.value || {};
    if(value.status==='slug_conflict') return json({error:'Já existe uma coleção com esse slug.'},409);
    if(value.status!=='ok') return json({error:'Não foi possível criar a coleção.'},422);
    return json({id:Number(value.id),slug:value.slug || slug},201);
  }
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
  if (supabasePrimaryWritesRequested(env)) {
    const current=await supabaseRpc(env,'nisti_admin_mural_collection_v1',{p_id:id});
    if(!current) return json({error:'Coleção não encontrada.'},404);
    const input=await readJson(request);
    const name=requiredText(input.name ?? current.name,90,'Nome');
    const slug=slugify(input.slug ?? current.slug);
    const status=String(input.status ?? current.status);
    if(!['active','archived'].includes(status)) throw new Error('Status de coleção inválido.');
    const yearValue=input.year ?? current.year;
    const year=yearValue ? Number(yearValue) : null;
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_collection_write_v1',{
      p_action:'update',p_id:id,p_payload:{
        slug,name,year:Number.isInteger(year)?year:null,
        description:nullableText(input.description ?? current.description,700),
        status
      }
    },`update mural collection ${id}`);
    const value=result?.value || {};
    if(value.status==='slug_conflict') return json({error:'Já existe uma coleção com esse slug.'},409);
    if(value.status==='not_found') return json({error:'Coleção não encontrada.'},404);
    return json({ok:true,id,slug:value.slug || slug});
  }
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
  if (supabasePrimaryWritesRequested(env)) {
    const input=await readJson(request);
    const productIds=Array.isArray(input.product_ids)
      ? [...new Set(input.product_ids.map(Number).filter(value=>Number.isInteger(value)&&value>0))]
      : [];
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_collection_write_v1',{
      p_action:'set_products',p_id:id,p_payload:{product_ids:productIds}
    },`set mural collection products ${id}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({error:'Coleção não encontrada.'},404);
    if(value.status==='product_not_found') return json({error:'A coleção contém produto inexistente.'},422);
    if(value.status!=='ok') return json({error:'Não foi possível atualizar os produtos da coleção.'},422);
    return json({ok:true,count:Number(value.count || 0)});
  }
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

async function adminPublishCollection(id, env) {
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_collection_write_v1',{
      p_action:'publish',p_id:id,p_payload:{}
    },`publish mural collection ${id}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({error:'Coleção não encontrada.'},404);
    if(value.status==='inactive') return json({error:'Ative a coleção antes de publicar no Mural.'},422);
    if(value.status==='empty') return json({error:'Adicione pelo menos um produto à coleção antes de publicar.'},422);
    if(value.status!=='ok') return json({error:'Não foi possível publicar a coleção.'},422);
    return json({
      ok:true,id:Number(value.id),collection_id:Number(value.collection_id),
      status:'published',featured:true,badge:'NOVA COLEÇÃO',
      published_at:value.published_at,product_count:Number(value.product_count || 0)
    });
  }
  const collection = await env.DB.prepare(`
    SELECT id,slug,name,year,description,image_key,status
    FROM mural_collections
    WHERE id=?
    LIMIT 1
  `).bind(id).first();
  if (!collection) return json({ error:'Coleção não encontrada.' },404);
  if (collection.status !== 'active') return json({ error:'Ative a coleção antes de publicar no Mural.' },422);

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM mural_collection_products WHERE collection_id=?'
  ).bind(id).first();
  const productCount = Number(countRow?.total || 0);
  if (productCount < 1) {
    return json({ error:'Adicione pelo menos um produto à coleção antes de publicar.' },422);
  }

  const name = String(collection.name || '').trim();
  const year = collection.year ? String(collection.year) : '';
  const title = year && !name.endsWith(year) ? `${name} ${year}` : name;
  const supporting = String(collection.description || '').trim()
    || `Conheça a nova coleção ${title}.`;
  const publishedAt = new Date().toISOString();

  const existing = await env.DB.prepare(`
    SELECT id
    FROM mural_posts
    WHERE kind='collection' AND collection_id=?
    ORDER BY id DESC
    LIMIT 1
  `).bind(id).first();

  const existingId = Number(existing?.id || 0);
  await env.DB.prepare(`
    UPDATE mural_posts
    SET featured=0,updated_at=CURRENT_TIMESTAMP
    WHERE featured=1 AND status='published' AND id<>?
  `).bind(existingId).run();

  let postId = existingId;
  if (existingId) {
    await env.DB.prepare(`
      UPDATE mural_posts
      SET status='archived',featured=0,updated_at=CURRENT_TIMESTAMP
      WHERE kind='collection' AND collection_id=? AND id<>?
    `).bind(id,existingId).run();
    await env.DB.prepare(`
      UPDATE mural_posts
      SET status='published',
          title=?,
          subtitle=?,
          body=NULL,
          badge='NOVA COLEÇÃO',
          badge_tone='launch',
          product_id=NULL,
          collection_id=?,
          notice_level=NULL,
          featured=1,
          priority=100,
          published_at=?,
          expires_at=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(title,supporting,id,publishedAt,existingId).run();
  } else {
    const result = await env.DB.prepare(`
      INSERT INTO mural_posts
        (kind,status,title,subtitle,body,badge,badge_tone,image_key,product_id,collection_id,notice_level,featured,priority,published_at,expires_at,created_by,updated_at)
      VALUES
        ('collection','published',?,?,NULL,'NOVA COLEÇÃO','launch',NULL,NULL,?,NULL,1,100,?,NULL,'admin',CURRENT_TIMESTAMP)
    `).bind(title,supporting,id,publishedAt).run();
    postId = Number(result.meta.last_row_id);
  }

  return json({
    ok:true,
    id:postId,
    collection_id:Number(id),
    status:'published',
    featured:true,
    badge:'NOVA COLEÇÃO',
    published_at:publishedAt,
    product_count:productCount
  });
}

async function adminMetrics(env) {
  const imageStatsPromise=env.PRODUCT_IMAGES
    ? env.PRODUCT_IMAGES.list({ prefix:'mural/', limit:1000 }).catch(() => ({ objects:[] }))
    : Promise.resolve({objects:[]});

  if (supabasePrimaryWritesRequested(env)) {
    const [metrics,imageStats]=await Promise.all([
      supabaseRpc(env,'nisti_admin_mural_metrics_v1',{}),
      imageStatsPromise
    ]);
    const editorialImages=imageStats?.objects || [];
    const totalImageBytes=editorialImages.reduce((sum,item)=>sum+Number(item.size||0),0);
    return json({
      published_by_month:Array.isArray(metrics?.published_by_month)?metrics.published_by_month:[],
      readers:Number(metrics?.readers || 0),
      editorial_images:{
        count:editorialImages.length,
        average_bytes:editorialImages.length ? Math.round(totalImageBytes/editorialImages.length) : 0
      },
      top_reads:Array.isArray(metrics?.top_reads)?metrics.top_reads:[]
    });
  }

  const [publishedByMonth, readers, topReads, imageStats] = await Promise.all([
    env.DB.prepare(`SELECT substr(published_at,1,7) AS month,COUNT(*) AS total FROM mural_posts WHERE status='published' AND published_at IS NOT NULL GROUP BY substr(published_at,1,7) ORDER BY month DESC LIMIT 12`).all(),
    env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS total FROM mural_post_reads`).first(),
    env.DB.prepare(`SELECT mp.id,mp.title,COUNT(mr.user_id) AS reads FROM mural_posts mp JOIN mural_post_reads mr ON mr.post_id=mp.id GROUP BY mp.id,mp.title ORDER BY reads DESC,mp.id DESC LIMIT 10`).all(),
    imageStatsPromise
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
  if (supabasePrimaryWritesRequested(env)) {
    const payload=await supabaseRpc(env,'nisti_admin_mural_readiness_v1',{});
    const contentRow=payload?.content || {};
    const foldRows=Array.isArray(payload?.fold)?payload.fold:[];
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
      const role = index === 0 && Boolean(row.featured) ? 'hero' : row.kind;
      const budgetBytes = role === 'hero'
        ? MURAL_IMAGE_BUDGETS.hero
        : MURAL_IMAGE_BUDGETS[role] || null;
      const imageRequired = role === 'hero' || row.kind === 'product' || row.kind === 'collection';
      const missingRequiredImage = imageRequired && !key;
      return {
        id:Number(row.id),title:row.title,kind:row.kind,role,image_key:key,
        image_required:imageRequired,missing_required_image:missingRequiredImage,bytes,
        budget_bytes:budgetBytes,
        within_budget:missingRequiredImage ? false : bytes === null || budgetBytes === null ? null : bytes <= budgetBytes
      };
    }));
    const knownImageBytes=imageItems.reduce((sum,item)=>sum+(Number.isFinite(item.bytes)?item.bytes:0),0);
    const allResolvable=imageItems.every(item=>!item.image_key||Number.isFinite(item.bytes));
    const itemBudgetsOk=imageItems.every(item=>item.within_budget!==false);
    const firstFoldOk=allResolvable && knownImageBytes<=MURAL_IMAGE_BUDGETS.first_fold;
    const publishedNow=Number(contentRow?.total || 0);
    const contentOk=publishedNow>=3;
    const imagesOk=Boolean(env.PRODUCT_IMAGES) && firstFoldOk && itemBudgetsOk;
    return json({
      migration:{ok:true,present_tables:MURAL_REQUIRED_TABLES,missing_tables:[]},
      content:{
        ok:contentOk,published_now:publishedNow,minimum_for_qa:3,
        by_kind:{
          product:Number(contentRow?.products || 0),
          collection:Number(contentRow?.collections || 0),
          notice:Number(contentRow?.notices || 0)
        }
      },
      images:{
        ok:imagesOk,available:Boolean(env.PRODUCT_IMAGES),first_fold_bytes:knownImageBytes,
        first_fold_budget_bytes:MURAL_IMAGE_BUDGETS.first_fold,all_resolvable:allResolvable,items:imageItems
      },
      automated_ready:contentOk && imagesOk
    });
  }

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
  const requestedLimit = Number(url.searchParams.get('limit') || 80);
  const productLimit = Number.isInteger(requestedLimit) ? Math.max(1,Math.min(500,requestedLimit)) : 80;
  let results=[];

  if (supabasePrimaryWritesRequested(env)) {
    const rows=await supabaseRpc(env,'nisti_admin_mural_products_v1',{
      p_query:q || null,p_limit:productLimit
    });
    results=Array.isArray(rows)?rows:[];
  } else {
    const like = `%${q}%`;
    const response=await env.DB.prepare(`
      SELECT p.id,p.sku,p.nome,p.variacao,p.image_key,p.wireo_code,p.tassel_code,p.elastico_code,p.miolo_code,
        mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,mpi.source_image_key AS mural_source_image_key,
        mpi.processed_image_key AS mural_processed_image_key,mpi.processor_version AS mural_image_processor_version,mpi.processor AS mural_image_processor,
        mpi.reviewed_at AS mural_image_reviewed_at,mpi.error_message AS mural_image_error,
        (
          SELECT mc2.name
          FROM mural_collection_products mcp2
          INNER JOIN mural_collections mc2 ON mc2.id=mcp2.collection_id
          WHERE mcp2.product_id=p.id AND mc2.status='active'
          ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
          LIMIT 1
        ) AS collection_name
      FROM products p
      LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
      WHERE (?='' OR sku LIKE ? OR nome LIKE ? OR variacao LIKE ?)
      ORDER BY p.updated_at DESC,p.id DESC LIMIT ?
    `).bind(q,like,like,like,productLimit).all();
    results=response.results || [];
  }

  return json({items:(results||[]).map(row=>{
    const labels=finishLabels(row);
    const reviewable = (
      row.mural_image_status === 'review'
      || (row.mural_image_status === 'approved' && row.mural_image_reviewed_by !== 'admin')
    )
      && row.mural_processed_image_key
      && row.mural_source_image_key === row.image_key
      && row.mural_image_processor_version === PRODUCT_IMAGE_PROCESSOR_VERSION;
    return {
      ...row,
      ...labels,
      type:productTypeLabel(row),
      original_image_url:row.image_key?`/api/images/${row.id}?v=${encodeURIComponent(row.image_key)}`:null,
      image_url:muralProductImageUrl(row),
      review_image_url:reviewable
        ? `/api/admin/product-image-treatment/${row.id}/preview?v=${encodeURIComponent(row.mural_processed_image_key)}`
        : null,
      mural_image_ready:Boolean(approvedMuralProductKey(row)),
      mural_image_reviewable:Boolean(reviewable)
    };
  })});
}

function inspectTransparentPng(bytes) {
  const view = new Uint8Array(bytes);
  const signature = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  if (view.length < 33 || signature.some((value,index)=>view[index]!==value)) return null;
  const dataView = new DataView(bytes);
  const width = dataView.getUint32(16);
  const height = dataView.getUint32(20);
  const colorType = view[25];
  if (![4,6].includes(colorType) || width < 1 || height < 1 || width > 6000 || height > 6000) return null;
  return { width, height };
}

async function uploadMuralProductImage(productId, request, env) {
  if (!env.PRODUCT_IMAGES) return json({ error:'Armazenamento de imagens indisponível.' },503);
  const product = supabasePrimaryWritesRequested(env)
    ? await supabaseRpc(env,'nisti_admin_mural_product_reference_v1',{p_product_id:productId})
    : await env.DB.prepare('SELECT id,image_key FROM products WHERE id=?').bind(productId).first();
  if (!product) return json({ error:'Produto não encontrado.' },404);
  if (!product.image_key) return json({ error:'O produto ainda não possui imagem original.' },422);

  const form = await request.formData();
  const file = form.get('image');
  if (!(file instanceof File)) return json({ error:'Envie o PNG tratado no campo image.' },400);
  if (file.size < 1 || file.size > MAX_MURAL_PRODUCT_IMAGE_BYTES) {
    return json({ error:'O PNG tratado deve ter no máximo 8 MB.' },400);
  }
  const bytes = await file.arrayBuffer();
  const png = inspectTransparentPng(bytes);
  if (!png) return json({ error:'Envie um PNG com canal de transparência e até 6000 × 6000 px.' },400);

  const currentProcessed=product.mural_processed_image_key || (
    supabasePrimaryWritesRequested(env) ? null : (
      await env.DB.prepare('SELECT processed_image_key FROM mural_product_images WHERE product_id=?').bind(productId).first()
    )?.processed_image_key
  );
  const key = `mural/products/${productId}/${crypto.randomUUID()}.png`;
  await env.PRODUCT_IMAGES.put(key, bytes, {
    httpMetadata:{ contentType:'image/png' },
    customMetadata:{ sourceImageKey:String(product.image_key), width:String(png.width), height:String(png.height) }
  });

  if (supabasePrimaryWritesRequested(env)) {
    try {
      const saved=await mirrorSupabaseRpc(env,'nisti_set_product_treatment_v1',{
        p_product_id:productId,p_action:'review',p_processed_image_key:key,
        p_processor:'admin-upload',p_processor_version:'1',p_error_message:null
      },`mural product image ${productId}`);
      if(saved?.value?.status!=='ok') {
        await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
        return json({error:'Produto não encontrado.'},404);
      }
      if(saved.value.old_processed_image_key && saved.value.old_processed_image_key!==key) {
        await env.PRODUCT_IMAGES.delete(saved.value.old_processed_image_key).catch(()=>{});
      }
    } catch(error) {
      await env.PRODUCT_IMAGES.delete(key).catch(()=>{});
      throw error;
    }
  } else {
    await env.DB.prepare(`
      INSERT INTO mural_product_images (
        product_id,source_image_key,processed_image_key,status,processor,
        processor_version,reviewed_by,reviewed_at,error_message,updated_at
      ) VALUES (?,?,?,'review','admin-upload','1',NULL,NULL,NULL,CURRENT_TIMESTAMP)
      ON CONFLICT(product_id) DO UPDATE SET
        source_image_key=excluded.source_image_key,
        processed_image_key=excluded.processed_image_key,
        status='review',
        processor='admin-upload',
        processor_version='1',
        reviewed_by=NULL,
        reviewed_at=NULL,
        error_message=NULL,
        updated_at=CURRENT_TIMESTAMP
    `).bind(productId,product.image_key,key).run();
    if (currentProcessed && currentProcessed !== key) {
      await env.PRODUCT_IMAGES.delete(currentProcessed).catch(()=>{});
    }
  }

  return json({
    ok:true,
    product_id:productId,
    status:'review',
    image_url:`/api/admin/product-image-treatment/${productId}/preview?v=${encodeURIComponent(key)}`,
    width:png.width,
    height:png.height
  });
}

async function removeMuralProductImage(productId, env) {
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_clear_product_treatment_v1',{
      p_product_id:productId
    },`clear mural product image ${productId}`);
    const value=result?.value || {};
    if(value.status==='not_found') return json({error:'Produto não encontrado.'},404);
    if(value.old_processed_image_key) await env.PRODUCT_IMAGES?.delete(value.old_processed_image_key).catch(()=>{});
    return json({ok:true,product_id:productId,status:'pending'});
  }

  const row = await env.DB.prepare(`
    SELECT p.image_key,mpi.processed_image_key
    FROM products p
    LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.id=?
  `).bind(productId).first();
  if (!row) return json({ error:'Produto não encontrado.' },404);
  await env.DB.prepare(`
    INSERT INTO mural_product_images (product_id,source_image_key,status,updated_at)
    VALUES (?,?,'pending',CURRENT_TIMESTAMP)
    ON CONFLICT(product_id) DO UPDATE SET
      source_image_key=excluded.source_image_key,
      processed_image_key=NULL,
      status='pending',processor=NULL,processor_version=NULL,
      reviewed_by=NULL,reviewed_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP
  `).bind(productId,row.image_key).run();
  if (row.processed_image_key) await env.PRODUCT_IMAGES.delete(row.processed_image_key).catch(()=>{});
  return json({ ok:true, product_id:productId, status:'pending' });
}


async function adminSendPush(id, env) {
  const post = supabasePrimaryWritesRequested(env)
    ? await supabaseRpc(env,'nisti_admin_mural_post_v1',{p_id:id})
    : await env.DB.prepare(`SELECT mp.id,mp.kind,mp.status,mp.title,mp.subtitle,mp.notice_level,mp.product_id,p.sku FROM mural_posts mp LEFT JOIN products p ON p.id=mp.product_id WHERE mp.id=?`).bind(id).first();
  if (post?.product_sku && !post.sku) post.sku=post.product_sku;
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
      const id=Number(postImage[1]);
      const imageKey=await preferSupabaseRead(
        env,
        () => supabaseReserveMuralPostImage(env,id),
        async () => {
          const row=await env.DB.prepare(`SELECT image_key FROM mural_posts WHERE id=? AND status='published' AND published_at IS NOT NULL AND datetime(published_at)<=CURRENT_TIMESTAMP AND (expires_at IS NULL OR datetime(expires_at)>CURRENT_TIMESTAMP)`).bind(id).first();
          return row?.image_key || null;
        },
        'mural:post-image'
      );
      return serveEditorialImage(imageKey,env);
    }

    const collectionImage = path.match(/^\/api\/mural\/collections\/([^/]+)\/image$/);
    if (collectionImage && request.method === 'GET') {
      const slug=decodeURIComponent(collectionImage[1]);
      const imageKey=await preferSupabaseRead(
        env,
        () => supabaseReserveMuralCollectionImage(env,slug),
        async () => {
          const row=await env.DB.prepare("SELECT image_key FROM mural_collections WHERE slug=? AND status='active'").bind(slug).first();
          return row?.image_key || null;
        },
        'mural:collection-image'
      );
      return serveEditorialImage(imageKey,env);
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

    const adminMuralProductImage = path.match(/^\/api\/admin\/mural\/products\/(\d+)\/image$/);
    if (adminMuralProductImage && request.method === 'POST') {
      return uploadMuralProductImage(Number(adminMuralProductImage[1]),request,env);
    }
    if (adminMuralProductImage && request.method === 'DELETE') {
      return removeMuralProductImage(Number(adminMuralProductImage[1]),env);
    }

    const adminPostImageView = path.match(/^\/api\/admin\/mural\/posts\/(\d+)\/image$/);
    if (adminPostImageView && request.method === 'GET') {
      const id=Number(adminPostImageView[1]);
      const imageKey=supabasePrimaryWritesRequested(env)
        ? await supabaseRpc(env,'nisti_admin_mural_image_key_v1',{p_owner:'posts',p_id:id})
        : (await env.DB.prepare('SELECT image_key FROM mural_posts WHERE id=?').bind(id).first())?.image_key;
      return serveEditorialImage(imageKey, env, { isPublic:false });
    }
    const adminCollectionImageView = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/image$/);
    if (adminCollectionImageView && request.method === 'GET') {
      const id=Number(adminCollectionImageView[1]);
      const imageKey=supabasePrimaryWritesRequested(env)
        ? await supabaseRpc(env,'nisti_admin_mural_image_key_v1',{p_owner:'collections',p_id:id})
        : (await env.DB.prepare('SELECT image_key FROM mural_collections WHERE id=?').bind(id).first())?.image_key;
      return serveEditorialImage(imageKey, env, { isPublic:false });
    }

    const adminPost = path.match(/^\/api\/admin\/mural\/posts\/(\d+)$/);
    if (adminPost && request.method === 'GET') return adminGetPost(Number(adminPost[1]), env);
    if (adminPost && request.method === 'PUT') return adminUpdatePost(Number(adminPost[1]), request, env);
    if (adminPost && request.method === 'DELETE') return adminDeletePost(Number(adminPost[1]), env);

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
    const publishCollection = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/publish$/);
    if (publishCollection && request.method === 'POST') return adminPublishCollection(Number(publishCollection[1]), env);
    const collectionUpload = path.match(/^\/api\/admin\/mural\/collections\/(\d+)\/image$/);
    if (collectionUpload && request.method === 'POST') return uploadEditorialImage(request, env, 'collections', Number(collectionUpload[1]));

    return null;
  } catch (error) {
    console.error('Falha no Mural NISTI.', { method: request.method, path, message: error?.message || String(error) });
    return json({ error: 'Falha ao processar a solicitação do Mural NISTI.' }, 500);
  }
}
