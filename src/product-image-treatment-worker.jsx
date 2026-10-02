import React, { useEffect, useRef } from 'react';
import { productImageMaskBlob, productImageTreatmentArtifactsBlob } from './mural-transparent-image.js';

const LOCK_KEY = 'nisti_product_image_treatment_lock_v11';
export const TREATMENT_PAUSE_KEY = 'nisti_product_image_treatment_paused_v1';
export const TREATMENT_CONTROL_EVENT = 'nisti:product-image-treatment-control';
export const TREATMENT_WAKE_EVENT = 'nisti:product-image-treatment-wake';
const LOCK_TTL_MS = 90 * 1000;
const LOCK_RETRY_MS = 5 * 1000;
const BATCH_SIZE = 3;
const MAX_TRANSIENT_ATTEMPTS = 3;
const IDLE_POLL_MS = 15 * 60 * 1000;
const PAUSED_POLL_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function emitTreatmentProgress(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nisti:product-image-treatment-progress', {
    detail:{ timestamp:Date.now(), ...detail }
  }));
}

function treatmentPaused() {
  try {
    return localStorage.getItem(TREATMENT_PAUSE_KEY) === '1';
  } catch {
    return false;
  }
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
  const response = await fetch(path, { credentials:'same-origin', cache:'no-store', ...options });
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
  const artifacts = await productImageTreatmentArtifactsBlob(item.original_image_url, {
    tasselCode:item.tassel_code,
    forceOutline:Boolean(item.force_outline),
    preciseOutline:Boolean(item.force_outline)
  });
  if (!artifacts?.imageBlob || !artifacts?.maskBlob) {
    await markFailed(item.id, 'A imagem original não gerou um recorte e uma máscara individual seguros.');
    return { id:item.id, status:'failed' };
  }

  const form = new FormData();
  form.append('image', new File([artifacts.imageBlob], `produto-${item.id}-tratado.png`, { type:'image/png' }));
  form.append('mask', new File([artifacts.maskBlob], `produto-${item.id}-mascara.png`, { type:'image/png' }));

  await requestJson(`/api/admin/product-image-treatment/${item.id}`, {
    method:'POST',
    body:form
  });

  return { id:item.id, status:'review', mask_saved:true };
}

