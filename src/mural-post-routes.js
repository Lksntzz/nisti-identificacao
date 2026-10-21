import { productTypeLabel } from './product-display.js';
import { supabaseRpc } from './supabase-read-store.js';
import { mirrorSupabaseRpc, supabasePrimaryWritesRequested } from './supabase-write-store.js';

// Keep auth and request dispatch in handleMuralRequest; share the original
// response, input validation and push helpers without duplicating them.
export function createMuralPostHandlers({
  ADMIN_KINDS, ADMIN_STATUSES, json, readJson, validatePostPayload,
  normalizeDate, finishLabels, notifyMuralAfterPublication
}) {
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
      mc.name AS collection_name,mc.slug AS collection_slug,mc.image_key AS collection_image_key,
      (SELECT COUNT(*) FROM mural_post_reads mr WHERE mr.post_id=mp.id) AS reads
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
    await notifyMuralAfterPublication(env, id);
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
  await notifyMuralAfterPublication(env,id);
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


return {
  adminListPosts, adminGetPost, adminCreatePost, adminUpdatePost,
  adminPublishPost, adminArchivePost, adminDuplicatePost, adminDeletePost
};
}
