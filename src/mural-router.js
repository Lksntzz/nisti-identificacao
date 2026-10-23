import { WIREO_COLORS, ACCESSORY_COLORS } from './sku.js';
import { productTypeLabel } from './product-display.js';
import { PRODUCT_IMAGE_PROCESSOR_VERSION } from './product-image-processor-version.js';
import { broadcastMuralPush } from './web-push.js';
import { createMuralCollectionHandlers } from './mural-collection-routes.js';
import { createMuralPostHandlers } from './mural-post-routes.js';
import { createMuralImageHandlers } from './mural-image-routes.js';
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

const MURAL_PUBLIC_RELEASED = true;

// This is the same release gate that protects the operator Mural.
// Preparing and publishing content in admin never sends push before release.
async function notifyMuralAfterPublication(env, postId) {
  if (!MURAL_PUBLIC_RELEASED) return;
  try {
    await broadcastMuralPush(env, { postId, released: MURAL_PUBLIC_RELEASED });
  } catch (error) {
    console.error('[Mural Push] Publicação salva, mas envio falhou', {
      postId, message: error?.message || String(error)
    });
  }
}


// Cron fallback for scheduled publications and bounded transient delivery failures.
// Never read recipient subscriptions or dispatch when the operator Mural is locked.
export async function dispatchScheduledMuralNotifications(env) {
  if (!MURAL_PUBLIC_RELEASED) {
    return { skipped:true, reason:'mural_not_released', sent:0, failed:0 };
  }
  const pending = await supabaseRpc(env,'nisti_list_mural_push_ready_v1',{p_limit:20});
  const ids = Array.isArray(pending) ? pending : [];
  let sent=0;
  let failed=0;
  // Bounded concurrency avoids an unbounded request spike in cron.
  for (let offset=0;offset<ids.length;offset+=3) {
    const batch=ids.slice(offset,offset+3);
    const results=await Promise.all(batch.map(async id=>{
      try {
        return await broadcastMuralPush(env,{postId:Number(id),released:MURAL_PUBLIC_RELEASED});
      } catch (error) {
        console.error('[Mural Push Cron] Não foi possível processar a publicação', {
          postId:id,message:error?.message || String(error)
        });
        return {sent:0,failed:1};
      }
    }));
    for (const result of results) {
      sent+=Number(result?.sent||0);
      failed+=Number(result?.failed||0);
    }
  }
  return { skipped:false, posts:ids.length, sent, failed };
}


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
  const value=String(request.headers.get('x-user-id')||'').trim();
  return /^op_[0-9a-f-]{36}$/i.test(value) ? value : null;
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
          show_year: row.collection_show_year !== false && Number(row.collection_show_year ?? 1) !== 0,
          hero_message: row.collection_hero_message || null,
          visual_direction: row.collection_visual_direction || 'automatic',
          theme_notes: row.collection_theme_notes || null,
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
  if(!userId)return json({error:'Sessão do operador inválida.'},401);
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
          mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,mc.year AS collection_year,mc.show_year AS collection_show_year,mc.hero_message AS collection_hero_message,mc.visual_direction AS collection_visual_direction,mc.theme_notes AS collection_theme_notes,mc.description AS collection_description,mc.image_key AS collection_image_key,
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

