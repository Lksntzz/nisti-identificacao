import app from './storage-metrics-router.js';
import { WIREO_COLORS, ACCESSORY_COLORS } from './sku.js';
import { mirrorSupabaseRpc } from './supabase-write-store.js';
import { syncNistiProductToCommerceSafe, reconcileNistiProductToCommerceSafe } from './nisti-commerce-sync.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function code(value) {
  return String(value || '').trim().toUpperCase();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/products\/(\d+)\/finish$/);

    if (match && request.method === 'PATCH') {
      try {
        const id = Number(match[1]);
        const body = await request.json().catch(() => ({}));
        const wireoCode = code(body.wireo_code);
        const tasselCode = code(body.tassel_code);
        const elasticoCode = code(body.elastico_code);

        if (!WIREO_COLORS[wireoCode]) {
          return json({ error: 'Wire-O inválido.' }, 400);
        }
        if (tasselCode !== 'X' && !ACCESSORY_COLORS[tasselCode]) {
          return json({ error: 'Tassel inválido.' }, 400);
        }
        if (elasticoCode !== 'X' && !ACCESSORY_COLORS[elasticoCode]) {
          return json({ error: 'Elástico inválido.' }, 400);
        }

        const result = await mirrorSupabaseRpc(env, 'nisti_finish_product_primary_v1', {
          p_id: id,
          p_wireo_code: wireoCode,
          p_tassel_code: tasselCode,
          p_elastico_code: elasticoCode
        }, 'acabamento de produto');
        const product = result.value || {};
        if (product.status === 'not_found') return json({ error: 'Produto não encontrado.' }, 404);
        if (product.status === 'sku_conflict') {
          return json({ error: `Já existe outro produto com o SKU ${product.sku}.` }, 409);
        }

        const commerceSync = await syncNistiProductToCommerceSafe(env,id);
        if (ctx?.waitUntil && String(commerceSync?.status || '').toUpperCase() === 'SYNCED') {
          ctx.waitUntil(
            reconcileNistiProductToCommerceSafe(env,id)
              .catch(error=>console.warn('[NISTI→Commerce] Reconciliação após acabamento falhou',id,error))
          );
        }

        return json({
          ok: true,
          product: {
            id,
            old_sku: product.old_sku,
            sku: product.sku,
            acabamento_code: product.acabamento_code,
            wireo_code: wireoCode,
            tassel_code: tasselCode,
            elastico_code: elasticoCode,
            wireo: WIREO_COLORS[wireoCode],
            tassel: tasselCode === 'X' ? 'Sem tassel' : ACCESSORY_COLORS[tasselCode],
            elastico: elasticoCode === 'X' ? 'Sem elástico' : ACCESSORY_COLORS[elasticoCode]
          },
          commerce_sync:commerceSync
        });
      } catch (error) {
        return json({ error: error?.message || 'Falha ao salvar acabamento.' }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
