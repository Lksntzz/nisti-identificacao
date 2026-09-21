import app from './product-finish-router.js';
import { normalizeGtin, requireValidGtin13 } from './gtin.js';
import { ACCESSORY_COLORS, WIREO_COLORS } from './sku.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeSource(value) {
  const source = String(value || 'GS1').trim().toUpperCase();
  return source || 'GS1';
}

const GTIN_EVENT_STATUSES = new Set(['identified', 'not_found', 'system_error']);
let gtinEventsTableReady = false;
let gtinEventsTablePromise = null;

async function ensureGtinScanEventsTable(env) {
  if (gtinEventsTableReady) return;
  if (!gtinEventsTablePromise) gtinEventsTablePromise = env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS gtin_scan_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gtin TEXT NOT NULL,
        status TEXT NOT NULL,
        product_id INTEGER,
        operator_name TEXT,
        operator_id TEXT,
        response_ms INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
        CHECK (length(gtin) = 13 AND gtin NOT GLOB '*[^0-9]*'),
        CHECK (status IN ('identified','not_found','system_error'))
      )
    `),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_created_at ON gtin_scan_events(created_at DESC)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_status_created_at ON gtin_scan_events(status,created_at DESC)')
  ]);
  try {
    await gtinEventsTablePromise;
    gtinEventsTableReady = true;
  } catch (error) {
    gtinEventsTablePromise = null;
    throw error;
  }
}

function cleanEventText(value, maxLength = 80) {
  return String(value || '').trim().slice(0, maxLength) || null;
}

async function recordGtinScanEvent(request, env) {
  const body = await request.json().catch(() => ({}));
  const gtin = requireValidGtin13(body?.gtin);
  const status = String(body?.status || '').trim();
  if (!GTIN_EVENT_STATUSES.has(status)) {
    const error = new Error('Status de leitura EAN inválido.');
    error.code = 'gtin_event_status_invalid';
    error.status = 400;
    throw error;
  }

  await ensureGtinScanEventsTable(env);
  const productId = Number(body?.product_id || 0) || null;
  const responseMs = Math.max(0, Math.min(120000, Math.round(Number(body?.response_ms || 0))));
  const operatorHeader = request.headers.get('x-operator-name');
  let operatorName = cleanEventText(body?.operator_name);
  if (!operatorName && operatorHeader) {
    try { operatorName = cleanEventText(decodeURIComponent(operatorHeader)); }
    catch { operatorName = cleanEventText(operatorHeader); }
  }

  await env.DB.prepare(`
    INSERT INTO gtin_scan_events (
      gtin,status,product_id,operator_name,operator_id,response_ms,error_code
    ) VALUES (?,?,?,?,?,?,?)
  `).bind(
    gtin,
    status,
    productId,
    operatorName,
    cleanEventText(request.headers.get('x-user-id')),
    responseMs,
    cleanEventText(body?.error_code, 100)
  ).run();

  return json({ ok: true }, 201);
}

async function adminGtinEvents(url, env) {
  await ensureGtinScanEventsTable(env);
  const requestedStatus = String(url.searchParams.get('status') || '').trim();
  const status = GTIN_EVENT_STATUSES.has(requestedStatus) ? requestedStatus : '';
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 80);
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 150)));
  const clauses = [];
  const bindings = [];
  if (status) {
    clauses.push('e.status=?');
    bindings.push(status);
  }
  if (query) {
    clauses.push('(e.gtin LIKE ? OR e.operator_name LIKE ? OR p.sku LIKE ? OR p.nome LIKE ?)');
    const pattern = `%${query}%`;
    bindings.push(pattern, pattern, pattern, pattern);
  }
  bindings.push(limit);

  const { results } = await env.DB.prepare(`
    SELECT
      e.id,e.gtin,e.status,e.product_id,e.operator_name,e.operator_id,
      e.response_ms,e.error_code,e.created_at,
      p.sku,p.nome,p.variacao,p.capa_code,p.image_key
    FROM gtin_scan_events e
    LEFT JOIN products p ON p.id=e.product_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY e.id DESC
    LIMIT ?
  `).bind(...bindings).all();

  return json({
    events: (results || []).map(row => ({
      ...row,
      id: Number(row.id),
      product_id: row.product_id ? Number(row.product_id) : null,
      response_ms: Number(row.response_ms || 0),
      image_url: row.image_key && row.product_id ? `/api/images/${Number(row.product_id)}` : null
    }))
  });
}

async function adminGtinRegistry(env) {
  const [{ results }, totals, covered] = await Promise.all([
    env.DB.prepare(`
      SELECT
        g.id,g.product_id,g.gtin,g.gtin_type,g.source,g.active,g.created_at,g.updated_at,
        p.sku,p.nome,p.variacao,p.capa_code,p.image_key
      FROM product_gtins g
      INNER JOIN products p ON p.id=g.product_id
      ORDER BY g.active DESC,g.id DESC
      LIMIT 2000
    `).all(),
    env.DB.prepare('SELECT COUNT(*) AS total FROM products').first(),
    env.DB.prepare('SELECT COUNT(DISTINCT product_id) AS total FROM product_gtins WHERE active=1').first()
  ]);
  const gtins = (results || []).map(row => ({
    ...row,
    id: Number(row.id),
    product_id: Number(row.product_id),
    active: Number(row.active) === 1,
    image_url: row.image_key ? `/api/images/${Number(row.product_id)}` : null
  }));
  return json({
    gtins,
    stats: {
      active_gtins: gtins.filter(item => item.active).length,
      products_total: Number(totals?.total || 0),
      products_with_gtin: Number(covered?.total || 0),
      products_without_gtin: Math.max(0, Number(totals?.total || 0) - Number(covered?.total || 0))
    }
  });
}

async function adminGtinDashboard(env) {
  await ensureGtinScanEventsTable(env);
  const [active, covered, today] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS total FROM product_gtins WHERE active=1').first(),
    env.DB.prepare('SELECT COUNT(DISTINCT product_id) AS total FROM product_gtins WHERE active=1').first(),
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='identified' THEN 1 ELSE 0 END) AS identified,
        SUM(CASE WHEN status='not_found' THEN 1 ELSE 0 END) AS not_found,
        SUM(CASE WHEN status='system_error' THEN 1 ELSE 0 END) AS system_errors
      FROM gtin_scan_events
      WHERE date(created_at,'-3 hours')=date('now','-3 hours')
    `).first()
  ]);
  return json({
    active_gtins: Number(active?.total || 0),
    products_with_gtin: Number(covered?.total || 0),
    today: {
      total: Number(today?.total || 0),
      identified: Number(today?.identified || 0),
      not_found: Number(today?.not_found || 0),
      system_errors: Number(today?.system_errors || 0)
    }
  });
}

