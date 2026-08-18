import { parseSku } from './sku.js';

const EMBEDDING_DIMENSIONS = 768;
const TOP_K_COVERS = 8;
const BULK_IMPORT_LIMIT = 100;

function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8',...headers}})}
function clean(value){const text=String(value??'').trim();return text||null}
function base64(bytes){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));return btoa(binary)}

async function embedImage(env,bytes,mimeType){
  if(!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model=env.GEMINI_EMBEDDING_MODEL||'gemini-embedding-2';
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({content:{parts:[{inline_data:{mime_type:mimeType||'image/jpeg',data:base64(bytes)}}]},output_dimensionality:EMBEDDING_DIMENSIONS})});
  if(!response.ok) throw new Error(`Gemini Embedding falhou (${response.status})`);
  const payload=await response.json();
  const values=payload?.embedding?.values||payload?.embeddings?.[0]?.values;
  if(!Array.isArray(values)||!values.length) throw new Error('Gemini Embedding não retornou vetor');
  return {model,values};
}

async function upsertCoverEmbedding(env,capaCode,imageKey,bytes,mimeType){
  const {model,values}=await embedImage(env,bytes,mimeType);
  await env.DB.prepare(`INSERT INTO cover_embeddings (capa_code,image_key,embedding_model,dimensions,embedding_json,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(capa_code) DO UPDATE SET image_key=excluded.image_key,embedding_model=excluded.embedding_model,dimensions=excluded.dimensions,embedding_json=excluded.embedding_json,updated_at=CURRENT_TIMESTAMP`).bind(capaCode,imageKey,model,values.length,JSON.stringify(values)).run();
}

