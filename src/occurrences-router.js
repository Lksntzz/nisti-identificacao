import {
  platformsForReference,
  platformNamespace,
  platformVectorId,
  supportedPlatforms,
  normalizePlatform
} from './platform-scope.js';
import {
  mirrorSupabaseRpc,
  SupabasePrimaryWriteError
} from './supabase-write-store.js';
import { supabaseReserveOccurrences } from './supabase-read-store.js';

const EMBEDDING_DIMENSIONS = 768;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function embedImage(env, bytes, mimeType, maxRetries = 3) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const model = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
  const base64Data = base64(bytes);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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
                  data: base64Data
                }
              }]
            },
            output_dimensionality: EMBEDDING_DIMENSIONS
          })
        }
      );

      if (!response.ok) {
        if (attempt < maxRetries && [429, 500, 502, 503, 504].includes(response.status)) {
          await new Promise(r => setTimeout(r, attempt * 350));
          continue;
        }
        throw new Error(`Gemini Embedding falhou (${response.status})`);
      }

      const payload = await response.json();
      const vector = payload?.embedding?.values;
      if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error('Dimensão de embedding inválida');
      }
      return vector;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 350));
        continue;
      }
      throw err;
    }
  }
}

export async function recordScanOccurrence(env, {
  photoBytes,
  photoMime = 'image/jpeg',
  platform = null,
  suggestedCapaCode = null,
  confidence = 0,
  errorReason = 'no_match',
  operatorName = null,
  operatorId = null
}) {
  try {
    if (!photoBytes || !env.PRODUCT_IMAGES) return null;

    const occurrenceId = crypto.randomUUID();
    const imageKey = `occurrences/${Date.now()}_${occurrenceId.slice(0, 8)}.jpg`;

    await env.PRODUCT_IMAGES.put(imageKey, photoBytes, {
      httpMetadata:{contentType:photoMime}
    });

    try {
      const created = await mirrorSupabaseRpc(env, 'nisti_create_scan_occurrence_v1', {
        p_row:{
          image_key:imageKey,
          platform,
          suggested_capa_code:suggestedCapaCode,
          confidence:Number(confidence || 0),
          error_reason:errorReason,
          operator_name:operatorName,
          operator_id:operatorId,
          status:'pending',
          created_at:new Date().toISOString()
        }
      }, 'scan occurrence primary');

      const rowId = Number(created?.value?.id || 0) || null;
      if (!rowId) throw new Error('Supabase não retornou o ID da ocorrência.');
      return rowId;
    } catch (error) {
      await env.PRODUCT_IMAGES.delete(imageKey).catch(() => {});
      throw error;
    }
  } catch (err) {
    if (err instanceof SupabasePrimaryWriteError) throw err;
    console.error('Falha ao registrar ocorrência:', err);
    return null;
  }
}

