import { supabaseRpc } from './supabase-read-store.js';
import { mirrorSupabaseRpc, supabasePrimaryWritesRequested } from './supabase-write-store.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_EDITORIAL_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MURAL_PRODUCT_IMAGE_BYTES = 8 * 1024 * 1024;

// Reuses the original response helper. Authentication remains in edge routing.
// No change to R2 keys, content validation, reviewer state or deletion behavior.
export function createMuralImageHandlers({ json }) {
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



return {
  uploadEditorialImage, serveEditorialImage, removeEditorialImage,
  uploadMuralProductImage, removeMuralProductImage
};
}
