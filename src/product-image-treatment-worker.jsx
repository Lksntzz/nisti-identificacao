import React, { useEffect, useRef } from 'react';
import { treatedProductImageBlob } from './mural-transparent-image.js';

const LOCK_KEY = 'nisti_product_image_treatment_lock_v8';
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
  let effectiveTasselCode=item.tassel_code;
  let ai={
    status:'local-fallback',
    applied:false,
    provider:'local-fallback',
    model:null,
    confidence:0,
    message:'IA ainda não executada.'
  };

  try {
    const analysis=await requestJson(`/api/admin/product-image-treatment/${item.id}/ai`,{method:'POST'});
    if (analysis.applied && typeof analysis.detected_has_tassel === 'boolean') {
      effectiveTasselCode=analysis.detected_has_tassel ? 'AI' : 'X';
      ai={
        status:'applied',
        applied:true,
        provider:analysis.provider || 'ai',
        model:analysis.model || null,
        confidence:Number(analysis.confidence || 0),
        detectedHasTassel:analysis.detected_has_tassel,
        disagrees:Boolean(analysis.tassel_disagrees),
        message:analysis.tassel_disagrees
          ? 'IA detectou divergência entre o tassel visível e o cadastro; revise antes de aprovar.'
          : `IA aplicada: ${analysis.provider || 'provedor de visão'}.`
      };
    } else {
      ai={
        status:'local-fallback',
        applied:false,
        provider:analysis.provider || 'local-fallback',
        model:analysis.model || null,
        confidence:Number(analysis.confidence || 0),
        message:`Fallback local: ${analysis.reason || 'a IA não retornou confiança suficiente.'}`
      };
    }
  } catch(error) {
    ai={
      status:'local-fallback',
      applied:false,
      provider:'local-fallback',
      model:null,
      confidence:0,
      message:`Fallback local: ${error.message}`
    };
  }

  const blob = await treatedProductImageBlob(item.original_image_url, {
    tasselCode:effectiveTasselCode,
    forceOutline:Boolean(item.force_outline),
    preciseOutline:Boolean(item.force_outline)
  });
  if (!blob) {
    await markFailed(item.id, 'A imagem original não gerou um recorte transparente seguro com o limite atual.');
    return { id:item.id, status:'failed', ai };
  }

  const form = new FormData();
  form.append('image', new File([blob], `produto-${item.id}-tratado.png`, { type:'image/png' }));

  await requestJson(`/api/admin/product-image-treatment/${item.id}`, {
    method:'POST',
    body:form
  });

  return {
    id:item.id,
    status:'review',
    ai,
    warning:ai.status==='local-fallback' || ai.disagrees ? ai.message : ''
  };
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

          const items = Array.isArray(payload?.items) ? payload.items : [];
          emitTreatmentProgress({
            phase:items.length ? 'queue' : 'idle',
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
              const result = await processItem(item);
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
                await markFailed(item.id, error.message);
                failureCounts.delete(item.id);
                changed.push({ id:item.id, status:'failed' });
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
