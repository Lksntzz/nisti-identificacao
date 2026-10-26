import { supabaseRpc } from './supabase-read-store.js';
import { mirrorSupabaseRpc, supabasePrimaryWritesRequested } from './supabase-write-store.js';

// Router assembly supplies its existing validation, reply and push helpers.
// No auth checks, SQL, mutations or response contracts change in this module.
export function createMuralCollectionHandlers({ json, readJson, nullableText, requiredText, notifyMuralAfterPublication }) {
const COLLECTION_VISUAL_DIRECTIONS = new Set(['automatic','delicate','premium','minimal','playful','fireworks']);

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
  const showYear = input.show_year !== false;
  const heroMessage = nullableText(input.hero_message,140);
  const visualDirection = String(input.visual_direction || 'automatic').trim().toLowerCase();
  if (!COLLECTION_VISUAL_DIRECTIONS.has(visualDirection)) throw new Error('Direção visual da coleção inválida.');
  const themeNotes = nullableText(input.theme_notes,400);
  const description = nullableText(input.description,700);
  if (supabasePrimaryWritesRequested(env)) {
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_collection_write_v1',{
      p_action:'create',p_id:null,p_payload:{
        slug,name,year:Number.isInteger(year)?year:null,show_year:showYear,
        hero_message:heroMessage,visual_direction:visualDirection,theme_notes:themeNotes,description
      }
    },'create mural collection primary');
    const value=result?.value || {};
    if(value.status==='slug_conflict') return json({error:'Já existe uma coleção com esse slug.'},409);
    if(value.status!=='ok') return json({error:'Não foi possível criar a coleção.'},422);
    return json({id:Number(value.id),slug:value.slug || slug},201);
  }
  try {
    const result = await env.DB.prepare(`
      INSERT INTO mural_collections (slug,name,year,show_year,hero_message,visual_direction,theme_notes,description,status,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'active',CURRENT_TIMESTAMP)
    `).bind(slug,name,Number.isInteger(year) ? year : null,showYear?1:0,heroMessage,visualDirection,themeNotes,description).run();
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
    const showYear=input.show_year ?? current.show_year ?? true;
    const heroMessage=nullableText(input.hero_message ?? current.hero_message,140);
    const visualDirection=String(input.visual_direction ?? current.visual_direction ?? 'automatic').trim().toLowerCase();
    if(!COLLECTION_VISUAL_DIRECTIONS.has(visualDirection)) throw new Error('Direção visual da coleção inválida.');
    const themeNotes=nullableText(input.theme_notes ?? current.theme_notes,400);
    const result=await mirrorSupabaseRpc(env,'nisti_admin_mural_collection_write_v1',{
      p_action:'update',p_id:id,p_payload:{
        slug,name,year:Number.isInteger(year)?year:null,show_year:Boolean(showYear),
        hero_message:heroMessage,visual_direction:visualDirection,theme_notes:themeNotes,
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
  const showYear = input.show_year ?? current.show_year ?? 1;
  const heroMessage = nullableText(input.hero_message ?? current.hero_message,140);
  const visualDirection = String(input.visual_direction ?? current.visual_direction ?? 'automatic').trim().toLowerCase();
  if(!COLLECTION_VISUAL_DIRECTIONS.has(visualDirection)) throw new Error('Direção visual da coleção inválida.');
  const themeNotes = nullableText(input.theme_notes ?? current.theme_notes,400);
  await env.DB.prepare(`
    UPDATE mural_collections SET slug=?,name=?,year=?,show_year=?,hero_message=?,visual_direction=?,theme_notes=?,description=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).bind(slug,name,Number.isInteger(year)?year:null,showYear?1:0,heroMessage,visualDirection,themeNotes,nullableText(input.description ?? current.description,700),status,id).run();
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
    await notifyMuralAfterPublication(env, Number(value.id));
    return json({
      ok:true,id:Number(value.id),collection_id:Number(value.collection_id),
      status:'published',featured:true,badge:'NOVA COLEÇÃO',
      published_at:value.published_at,product_count:Number(value.product_count || 0)
    });
  }
  const collection = await env.DB.prepare(`
    SELECT id,slug,name,year,show_year,hero_message,visual_direction,theme_notes,description,image_key,status
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
  const title = collection.show_year !== 0 && collection.show_year !== false && year && !name.endsWith(year) ? `${name} ${year}` : name;
  const supporting = String(collection.hero_message || '').trim()
    || String(collection.description || '').trim()
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

  await notifyMuralAfterPublication(env, postId);
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

return { adminListCollections, adminCreateCollection, adminUpdateCollection, adminSetCollectionProducts, adminPublishCollection };
}
