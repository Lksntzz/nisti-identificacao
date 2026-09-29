import { WIREO_COLORS, ACCESSORY_COLORS } from './sku.js';
import { productTypeLabel } from './product-display.js';

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

function mapFeedRow(row) {
  const productId = row.product_id ? Number(row.product_id) : null;
  const collectionId = row.collection_id ? Number(row.collection_id) : null;
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
      ? `/api/mural/images/${Number(row.id)}`
      : productId && row.product_image_key
        ? `/api/images/${productId}`
        : null,
    product_available: productAvailable,
    product: row.kind === 'product'
      ? {
          id: productId,
          sku: row.sku || null,
          type: productTypeLabel(row),
          collection: row.collection_name || null,
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
          year: row.collection_year ? Number(row.collection_year) : null
        }
      : null,
    notice_level: row.notice_level || null
  };
}

async function listMuralFeed(request, url, env) {
  const tab = String(url.searchParams.get('tab') || 'all').trim().toLowerCase();
  if (!(tab in TAB_KIND)) return json({ error: 'Filtro do Mural inválido.' }, 400);

  const limit = clampLimit(url.searchParams.get('limit'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));
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
      mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,mc.year AS collection_year,
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

  return json({
    items: page.map(mapFeedRow),
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
      image_url: collection.image_key ? `/api/mural/collections/${encodeURIComponent(collection.slug)}/image` : null,
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
          image_url: row.image_key ? `/api/images/${Number(row.id)}` : null,
          sort_order: Number(row.sort_order || 0)
        };
      })
    }
  });
}

export async function handleMuralRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  try {
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

    const collection = path.match(/^\/api\/mural\/collections\/([^/]+)$/);
    if (collection && request.method === 'GET') {
      return await collectionDetail(decodeURIComponent(collection[1]), env);
    }

    return null;
  } catch (error) {
    console.error('Falha no Mural NISTI.', error);
    return json({ error: 'Falha ao carregar o Mural NISTI.' }, 500);
  }
}
