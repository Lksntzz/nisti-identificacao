const DEFAULT_TREATMENT_TIMEOUT_MS = 30 * 1000;

function backgroundWorkerSupported() {
  return typeof Worker !== 'undefined'
    && typeof URL !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function';
}

function runBackgroundTreatment(src, options = {}, { maskOnly = false, timeoutMs = DEFAULT_TREATMENT_TIMEOUT_MS } = {}) {
  const normalized = String(src || '').trim();
  if (!normalized) return Promise.resolve(null);
  if (!backgroundWorkerSupported()) {
    return Promise.reject(new Error('Este navegador não suporta o tratamento seguro em segundo plano. Nenhum processamento foi executado na tela principal.'));
  }

  const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const worker = new Worker(
    new URL('./mural-treatment-background.worker.js', import.meta.url),
    { type:'module', name:'nisti-mural-image-treatment' }
  );

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = callback => value => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.terminate();
      callback(value);
    };

    const succeed = finish(resolve);
    const fail = finish(reject);

    const timer = window.setTimeout(() => {
      fail(new Error(`O tratamento excedeu ${Math.round(timeoutMs / 1000)} segundos e foi cancelado para manter o sistema responsivo.`));
    }, timeoutMs);

    worker.onmessage = event => {
      const message = event?.data || {};
      if (message.id !== requestId) return;
      if (!message.ok) {
        fail(new Error(message.error || 'Falha no tratamento em segundo plano.'));
        return;
      }
      succeed(message);
    };

    worker.onerror = event => {
      event.preventDefault?.();
      fail(new Error(event?.message || 'O processo de tratamento em segundo plano falhou.'));
    };

    worker.onmessageerror = () => {
      fail(new Error('O navegador não conseguiu receber o resultado do tratamento em segundo plano.'));
    };

    worker.postMessage({
      id:requestId,
      src:normalized,
      options:{
        sku:options.sku || null,
        name:options.name || null,
        tasselCode:options.tasselCode || options.tassel_code || null,
        wireoCode:options.wireoCode || options.wireo_code || null,
        forceOutline:Boolean(options.forceOutline),
        preciseOutline:Boolean(options.preciseOutline)
      },
      maskOnly:Boolean(maskOnly)
    });
  });
}

export async function backgroundProductImageTreatmentArtifactsBlob(src, options = {}) {
  const result = await runBackgroundTreatment(src, options);
  if (!result?.imageBlob || !result?.maskBlob) return null;
  return { imageBlob:result.imageBlob, maskBlob:result.maskBlob };
}

export async function backgroundProductImageMaskBlob(src, options = {}) {
  const result = await runBackgroundTreatment(src, options, { maskOnly:true });
  return result?.maskBlob || null;
}

export const __backgroundTreatmentInternals = {
  DEFAULT_TREATMENT_TIMEOUT_MS,
  backgroundWorkerSupported
};