async function getMuralNotificationPost(postId, request, env) {
  const userId = cleanUserId(request);
  if (!userId) return json({ error: 'Sessão do operador inválida.' }, 401);
  const row = await preferSupabaseRead(
    env,
    () => supabaseRpc(env, 'nisti_mural_notification_post_v1', {
      p_post_id: postId, p_user_id: userId
    }),
    async () => env.DB.prepare(`
      SELECT mp.id,mp.kind,mp.title,mp.subtitle,mp.body,mp.badge,mp.badge_tone,
        mp.featured,mp.priority,mp.published_at,mp.expires_at,mp.image_key,mp.notice_level,
        p.id AS product_id,p.sku,p.miolo_code,p.nome AS product_name,p.wireo_code,
        p.tassel_code,p.elastico_code,p.image_key AS product_image_key,
        mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
        mpi.source_image_key AS mural_source_image_key,
        mpi.processed_image_key AS mural_processed_image_key,
        mpi.processor_version AS mural_image_processor_version,
        mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,
        mc.year AS collection_year,mc.show_year AS collection_show_year,
        mc.hero_message AS collection_hero_message,mc.visual_direction AS collection_visual_direction,
        mc.theme_notes AS collection_theme_notes,mc.description AS collection_description,
        mc.image_key AS collection_image_key,
        CASE WHEN mr.post_id IS NULL THEN 0 ELSE 1 END AS is_read
      FROM mural_posts mp
      LEFT JOIN products p ON p.id=mp.product_id
      LEFT JOIN mural_product_images mpi ON mpi.product_id=p.id
      LEFT JOIN mural_collections mc ON mc.id=mp.collection_id
      LEFT JOIN mural_post_reads mr ON mr.post_id=mp.id AND mr.user_id=?
      WHERE mp.id=? AND mp.status='published' AND mp.published_at IS NOT NULL
        AND datetime(mp.published_at)<=CURRENT_TIMESTAMP
        AND (mp.expires_at IS NULL OR datetime(mp.expires_at)>CURRENT_TIMESTAMP)
      LIMIT 1
    `).bind(userId,postId).first(),
    'mural:notification-post'
  );
  if (!row) return json({ error: 'Publicação indisponível.' }, 404);
  return json({ item: mapFeedRow(row) });
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
        SELECT id,slug,name,year,show_year,hero_message,visual_direction,theme_notes,description,image_key,status
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
      show_year:collection.show_year !== false && Number(collection.show_year ?? 1) !== 0,
      hero_message:collection.hero_message || null,
      visual_direction:collection.visual_direction || 'automatic',
      theme_notes:collection.theme_notes || null,
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

const {
  adminListPosts, adminGetPost, adminCreatePost, adminUpdatePost,
  adminPublishPost, adminArchivePost, adminDuplicatePost, adminDeletePost
} = createMuralPostHandlers({
  ADMIN_KINDS, ADMIN_STATUSES, json, readJson, validatePostPayload,
  normalizeDate, finishLabels, notifyMuralAfterPublication
});

const {
  uploadEditorialImage, serveEditorialImage, removeEditorialImage,
  uploadMuralProductImage, removeMuralProductImage
} = createMuralImageHandlers({ json });

const {
  adminListCollections,
  adminCreateCollection,
  adminUpdateCollection,
  adminSetCollectionProducts,
  adminPublishCollection
} = createMuralCollectionHandlers({ json, readJson, nullableText, requiredText, notifyMuralAfterPublication });

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


async function adminProducts(url, env) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0,80);
  const requestedLimit = Number(url.searchParams.get('limit') || 80);
  const productLimit = Number.isInteger(requestedLimit) ? Math.max(1,Math.min(500,requestedLimit)) : 80;
  let results;

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

async function adminSendPush(id, env) {
  // Even administrators cannot send operator push during the private QA phase.
  if (!MURAL_PUBLIC_RELEASED) {
    return json({ error: 'As notificações push do Mural estarão disponíveis apenas após a liberação aos operadores.' }, 409);
  }
  const post = supabasePrimaryWritesRequested(env)
    ? await supabaseRpc(env,'nisti_admin_mural_post_v1',{p_id:id})
    : await env.DB.prepare('SELECT id,kind,status,published_at,expires_at FROM mural_posts WHERE id=?').bind(id).first();
  if (!post) return json({error:'Publicação não encontrada.'},404);
  if (post.status !== 'published') return json({error:'Publique o conteúdo antes de notificar.'},409);
  if (!['collection','product','notice'].includes(post.kind)) return json({error:'Tipo de publicação não suportado.'},422);
  const result = await broadcastMuralPush(env,{postId:Number(post.id),released:MURAL_PUBLIC_RELEASED});
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
      const userId=cleanUserId(request);
      if(!userId)return json({error:'Sessão do operador inválida.'},401);
      return json({ unread_count: await unreadCount(userId, env) });
    }

    const notificationPost = path.match(/^\/api\/mural\/posts\/(\d+)$/);
    if (notificationPost && request.method === 'GET') {
      return getMuralNotificationPost(Number(notificationPost[1]), request, env);
    }

    const read = path.match(/^\/api\/mural\/(\d+)\/read$/);
    if (read && request.method === 'POST') {
      const userId=cleanUserId(request);
      if(!userId)return json({error:'Sessão do operador inválida.'},401);
      return await markRead(Number(read[1]), userId, env);
    }

    if (path === '/api/mural/mark-all-read' && request.method === 'POST') {
      const userId=cleanUserId(request);
      if(!userId)return json({error:'Sessão do operador inválida.'},401);
      return await markAllRead(userId, env);
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
