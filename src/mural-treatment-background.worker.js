import { __muralTransparentImageInternals } from './mural-transparent-image.js';

const { buildTreatedProductImage } = __muralTransparentImageInternals;

async function processTreatment({ src, options = {}, maskOnly = false }) {
  let maskBlob = null;
  let treatedUrl = null;

  try {
    treatedUrl = await buildTreatedProductImage(src, {
      ...options,
      maskOnly,
      onMask:blob => { maskBlob = blob; }
    });

    if (!maskBlob?.size || maskBlob.type !== 'image/png') {
      throw new Error('O tratamento não gerou uma máscara segura para este produto.');
    }

    if (maskOnly) {
      return { maskBlob };
    }

    if (!treatedUrl || !String(treatedUrl).startsWith('blob:')) {
      throw new Error('O tratamento não encontrou um recorte confiável. A imagem original foi preservada.');
    }

    const response = await fetch(treatedUrl);
    if (!response.ok) throw new Error('Não foi possível ler o PNG tratado no processo em segundo plano.');
    const imageBlob = await response.blob();
    if (!imageBlob?.size || imageBlob.type !== 'image/png') {
      throw new Error('O processo em segundo plano não gerou um PNG tratado válido.');
    }

    return { imageBlob, maskBlob };
  } finally {
    if (treatedUrl && String(treatedUrl).startsWith('blob:')) {
      try { URL.revokeObjectURL(treatedUrl); } catch {}
    }
  }
}

self.onmessage = async event => {
  const payload = event?.data || {};
  const id = payload.id;

  try {
    if (!id) throw new Error('Identificador de tratamento ausente.');
    const result = await processTreatment(payload);
    self.postMessage({ id, ok:true, ...result });
  } catch (error) {
    self.postMessage({
      id,
      ok:false,
      error:String(error?.message || 'Falha no tratamento em segundo plano.')
    });
  }
};
