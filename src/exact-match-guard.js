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
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 320);
}

function strictBoolean(value) {
  return value === true;
}

export async function verifyExactVisualMatch(request, env, data) {
  const started = Date.now();
  const product = productFromResult(data);
  if (!product?.image_key) {
    return {
      same_art: false,
      confidence: 0,
      reason: 'O produto retornado não possui imagem de referência para a confirmação final.',
      checks: null,
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
            text: `Você é a última barreira de segurança antes de liberar um SKU para produção.

Faça uma verificação BINÁRIA e CONSERVADORA entre duas capas.
FOTO A é a capa física fotografada. REFERÊNCIA B é o mockup que o sistema pretende retornar.

Objetivo: evitar falso positivo. Um falso negativo é aceitável; um SKU errado não é.

Responda same_art=true SOMENTE se for claramente a MESMA ARTE-BASE.
Ignore apenas conteúdo personalizado: nome, iniciais, palavras, datas e pequenas variações de impressão. Ignore também Wire-O/espiral, tassel, elástico, mão, mesa, brilho, reflexo, corte, perspectiva e iluminação.

NÃO aceite por tema, categoria, paleta ou estilo parecido. Flores, borboletas, tons rosa, elementos delicados e o mesmo tipo de produto NÃO provam identidade.

Avalie separadamente:
1. background_structure: fundo e grandes blocos/molduras/áreas centrais têm a mesma estrutura;
2. layout_structure: os elementos principais ocupam posições equivalentes;
3. decorative_structure: ilustrações, flores, folhagens, borboletas, personagens e objetos principais são os mesmos e estão distribuídos de forma equivalente;
4. signature_elements: elementos distintivos da arte coincidem; não existem elementos grandes presentes em uma imagem e ausentes na outra.

Se houver moldura central em uma e não na outra, arranjo floral diferente, borboletas em posições diferentes, fundo estruturalmente diferente, personagem/objeto diferente ou qualquer composição principal incompatível, marque o respectivo critério como false e same_art=false.

Na menor dúvida, use same_art=false. Não tente escolher a imagem mais parecida.`
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
        maxOutputTokens: 180,
        media_resolution: 'MEDIA_RESOLUTION_HIGH',
        thinkingConfig: { thinkingLevel: 'minimal' },
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            same_art: { type: 'BOOLEAN' },
            background_structure: { type: 'BOOLEAN' },
            layout_structure: { type: 'BOOLEAN' },
            decorative_structure: { type: 'BOOLEAN' },
            signature_elements: { type: 'BOOLEAN' },
            confidence: { type: 'NUMBER' },
            reason: { type: 'STRING' }
          },
          required: [
            'same_art',
            'background_structure',
            'layout_structure',
            'decorative_structure',
            'signature_elements',
            'confidence',
            'reason'
          ]
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
  const checks = {
    background_structure: strictBoolean(result?.background_structure),
    layout_structure: strictBoolean(result?.layout_structure),
    decorative_structure: strictBoolean(result?.decorative_structure),
    signature_elements: strictBoolean(result?.signature_elements)
  };
  const structuralPass = Object.values(checks).every(Boolean);
  const sameArt = strictBoolean(result?.same_art) && structuralPass && confidence >= 0.97;

  return {
    same_art: sameArt,
    confidence,
    reason: cleanReason(result?.reason),
    checks,
    ms: Date.now() - started,
    model
  };
}