export async function trainOccurrenceDirectly(env, occurrenceId, capaCode, operatorName = null) {
  const id = Number(occurrenceId);
  const cleanCapaCode = String(capaCode || '').trim().toUpperCase();
  if (!id || !cleanCapaCode) {
    throw new Error('ID da ocorrência e capa_code são obrigatórios.');
  }

  const prepared = await mirrorSupabaseRpc(env,'nisti_prepare_occurrence_training_v1',{
    p_occurrence_id:id,
    p_capa_code:cleanCapaCode
  },`prepare occurrence training ${id}`);
  const prep = prepared?.value || {};

  if(prep.status==='not_found') throw new Error('Ocorrência não encontrada.');
  if(prep.status!=='ok') throw new Error('Não foi possível preparar o treinamento da ocorrência.');

  const referenceId = Number(prep.reference_id || 0);
  if(!referenceId) throw new Error('Supabase não retornou o ID da referência visual.');

  const occurrence = {
    id,
    image_key:prep.image_key,
    platform:prep.platform || null
  };

  const imageObj = await env.PRODUCT_IMAGES.get(occurrence.image_key);
  if(!imageObj) throw new Error('Foto não encontrada no R2.');

  const photoBytes = new Uint8Array(await imageObj.arrayBuffer());
  const vector = await embedImage(env,photoBytes,'image/jpeg');
  const embeddingModel = env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';

  if(env.COVER_VECTORS?.upsert) {
    const refObj={capa_code:cleanCapaCode,source_product_id:null};
    let platforms=await platformsForReference(env,refObj);
    if(!platforms.length && occurrence.platform) platforms=[occurrence.platform];
    if(!platforms.length) platforms=supportedPlatforms();

    const vectorInserts=[];
    for(const plat of platforms) {
      const normPlat=normalizePlatform(plat);
      const namespace=platformNamespace(normPlat);
      if(!namespace) continue;
      const vectorId=platformVectorId(referenceId,normPlat) || `ref:${referenceId}:p:${namespace}`;
      vectorInserts.push({
        id:vectorId,
        values:vector,
        namespace,
        metadata:{
          reference_id:referenceId,
          capa_code:cleanCapaCode,
          reference_kind:'real_scan',
          platform:normPlat,
          platform_key:namespace,
          image_key:String(occurrence.image_key || '')
        }
      });
    }
    if(vectorInserts.length) await env.COVER_VECTORS.upsert(vectorInserts);
  }

  const committed=await mirrorSupabaseRpc(env,'nisti_commit_occurrence_training_v1',{
    p_occurrence_id:id,
    p_reference_id:referenceId,
    p_capa_code:cleanCapaCode,
    p_embedding_model:embeddingModel,
    p_dimensions:EMBEDDING_DIMENSIONS,
    p_embedding_json:JSON.stringify(vector)
  },`commit occurrence training ${id}`);

  if(committed?.value?.status!=='ok') {
    throw new Error('Supabase não concluiu o treinamento da ocorrência.');
  }

  try {
    await mirrorSupabaseRpc(env,'nisti_mirror_confirm_geometric_shadow',{
      p_occurrence_id:id,
      p_photo_sha256:await sha256Hex(photoBytes),
      p_capa_code:cleanCapaCode,
      p_source:operatorName ? 'operator_confirmed_training' : 'admin_confirmed_training',
      p_confirmed_at:new Date().toISOString()
    },`confirm occurrence shadow ${id}`);
  } catch(error) {
    console.error('Falha ao confirmar evidência geométrica shadow:',error);
  }

  return {
    ok:true,
    trained:true,
    capa_code:cleanCapaCode,
    reference_id:referenceId,
    message:`Sistema treinado com sucesso para a capa ${cleanCapaCode}!`
  };
}

