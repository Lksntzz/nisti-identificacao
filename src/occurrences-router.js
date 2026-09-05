import {
  platformsForReference,
  platformNamespace,
  platformVectorId,
  supportedPlatforms,
  normalizePlatform
} from './platform-scope.js';
import { confirmGeometricShadowEvidence } from './geometric-shadow-evidence-router.js';
import { mirrorSupabaseRpc, supabaseWriteMode } from './supabase-write-store.js';

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
    if (!photoBytes || !env.PRODUCT_IMAGES || !env.DB) return null;
    const writeMode = supabaseWriteMode(env);

    const occurrenceId = crypto.randomUUID();
    const imageKey = `occurrences/${Date.now()}_${occurrenceId.slice(0, 8)}.jpg`;

    await env.PRODUCT_IMAGES.put(imageKey, photoBytes, {
      httpMetadata: { contentType: photoMime }
    });

    const res = await env.DB.prepare(`
      INSERT INTO scan_occurrences (
        image_key,
        platform,
        suggested_capa_code,
        confidence,
        error_reason,
        operator_name,
        operator_id,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      imageKey,
      platform,
      suggestedCapaCode,
      Number(confidence || 0),
      errorReason,
      operatorName,
      operatorId
    ).run();

    const rowId = Number(res.meta?.last_row_id || 0) || null;
    if (rowId && writeMode === 'mirror') {
      const row = await env.DB.prepare(`
        SELECT id, image_key, platform, suggested_capa_code, confidence, error_reason,
               operator_name, operator_id, status, trained_capa_code, trained_at, created_at
        FROM scan_occurrences
        WHERE id=?
        LIMIT 1
      `).bind(rowId).first();

      if (row) {
        await mirrorSupabaseRpc(env, 'nisti_mirror_scan_occurrence', {
          p_row: row
        }, 'scan occurrence');
      }
    }

    return rowId;
  } catch (err) {
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

  const occurrence = await env.DB.prepare(
    'SELECT id, image_key, platform FROM scan_occurrences WHERE id=? LIMIT 1'
  ).bind(id).first();

  if (!occurrence) {
    throw new Error('Ocorrência não encontrada.');
  }

  const imageObj = await env.PRODUCT_IMAGES.get(occurrence.image_key);
  if (!imageObj) {
    throw new Error('Foto não encontrada no R2.');
  }
  const photoBytes = new Uint8Array(await imageObj.arrayBuffer());

  // 1. Inserir em cover_visual_references como foto real de bancada
  await env.DB.prepare(`
    INSERT INTO cover_visual_references (
      capa_code,
      image_key,
      reference_kind,
      active
    ) VALUES (?, ?, 'real_scan', 1)
    ON CONFLICT(capa_code, image_key) DO UPDATE SET active=1, updated_at=CURRENT_TIMESTAMP
  `).bind(cleanCapaCode, occurrence.image_key).run();

  const refRow = await env.DB.prepare(
    'SELECT id FROM cover_visual_references WHERE capa_code=? AND image_key=? LIMIT 1'
  ).bind(cleanCapaCode, occurrence.image_key).first();

  const referenceId = refRow?.id;
  if (!referenceId) {
    throw new Error('Falha ao obter ID da referência visual.');
  }

  // 2. Gerar Embedding
  const vector = await embedImage(env, photoBytes, 'image/jpeg');

  // 3. Salvar embedding no D1
  await env.DB.prepare(`
    INSERT OR REPLACE INTO cover_reference_embeddings (
      reference_id,
      embedding_model,
      dimensions,
      embedding_json,
      updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    referenceId,
    env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
    EMBEDDING_DIMENSIONS,
    JSON.stringify(vector)
  ).run();

  // 4. Inserir no Vectorize para cada plataforma suportada
  if (env.COVER_VECTORS?.upsert) {
    const refObj = { capa_code: cleanCapaCode, source_product_id: null };
    let platforms = await platformsForReference(env, refObj);
    if (!platforms.length && occurrence.platform) {
      platforms = [occurrence.platform];
    }
    if (!platforms.length) {
      platforms = supportedPlatforms();
    }

    const vectorInserts = [];
    for (const plat of platforms) {
      const normPlat = normalizePlatform(plat);
      const namespace = platformNamespace(normPlat);
      const vectorId = platformVectorId(referenceId, normPlat) || `ref:${referenceId}:p:${namespace}`;
      vectorInserts.push({
        id: vectorId,
        values: vector,
        namespace,
        metadata: {
          reference_id: referenceId,
          capa_code: cleanCapaCode,
          reference_kind: 'real_scan',
          platform: normPlat,
          platform_key: namespace,
          image_key: String(occurrence.image_key || '')
        }
      });
    }

    if (vectorInserts.length) {
      await env.COVER_VECTORS.upsert(vectorInserts);
    }
  }

  // 5. Marcar ocorrência como treinada
  await env.DB.prepare(`
    UPDATE scan_occurrences
    SET status = 'trained', trained_capa_code = ?, trained_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(cleanCapaCode, id).run();

  // 6. Só confirmação humana/administrativa transforma shadow em ground truth.
  // Falha de telemetria não pode impedir o treinamento real já concluído.
  try {
    await confirmGeometricShadowEvidence(env, {
      occurrenceId: id,
      photoSha256: await sha256Hex(photoBytes),
      capaCode: cleanCapaCode,
      source: operatorName ? 'operator_confirmed_training' : 'admin_confirmed_training'
    });
  } catch (error) {
    console.error('Falha ao confirmar evidência geométrica shadow:', error);
  }

  return {
    ok: true,
    trained: true,
    capa_code: cleanCapaCode,
    reference_id: referenceId,
    message: `Sistema treinado com sucesso para a capa ${cleanCapaCode}!`
  };
}

export async function handleOccurrencesAdminRequest(request, env) {
  const url = new URL(request.url);

  // GET /api/admin/occurrences
  if (request.method === 'GET' && url.pathname === '/api/admin/occurrences') {
    const pendingList = await env.DB.prepare(`
      SELECT id, image_key, platform, suggested_capa_code, confidence, error_reason, operator_name, operator_id, status, created_at
      FROM scan_occurrences
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 60
    `).all();

    const counts = await env.DB.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count,
        COUNT(CASE WHEN status = 'trained' THEN 1 END) AS trained_count,
        COUNT(CASE WHEN status = 'dismissed' THEN 1 END) AS dismissed_count
      FROM scan_occurrences
    `).first();

    const occurrences = (pendingList.results || []).map(row => ({
      id: row.id,
      image_url: `/api/occurrence-images/${row.id}`,
      platform: row.platform,
      suggested_capa_code: row.suggested_capa_code,
      confidence: row.confidence,
      error_reason: row.error_reason,
      operator_name: row.operator_name || 'Operador Geral',
      operator_id: row.operator_id,
      status: row.status,
      created_at: row.created_at
    }));

    return json({
      ok: true,
      stats: {
        pending: counts?.pending_count || 0,
        trained: counts?.trained_count || 0,
        dismissed: counts?.dismissed_count || 0
      },
      occurrences
    });
  }

  // POST /api/admin/occurrences/:id/train
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
    await env.DB.prepare(
      "UPDATE scan_occurrences SET status = 'dismissed' WHERE id = ?"
    ).bind(id).run();

    return json({ ok: true, dismissed: true });
  }

  // POST /api/report-occurrence (Called by operator when the identified result is wrong)
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