async function saveProductImage(env,id,fileBytes,contentType){
  const product=await env.DB.prepare(`SELECT id,capa_code,image_key FROM products WHERE id=?`).bind(id).first();
  if(!product) throw new Error('Produto não encontrado');
  const key=`products/${id}/${crypto.randomUUID()}`;
  await env.PRODUCT_IMAGES.put(key,fileBytes,{httpMetadata:{contentType}});
  await env.DB.prepare(`UPDATE products SET image_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(key,id).run();
  let indexed=false,index_error=null;
  try{await upsertCoverEmbedding(env,product.capa_code,key,new Uint8Array(fileBytes),contentType);indexed=true}catch(error){index_error=error?.message||'Falha ao indexar capa'}
  if(product.image_key&&product.image_key!==key) await env.PRODUCT_IMAGES.delete(product.image_key).catch(()=>{});
  return {indexed,index_error};
}

async function upsertCatalogProduct(env,row){
  const parsed=parseSku(row?.sku); const nome=clean(row?.nome); const variacao=clean(row?.variacao); const platform=clean(row?.platform)?.toUpperCase()||null; const link=clean(row?.link);
  let product=await env.DB.prepare(`SELECT id,image_key FROM products WHERE sku=?`).bind(parsed.sku).first(); let created=false;
  if(!product){const result=await env.DB.prepare(`INSERT INTO products (sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao) VALUES (?,?,?,?,?,?,?,?,?)`).bind(parsed.sku,parsed.mioloCode,parsed.capaCode,parsed.acabamentoCode,parsed.wireoCode,parsed.tasselCode,parsed.elasticoCode,nome,variacao).run();product={id:result.meta.last_row_id,image_key:null};created=true}
  else await env.DB.prepare(`UPDATE products SET miolo_code=?,capa_code=?,acabamento_code=?,wireo_code=?,tassel_code=?,elastico_code=?,nome=COALESCE(?,nome),variacao=COALESCE(?,variacao),updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(parsed.mioloCode,parsed.capaCode,parsed.acabamentoCode,parsed.wireoCode,parsed.tasselCode,parsed.elasticoCode,nome,variacao,product.id).run();
  if(platform){const existing=await env.DB.prepare(`SELECT id FROM product_platforms WHERE product_id=? AND platform=? ORDER BY id ASC LIMIT 1`).bind(product.id,platform).first();if(existing){if(link) await env.DB.prepare(`UPDATE product_platforms SET link=? WHERE id=?`).bind(link,existing.id).run()}else await env.DB.prepare(`INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)`).bind(product.id,platform,link).run()}
  return {id:product.id,sku:parsed.sku,capa_code:parsed.capaCode,created,has_image:Boolean(product.image_key)};
}

export default {async fetch(request,env){
  const url=new URL(request.url);
  try{
    if(url.pathname==='/api/health') return json({ok:true,service:'nisti-identificacao'});
    if(url.pathname==='/api/sku/parse'&&request.method==='POST'){const {sku}=await request.json();return json(parseSku(sku))}
    if(url.pathname==='/api/products'&&request.method==='GET'){
      const {results}=await env.DB.prepare(`SELECT p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,p.wireo_code,p.tassel_code,p.elastico_code,p.nome,p.variacao,p.image_key,p.created_at,(SELECT pp.platform FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS platform,(SELECT pp.link FROM product_platforms pp WHERE pp.product_id=p.id ORDER BY pp.id ASC LIMIT 1) AS link FROM products p ORDER BY p.id DESC LIMIT 1000`).all();
      return json({products:(results||[]).map(product=>({...product,image_url:product.image_key?`/api/images/${product.id}`:null}))});
    }
    if(url.pathname==='/api/products'&&request.method==='POST'){
      const body=await request.json(); const parsed=parseSku(body.sku); const result=await env.DB.prepare(`INSERT INTO products (sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao) VALUES (?,?,?,?,?,?,?,?,?)`).bind(parsed.sku,parsed.mioloCode,parsed.capaCode,parsed.acabamentoCode,parsed.wireoCode,parsed.tasselCode,parsed.elasticoCode,body.nome||null,body.variacao||null).run(); const id=result.meta.last_row_id;
      if(body.platform) await env.DB.prepare(`INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)`).bind(id,String(body.platform).trim().toUpperCase(),body.link||null).run();
      return json({ok:true,id,parsed},201);
    }
    if(url.pathname==='/api/admin/bulk-products'&&request.method==='POST'){
      const body=await request.json(); const rows=Array.isArray(body?.rows)?body.rows:[]; if(!rows.length)return json({error:'Envie rows com pelo menos um produto'},400); if(rows.length>BULK_IMPORT_LIMIT)return json({error:`Máximo de ${BULK_IMPORT_LIMIT} produtos por lote`},400);
      const imported=[],errors=[]; for(let i=0;i<rows.length;i++){try{imported.push({row:i+1,...await upsertCatalogProduct(env,rows[i])})}catch(error){errors.push({row:i+1,sku:clean(rows[i]?.sku),error:error?.message||'Falha ao importar'})}}
      return json({ok:errors.length===0,received:rows.length,created:imported.filter(x=>x.created).length,updated:imported.filter(x=>!x.created).length,imported,errors});
    }
    const imageUpload=url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
    if(imageUpload&&request.method==='POST'){const id=Number(imageUpload[1]);const form=await request.formData();const file=form.get('image');if(!(file instanceof File))return json({error:'Imagem obrigatória'},400);if(!file.type.startsWith('image/'))return json({error:'Arquivo deve ser uma imagem'},400);const saved=await saveProductImage(env,id,await file.arrayBuffer(),file.type);return json({ok:true,image_url:`/api/images/${id}`,embedding_indexed:saved.indexed,embedding_error:saved.index_error})}
    const imageGet=url.pathname.match(/^\/api\/images\/(\d+)$/);
    if(imageGet&&request.method==='GET'){const product=await env.DB.prepare(`SELECT image_key FROM products WHERE id=?`).bind(Number(imageGet[1])).first();if(!product?.image_key)return new Response('Not found',{status:404});const object=await env.PRODUCT_IMAGES.get(product.image_key);if(!object)return new Response('Not found',{status:404});const headers=new Headers();object.writeHttpMetadata(headers);headers.set('cache-control',url.searchParams.has('v')?'public, max-age=31536000, immutable':'private, max-age=300');return new Response(object.body,{headers})}
    if(url.pathname==='/api/admin/cover-index'&&request.method==='GET'){
      const refs=await env.DB.prepare(`SELECT COUNT(DISTINCT capa_code) AS total FROM products WHERE image_key IS NOT NULL`).first(); const indexed=await env.DB.prepare(`SELECT COUNT(*) AS total FROM cover_embeddings`).first();
      const pending=await env.DB.prepare(`SELECT COUNT(*) AS total FROM (SELECT p.capa_code,p.image_key FROM products p JOIN (SELECT capa_code,MAX(id) AS id FROM products WHERE image_key IS NOT NULL GROUP BY capa_code) latest ON latest.id=p.id LEFT JOIN cover_embeddings ce ON ce.capa_code=p.capa_code AND ce.image_key=p.image_key WHERE ce.capa_code IS NULL)`).first();
      return json({reference_covers:Number(refs?.total||0),indexed_covers:Number(indexed?.total||0),pending_covers:Number(pending?.total||0),embedding_model:env.GEMINI_EMBEDDING_MODEL||'gemini-embedding-2',embedding_dimensions:EMBEDDING_DIMENSIONS,top_k:TOP_K_COVERS});
    }
    if(url.pathname==='/api/admin/reindex-cover-embeddings'&&request.method==='POST'){
      const body=await request.json().catch(()=>({}));const limit=Math.max(1,Math.min(10,Number(body.limit)||6));const {results}=await env.DB.prepare(`SELECT p.id,p.capa_code,p.image_key FROM products p JOIN (SELECT capa_code,MAX(id) AS id FROM products WHERE image_key IS NOT NULL GROUP BY capa_code) latest ON latest.id=p.id LEFT JOIN cover_embeddings ce ON ce.capa_code=p.capa_code AND ce.image_key=p.image_key WHERE ce.capa_code IS NULL ORDER BY p.id ASC LIMIT ?`).bind(limit).all();const processed=[],errors=[];
      for(const product of results||[]){try{const obj=await env.PRODUCT_IMAGES.get(product.image_key);if(!obj)throw new Error('Imagem não encontrada no R2');await upsertCoverEmbedding(env,product.capa_code,product.image_key,new Uint8Array(await obj.arrayBuffer()),obj.httpMetadata?.contentType||'image/jpeg');processed.push(product.capa_code)}catch(error){errors.push({capa_code:product.capa_code,error:error?.message||'Falha ao indexar'})}}
      const pending=await env.DB.prepare(`SELECT COUNT(*) AS total FROM (SELECT p.capa_code FROM products p JOIN (SELECT capa_code,MAX(id) AS id FROM products WHERE image_key IS NOT NULL GROUP BY capa_code) latest ON latest.id=p.id LEFT JOIN cover_embeddings ce ON ce.capa_code=p.capa_code AND ce.image_key=p.image_key WHERE ce.capa_code IS NULL)`).first();
      return json({ok:errors.length===0,processed,errors,pending_covers:Number(pending?.total||0)});
    }
    if(env.ASSETS) return env.ASSETS.fetch(request);
    return json({error:'Not found'},404);
  }catch(error){const message=error?.message||'Erro interno';return json({error:message},/UNIQUE constraint/i.test(message)?409:400)}
}};