function productFinishLabels(row) {
  return {
    wireo: WIREO_COLORS[row?.wireo_code] || row?.wireo_code || null,
    tassel: row?.tassel_code === 'X'
      ? 'Sem tassel'
      : ACCESSORY_COLORS[row?.tassel_code] || row?.tassel_code || null,
    elastico: ACCESSORY_COLORS[row?.elastico_code] || row?.elastico_code || null
  };
}

async function productExists(env, productId) {
  return env.DB.prepare('SELECT id FROM products WHERE id=? LIMIT 1')
    .bind(productId)
    .first();
}

async function listProductGtins(env, productId) {
  const { results } = await env.DB.prepare(`
    SELECT id,product_id,gtin,gtin_type,source,active,created_at,updated_at
    FROM product_gtins
    WHERE product_id=?
    ORDER BY active DESC,id ASC
  `).bind(productId).all();

  return (results || []).map(row => ({
    ...row,
    id: Number(row.id),
    product_id: Number(row.product_id),
    active: Number(row.active) === 1
  }));
}

async function lookupProductByGtin(env, gtin) {
  const row = await env.DB.prepare(`
    SELECT
      g.gtin,g.gtin_type,g.source,
      p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,
      p.wireo_code,p.tassel_code,p.elastico_code,
      p.nome,p.variacao,p.image_key
    FROM product_gtins g
    INNER JOIN products p ON p.id=g.product_id
    WHERE g.gtin=? AND g.active=1
    LIMIT 1
  `).bind(gtin).first();

  if (!row) return null;

  const { results: platformRows } = await env.DB.prepare(`
    SELECT platform,link
    FROM product_platforms
    WHERE product_id=?
    ORDER BY id ASC
  `).bind(row.id).all();

  const finishLabels = productFinishLabels(row);

  return {
    gtin: row.gtin,
    gtin_type: row.gtin_type,
    source: row.source,
    product: {
      id: Number(row.id),
      sku: row.sku,
      miolo_code: row.miolo_code,
      capa_code: row.capa_code,
      acabamento_code: row.acabamento_code,
      wireo_code: row.wireo_code,
      tassel_code: row.tassel_code,
      elastico_code: row.elastico_code,
      wireo: finishLabels.wireo,
      tassel: finishLabels.tassel,
      elastico: finishLabels.elastico,
      nome: row.nome,
      variacao: row.variacao,
      image_key: row.image_key,
      image_url: row.image_key ? `/api/images/${Number(row.id)}` : null,
      platforms: (platformRows || []).map(item => ({
        platform: item.platform,
        link: item.link || null
      }))
    }
  };
}

