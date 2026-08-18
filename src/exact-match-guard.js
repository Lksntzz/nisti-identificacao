function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function productFromResult(data) {
  if (data?.product?.image_key) return data.product;
  if (Array.isArray(data?.products)) return data.products.find(product => product?.image_key) || null;
  return null;
}

function cleanReason(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function verifyExactVisualMatch(request, env, data) {
  const started = Date.now();
  const product = productFromResult(data);
  if (!product?.image_key) {
    return {
      same_art: false,
      confidence: 0,
      reason: 'O produto retornado não possui imagem de referência para a confirmação final.',
      ms: Date.now() - started,
      model: env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
    };
  }

  const form = await request.formData();
  const photo = form.get('image');
  if (!(photo instanceof File)) throw new Error('Foto da capa indisponível para confirmação final');

  const reference = await env.PRODUCT_IMAGES.get(product.image_key);
  if (!reference) throw new Error('Imagem de referência do produto não encontrada no R2');

  const [photoBytes, referenceBytes] = await Promise.all([
    photo.arrayBuffer(),
    reference.arrayBuffer()
  ]);
  const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Faça uma verificação BINÁRIA de identidade visual entre duas capas.

FOTO A é a capa física fotografada. REFERÊNCIA B é o mockup que o sistema pretende retornar.

Responda same_art=true SOMENTE se as duas imagens tiverem a MESMA ARTE-BASE.
Ignore nome personalizado, palavras, datas, Wire-O/espiral, tassel, elástico, reflexo, brilho, perspectiva, corte, mão, mesa e iluminação.

NÃO aceite apenas por tema, cor ou estilo parecido. Flores, borboletas, tons rosa, elementos delicados ou a mesma categoria de produto não bastam.
Compare obrigatoriamente a estrutura visual: fundo, molduras, blocos centrais, ilustrações principais, quantidade e posição relativa de flores/folhagens/borboletas/personagens/objetos e distribuição dos elementos.
Se existir moldura central em uma e não na outra, fundo estruturalmente diferente, ou decoração posicionada de forma diferente, use same_art=false.
Na dúvida, use same_art=false.`
          },
          { text: 'FOTO A:' },
          {
            inline_data: {
              mime_type: photo.type || 'image/jpeg',
              data: base64(new Uint8Array(photoBytes))
            }
          },
          { text: `REFERÊNCIA B — CAPA_CODE=${product.capa_code || ''}; SKU=${product.sku || ''}:` },
          {
            inline_data: {
              mime_type: reference.httpMetadata?.contentType || 'image/jpeg',
              data: base64(new Uint8Array(referenceBytes))
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 120,
        media_resolution: 'MEDIA_RESOLUTION_MEDIUM',
        thinkingConfig: { thinkingLevel: 'minimal' },
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            same_art: { type: 'BOOLEAN' },
            confidence: { type: 'NUMBER' },
            reason: { type: 'STRING' }
          },
          required: ['same_art', 'confidence', 'reason']
        }
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini confirmação final falhou (${response.status})`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) throw new Error('Gemini não retornou confirmação visual final');

  const result = JSON.parse(text);
  const confidence = Math.max(0, Math.min(1, Number(result?.confidence) || 0));
  const sameArt = Boolean(result?.same_art) && confidence >= 0.90;
  return {
    same_art: sameArt,
    confidence,
    reason: cleanReason(result?.reason),
    ms: Date.now() - started,
    model
  };
}
