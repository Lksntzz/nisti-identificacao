import React, { useEffect, useRef } from 'react';
import { treatedProductImageBlob } from './mural-transparent-image.js';

const LOCK_KEY = 'nisti_product_image_treatment_lock_v6';
const LOCK_TTL_MS = 90 * 1000;
const BATCH_SIZE = 3;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLock(owner) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify({
      owner,
      expires_at:Date.now() + LOCK_TTL_MS
    }));
    return true;
  } catch {
    return true;
  }
}

function acquireLock(owner) {
  const current = readLock();
  if (current?.owner && current.owner !== owner && Number(current.expires_at || 0) > Date.now()) {
    return false;
  }
  return writeLock(owner);
}

function releaseLock(owner) {
  try {
    const current = readLock();
    if (!current || current.owner === owner) localStorage.removeItem(LOCK_KEY);
  } catch {}
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', ...options });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Erro ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data || {};
}

async function markFailed(productId, message) {
  try {
    await requestJson(`/api/admin/product-image-treatment/${productId}/failed`, {
      method:'POST',
      headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ error:String(message || 'Tratamento automático sem confiança suficiente.').slice(0, 500) })
    });
  } catch {}
}

async function processItem(item) {
  const blob = await treatedProductImageBlob(item.original_image_url, {
    tasselCode:item.tassel_code
  });
  if (!blob) {
    await markFailed(item.id, 'A imagem original não gerou um recorte transparente seguro com o limite atual.');
    return { id:item.id, status:'failed' };
  }

  const form = new FormData();
  form.append('image', new File([blob], `produto-${item.id}-tratado.png`, { type:'image/png' }));

  await requestJson(`/api/admin/product-image-treatment/${item.id}`, {
    method:'POST',
    body:form
  });

  return { id:item.id, status:'approved' };
}

export default function ProductImageTreatmentWorker({ enabled = true, onBatchComplete }) {
  const onBatchCompleteRef = useRef(onBatchComplete);

  useEffect(() => {
    onBatchCompleteRef.current = onBatchComplete;
  }, [onBatchComplete]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    const owner = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    let cancelled = false;
    let running = false;
    let wakeTimer = null;

    const run = async () => {
      if (running || cancelled || !acquireLock(owner)) return;
      running = true;

      try {
        let emptyPasses = 0;

        while (!cancelled && emptyPasses < 2) {
          writeLock(owner);

          let payload;
          try {
            payload = await requestJson(`/api/admin/product-image-treatment/pending?limit=${BATCH_SIZE}`);
          } catch (error) {
            if ([401,403].includes(Number(error?.status))) return;
            throw error;
          }

          const items = Array.isArray(payload?.items) ? payload.items : [];
          if (!items.length) {
            emptyPasses += 1;
            if (emptyPasses < 2) await sleep(1200);
            continue;
          }

          emptyPasses = 0;
          const changed = [];

          for (const item of items) {
            if (cancelled) break;
            writeLock(owner);
            try {
              changed.push(await processItem(item));
            } catch (error) {
              console.warn('[NISTI imagens] Tratamento pendente', item?.id, error);
              // Falhas transitórias de rede não viram erro definitivo no banco.
              if (/recorte|transparente|confiança/i.test(String(error?.message || ''))) {
                await markFailed(item.id, error.message);
                changed.push({ id:item.id, status:'failed' });
              }
            }
            await sleep(120);
          }

          if (changed.length) {
            try { await onBatchCompleteRef.current?.(changed); } catch {}
          }

          await sleep(300);
        }
      } catch (error) {
        console.warn('[NISTI imagens] Fila automática interrompida temporariamente', error);
      } finally {
        running = false;
        releaseLock(owner);
        if (!cancelled) wakeTimer = window.setTimeout(run, 30000);
      }
    };

    const timer = window.setTimeout(run, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (wakeTimer) window.clearTimeout(wakeTimer);
      releaseLock(owner);
    };
  }, [enabled]);

  return null;
}