async function bindGtinToProduct(env, productId, gtin, source) {
  const product = await productExists(env, productId);
  if (!product) {
    const error = new Error('Produto não encontrado.');
    error.code = 'product_not_found';
    error.status = 404;
    throw error;
  }

  const existing = await env.DB.prepare(`
    SELECT id,product_id,active
    FROM product_gtins
    WHERE gtin=?
    LIMIT 1
  `).bind(gtin).first();

  if (existing && Number(existing.active) === 1 && Number(existing.product_id) !== productId) {
    const error = new Error('Este GTIN já está vinculado a outro produto.');
    error.code = 'gtin_conflict';
    error.status = 409;
    error.productId = Number(existing.product_id);
    throw error;
  }

  if (existing) {
    await env.DB.prepare(`
      UPDATE product_gtins
      SET product_id=?,gtin_type='GTIN-13',source=?,active=1,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(productId, source, existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO product_gtins (product_id,gtin,gtin_type,source,active)
      VALUES (?,?,'GTIN-13',?,1)
    `).bind(productId, gtin, source).run();
  }

  return env.DB.prepare(`
    SELECT id,product_id,gtin,gtin_type,source,active,created_at,updated_at
    FROM product_gtins
    WHERE gtin=?
    LIMIT 1
  `).bind(gtin).first();
}

async function deactivateProductGtin(env, productId, gtin) {
  const existing = await env.DB.prepare(`
    SELECT id,product_id,active
    FROM product_gtins
    WHERE gtin=?
    LIMIT 1
  `).bind(gtin).first();

  if (!existing || Number(existing.product_id) !== productId) return false;

  await env.DB.prepare(`
    UPDATE product_gtins
    SET active=0,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(existing.id).run();
  return true;
}

function errorResponse(error) {
  const status = Number(error?.status || 500);
  const payload = {
    error: error?.message || 'Falha ao processar GTIN.',
    technical_error: error?.code || 'gtin_error'
  };
  if (error?.productId) payload.conflicting_product_id = Number(error.productId);
  return json(payload, status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/api/gtin-events' && request.method === 'POST') {
      try { return await recordGtinScanEvent(request, env); }
      catch (error) { return errorResponse(error); }
    }

    if (pathname === '/api/admin/gtin-events' && request.method === 'GET') {
      try { return await adminGtinEvents(url, env); }
      catch (error) { return errorResponse(error); }
    }

    if (pathname === '/api/admin/gtins' && request.method === 'GET') {
      try { return await adminGtinRegistry(env); }
      catch (error) { return errorResponse(error); }
    }

    if (pathname === '/api/admin/gtin-dashboard' && request.method === 'GET') {
      try { return await adminGtinDashboard(env); }
      catch (error) { return errorResponse(error); }
    }

    const publicLookup = pathname.match(/^\/api\/gtin\/([^/]+)$/);
    if (publicLookup && request.method === 'GET') {
      try {
        const gtin = requireValidGtin13(decodeURIComponent(publicLookup[1]));
        const result = await lookupProductByGtin(env, gtin);
        if (!result) {
          return json({
            error: 'GTIN não cadastrado.',
            technical_error: 'gtin_not_found',
            gtin
          }, 404);
        }
        return json({ ok: true, ...result });
      } catch (error) {
        return errorResponse(error);
      }
    }

    const productGtins = pathname.match(/^\/api\/products\/(\d+)\/gtins$/);
    if (productGtins && request.method === 'GET') {
      try {
        const productId = Number(productGtins[1]);
        const product = await productExists(env, productId);
        if (!product) return json({ error: 'Produto não encontrado.', technical_error: 'product_not_found' }, 404);
        return json({ ok: true, product_id: productId, gtins: await listProductGtins(env, productId) });
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (productGtins && request.method === 'POST') {
      try {
        const productId = Number(productGtins[1]);
        const body = await request.json().catch(() => ({}));
        const gtin = requireValidGtin13(body?.gtin);
        const source = normalizeSource(body?.source);
        const row = await bindGtinToProduct(env, productId, gtin, source);
        return json({
          ok: true,
          gtin: {
            ...row,
            id: Number(row.id),
            product_id: Number(row.product_id),
            active: Number(row.active) === 1
          }
        });
      } catch (error) {
        return errorResponse(error);
      }
    }

    const productGtin = pathname.match(/^\/api\/products\/(\d+)\/gtins\/([^/]+)$/);
    if (productGtin && request.method === 'DELETE') {
      try {
        const productId = Number(productGtin[1]);
        const gtin = requireValidGtin13(decodeURIComponent(productGtin[2]));
        const removed = await deactivateProductGtin(env, productId, gtin);
        if (!removed) {
          return json({
            error: 'GTIN não encontrado para este produto.',
            technical_error: 'gtin_not_found',
            gtin
          }, 404);
        }
        return json({ ok: true, gtin, product_id: productId, active: false });
      } catch (error) {
        return errorResponse(error);
      }
    }

    return app.fetch(request, env, ctx);
  }
};

export {
  lookupProductByGtin,
  bindGtinToProduct,
  deactivateProductGtin,
  listProductGtins,
  productFinishLabels
};