export async function handleOccurrencesAdminRequest(request, env) {export async function handleOccurrencesAdminRequest(request, env) {
  const url = new URL(request.url);

  // GET /api/admin/occurrences
  if (request.method === 'GET' && url.pathname === '/api/admin/occurrences') {
    const payload = await supabaseReserveOccurrences(env);

    const occurrences = (payload?.occurrences || []).map(row => ({
      id:Number(row.id),
      image_url:`/api/occurrence-images/${Number(row.id)}`,
      platform:row.platform,
      suggested_capa_code:row.suggested_capa_code,
      confidence:Number(row.confidence || 0),
      error_reason:row.error_reason,
      operator_name:row.operator_name || 'Operador Geral',
      operator_id:row.operator_id,
      status:row.status,
      created_at:row.created_at
    }));

    return json({
      ok:true,
      reserve_mode:false,
      read_source:'supabase',
      stats:{
        pending:Number(payload?.stats?.pending || 0),
        trained:Number(payload?.stats?.trained || 0),
        dismissed:Number(payload?.stats?.dismissed || 0)
      },
      occurrences
    });
  }

  // POST /api/admin/occurrences/:id/train  // POST /api/admin/occurrences/:id/train
  const trainMatch = url.pathname.match(/^\/api\/admin\/occurrences\/(\d+)\/train$/);
  if (request.method === 'POST' && trainMatch) {
    try {
      const id = Number(trainMatch[1]);
      const body = await request.json().catch(() => ({}));
      const capaCode = String(body.capa_code || '').trim().toUpperCase();

      if (!capaCode) {
        return json({ error: 'capa_code é obrigatório para treinar o sistema' }, 400);
      }

      const result = await trainOccurrenceDirectly(env, id, capaCode);
      return json(result);
    } catch (err) {
      console.error('Erro ao treinar ocorrência:', err);
      return json({ error: `Erro ao treinar sistema: ${err.message || err}` }, 500);
    }
  }

  // POST /api/operator/confirm-selection (confirmação humana supervisionada do operador)
  if (request.method === 'POST' && url.pathname === '/api/operator/confirm-selection') {
    try {
      const body = await request.json().catch(() => ({}));
      const occurrenceId = Number(body.occurrence_id);
      const capaCode = String(body.capa_code || '').trim().toUpperCase();
      const operatorName = body.operator_name || null;

      if (!occurrenceId || !capaCode) {
        return json({ ok: false, error: 'occurrence_id e capa_code são obrigatórios' }, 400);
      }

      await trainOccurrenceDirectly(env, occurrenceId, capaCode, operatorName);
      return json({
        ok: true,
        auto_learned: true,
        capa_code: capaCode,
        message: `IA treinada após confirmação humana para a capa ${capaCode} com sucesso!`
      });
    } catch (err) {
      console.error('Erro no treino supervisionado do operador:', err);
      return json({ ok: false, error: err.message || 'Falha ao registrar treinamento supervisionado.' }, 500);
    }
  }

  // POST /api/admin/occurrences/:id/dismiss
  const dismissMatch = url.pathname.match(/^\/api\/admin\/occurrences\/(\d+)\/dismiss$/);
  if (request.method === 'POST' && dismissMatch) {
    const id = Number(dismissMatch[1]);
    const result = await mirrorSupabaseRpc(
      env,
      'nisti_dismiss_scan_occurrence_v1',
      {p_id:id},
      `dismiss occurrence ${id}`
    );
    if (result?.value?.status === 'not_found') {
      return json({error:'Ocorrência não encontrada.'},404);
    }
    return json({ok:true,dismissed:true});
  }

  // POST /api/report-occurrence  // POST /api/report-occurrence (Called by operator when the identified result is wrong)
  if (request.method === 'POST' && url.pathname === '/api/report-occurrence') {
    try {
      const form = await request.formData();
      const image = form.get('image');
      const platform = form.get('platform') || null;
      const predictedSku = form.get('predicted_sku') || null;
      const predictedCapaCode = form.get('predicted_capa_code') || null;
      const confidence = Number(form.get('confidence') || 0);

      let operatorName = null;
      const rawOpName = request?.headers?.get('x-operator-name') || form.get('operator_name');
      if (rawOpName) {
        try { operatorName = decodeURIComponent(rawOpName); } catch { operatorName = rawOpName; }
      }
      const operatorId = request?.headers?.get('x-operator-id') || request?.headers?.get('x-user-id') || form.get('operator_id') || null;

      if (!image) {
        return json({ error: 'Nenhuma foto fornecida.' }, 400);
      }

      const photoBytes = new Uint8Array(await image.arrayBuffer());
      const occurrenceId = await recordScanOccurrence(env, {
        photoBytes,
        photoMime: image.type || 'image/jpeg',
        platform,
        suggestedCapaCode: predictedCapaCode,
        confidence,
        errorReason: `reported_wrong_by_operator:${predictedSku || predictedCapaCode || 'desconhecido'}`,
        operatorName,
        operatorId
      });

      return json({ ok: true, occurrence_id: occurrenceId, message: 'Ocorrência enviada para o administrador com sucesso!' });
    } catch (err) {
      return json({ error: err.message || 'Falha ao reportar erro.' }, 500);
    }
  }

  return null;
}