async function processMaskItem(item) {
  const maskBlob = await productImageMaskBlob(item.original_image_url, {
    tasselCode:item.tassel_code
  });
  if (!maskBlob) throw new Error('Não foi possível gerar a máscara individual deste produto.');

  const form = new FormData();
  form.append('mask', new File([maskBlob], `produto-${item.id}-mascara.png`, { type:'image/png' }));
  await requestJson(`/api/admin/product-image-mask/${item.id}`, {
    method:'POST',
    body:form
  });
  return { id:item.id, status:item.status || 'approved', mask_saved:true, mask_backfill:true };
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
    const failureCounts = new Map();

    const run = async () => {
      if (running || cancelled) return;
      if (treatmentPaused()) {
        emitTreatmentProgress({ phase:'paused' });
        if (!cancelled) wakeTimer = window.setTimeout(run, PAUSED_POLL_MS);
        return;
      }
      if (!acquireLock(owner)) {
        // Another admin tab may be processing the queue. Keep this worker
        // alive so it can take over when that tab closes or its lock expires.
        // Previously a lock collision stopped this tab permanently.
        emitTreatmentProgress({ phase:'waiting' });
        if (!cancelled) wakeTimer = window.setTimeout(run, LOCK_RETRY_MS);
        return;
      }
      running = true;

      const changed = [];
      try {
        let emptyPasses = 0;

        while (!cancelled && !treatmentPaused() && emptyPasses < 2) {
          writeLock(owner);

          let payload;
          try {
            payload = await requestJson(`/api/admin/product-image-treatment/pending?limit=${BATCH_SIZE}`);
          } catch (error) {
            if ([401,403].includes(Number(error?.status))) return;
            throw error;
          }

          let items = Array.isArray(payload?.items) ? payload.items : [];
          let maskBackfill = false;
          if (!items.length) {
            try {
              const maskPayload = await requestJson(`/api/admin/product-image-mask/pending?limit=${BATCH_SIZE}`);
              items = Array.isArray(maskPayload?.items) ? maskPayload.items : [];
              maskBackfill = items.length > 0;
            } catch (error) {
              if (![401,403].includes(Number(error?.status))) throw error;
            }
          }

          emitTreatmentProgress({
            phase:items.length ? (maskBackfill ? 'mask-backfill' : 'queue') : 'idle',
            summary:payload?.summary || null
          });
          if (!items.length) {
            emptyPasses += 1;
            if (emptyPasses < 2) await sleep(1200);
            continue;
          }

          emptyPasses = 0;

          for (const item of items) {
            if (cancelled || treatmentPaused()) break;
            writeLock(owner);
            emitTreatmentProgress({
              phase:'processing',
              product:{ id:item.id, sku:item.sku || null, name:item.name || null },
              summary:payload?.summary || null
            });
            try {
              const result = maskBackfill ? await processMaskItem(item) : await processItem(item);
              failureCounts.delete(item.id);
              changed.push(result);
              emitTreatmentProgress({
                phase:'processed',
                product:{ id:item.id, sku:item.sku || null, name:item.name || null },
                result
              });
            } catch (error) {
              console.warn('[NISTI imagens] Tratamento pendente', item?.id, error);
              const attempts = (failureCounts.get(item.id) || 0) + 1;
              failureCounts.set(item.id, attempts);
              const definitive = /recorte|transparente|confiança|no máximo 8 mb/i.test(String(error?.message || ''));
              // A single broken image must never block every product behind it.
              // Network failures get retries; after the limit the original is
              // preserved and the item moves to the visible failed total.
              if (definitive || attempts >= MAX_TRANSIENT_ATTEMPTS) {
                if (!maskBackfill) {
                  await markFailed(item.id, error.message);
                  changed.push({ id:item.id, status:'failed' });
                } else {
                  changed.push({ id:item.id, status:item.status || 'unchanged', mask_saved:false, mask_error:true });
                }
                failureCounts.delete(item.id);
              }
              emitTreatmentProgress({
                phase:'failed',
                product:{ id:item.id, sku:item.sku || null, name:item.name || null },
                error:String(error?.message || 'Falha no tratamento.')
              });
            }
            await sleep(120);
          }

          await sleep(300);
        }
      } catch (error) {
        console.warn('[NISTI imagens] Fila automática interrompida temporariamente', error);
        emitTreatmentProgress({ phase:'error', error:String(error?.message || error) });
      } finally {
        if (changed.length) {
          try { await onBatchCompleteRef.current?.(changed); } catch {}
        }
        running = false;
        releaseLock(owner);
        if (!cancelled) wakeTimer = window.setTimeout(run, IDLE_POLL_MS);
      }
    };

    const onControl = event => {
      const paused = Boolean(event?.detail?.paused ?? treatmentPaused());
      emitTreatmentProgress({ phase:paused ? 'paused' : 'queue' });
      if (!paused) {
        if (wakeTimer) window.clearTimeout(wakeTimer);
        wakeTimer = window.setTimeout(run, 0);
      }
    };
    const onWake = () => {
      if (treatmentPaused()) return;
      if (wakeTimer) window.clearTimeout(wakeTimer);
      wakeTimer = window.setTimeout(run, 0);
    };

    window.addEventListener(TREATMENT_CONTROL_EVENT, onControl);
    window.addEventListener(TREATMENT_WAKE_EVENT, onWake);
    const timer = window.setTimeout(run, 900);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (wakeTimer) window.clearTimeout(wakeTimer);
      window.removeEventListener(TREATMENT_CONTROL_EVENT, onControl);
      window.removeEventListener(TREATMENT_WAKE_EVENT, onWake);
      releaseLock(owner);
    };
  }, [enabled]);

  return null;
}
