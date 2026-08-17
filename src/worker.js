import { parseSku } from './sku.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function base64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function productWithPlatform(env, id) {
  return env.DB.prepare(`SELECT p.*, pp.platform, pp.link FROM products p LEFT JOIN product_platforms pp ON pp.product_id=p.id WHERE p.id=? LIMIT 1`).bind(id).first();
}

async function identifyWithGemini(env, uploadedFile) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY não configurada');
  const { results } = await env.DB.prepare(`SELECT id, sku, capa_code, wireo_code, tassel_code, elastico_code, image_key FROM products WHERE image_key IS NOT NULL ORDER BY id DESC LIMIT 12`).all();
  if (!results?.length) throw new Error('Cadastre produtos com imagem antes de identificar');

  const parts = [{ text: `Você é o identificador visual interno da NISTI PRINT. Compare a FOTO DO PRODUTO com as IMAGENS DE REFERÊNCIA abaixo. Escolha somente um SKU da lista se houver correspondência visual forte. Observe principalmente arte/capa, Wire-O, tassel e elástico. Nomes personalizados impressos na capa podem variar e devem ser ignorados. Se não houver correspondência segura, use matched=false e sku="".` }];

  for (const p of results) {
    const obj = await env.PRODUCT_IMAGES.get(p.image_key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    parts.push({ text: `REFERÊNCIA SKU=${p.sku}; CAPA=${p.capa_code}; WIREO=${p.wireo_code}; TASSEL=${p.tassel_code}; ELASTICO=${p.elastico_code}` });
    parts.push({ inline_data: { mime_type: obj.httpMetadata?.contentType || 'image/jpeg', data: base64(bytes) } });
  }

  const uploadBytes = new Uint8Array(await uploadedFile.arrayBuffer());
  parts.push({ text: 'FOTO DO PRODUTO A IDENTIFICAR:' });
  parts.push({ inline_data: { mime_type: uploadedFile.type || 'image/jpeg', data: base64(uploadBytes) } });

  const model = env.GEMINI_MODEL || 'gemini-3.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json',
        response_schema: {
          type: 'OBJECT',
          properties: {
            matched: { type: 'BOOLEAN' },
            sku: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
            reason: { type: 'STRING' }
          },
          required: ['matched', 'sku', 'confidence', 'reason']
        }
      }
    })
  });
  if (!response.ok) throw new Error(`Gemini falhou (${response.status})`);
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  if (!text) throw new Error('Gemini não retornou resultado');
  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, service: 'nisti-identificacao' });

      if (url.pathname === '/api/sku/parse' && request.method === 'POST') {
        const { sku } = await request.json();
        return json(parseSku(sku));
      }

      if (url.pathname === '/api/products' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT p.id,p.sku,p.miolo_code,p.capa_code,p.acabamento_code,p.wireo_code,p.tassel_code,p.elastico_code,p.nome,p.variacao,p.image_key,p.created_at,pp.platform FROM products p LEFT JOIN product_platforms pp ON pp.product_id=p.id ORDER BY p.id DESC LIMIT 500`).all();
        return json({ products: (results || []).map(p => ({ ...p, image_url: p.image_key ? `/api/images/${p.id}` : null })) });
      }

      if (url.pathname === '/api/products' && request.method === 'POST') {
        const body = await request.json();
        const parsed = parseSku(body.sku);
        const result = await env.DB.prepare(`INSERT INTO products (sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao) VALUES (?,?,?,?,?,?,?,?,?)`).bind(parsed.sku, parsed.mioloCode, parsed.capaCode, parsed.acabamentoCode, parsed.wireoCode, parsed.tasselCode, parsed.elasticoCode, body.nome || null, body.variacao || null).run();
        const id = result.meta.last_row_id;
        if (body.platform) await env.DB.prepare(`INSERT INTO product_platforms (product_id,platform,link) VALUES (?,?,?)`).bind(id, String(body.platform).trim().toUpperCase(), body.link || null).run();
        return json({ ok: true, id, parsed }, 201);
      }

      const imageUpload = url.pathname.match(/^\/api\/products\/(\d+)\/image$/);
      if (imageUpload && request.method === 'POST') {
        const id = Number(imageUpload[1]);
        const form = await request.formData();
        const file = form.get('image');
        if (!(file instanceof File)) return json({ error: 'Imagem obrigatória' }, 400);
        if (!file.type.startsWith('image/')) return json({ error: 'Arquivo deve ser uma imagem' }, 400);
        const key = `products/${id}/${crypto.randomUUID()}`;
        await env.PRODUCT_IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
        await env.DB.prepare(`UPDATE products SET image_key=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(key, id).run();
        return json({ ok: true, image_url: `/api/images/${id}` });
      }

      const imageGet = url.pathname.match(/^\/api\/images\/(\d+)$/);
      if (imageGet && request.method === 'GET') {
        const product = await env.DB.prepare(`SELECT image_key FROM products WHERE id=?`).bind(Number(imageGet[1])).first();
        if (!product?.image_key) return new Response('Not found', { status: 404 });
        const object = await env.PRODUCT_IMAGES.get(product.image_key);
        if (!object) return new Response('Not found', { status: 404 });
        const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('cache-control', 'private, max-age=3600');
        return new Response(object.body, { headers });
      }

      if (url.pathname === '/api/identify' && request.method === 'POST') {
        const form = await request.formData();
        const image = form.get('image');
        if (!(image instanceof File)) return json({ error: 'Foto obrigatória' }, 400);
        const ai = await identifyWithGemini(env, image);
        if (!ai.matched || !ai.sku || ai.confidence < 0.85) return json({ error: 'Correspondência visual insuficiente. Tire outra foto.' }, 422);
        const product = await env.DB.prepare(`SELECT p.*,pp.platform FROM products p LEFT JOIN product_platforms pp ON pp.product_id=p.id WHERE p.sku=? LIMIT 1`).bind(ai.sku.toUpperCase()).first();
        if (!product) return json({ error: 'A IA retornou um SKU que não existe no banco.' }, 422);
        const parsed = parseSku(product.sku);
        return json({ product: { ...product, wireo: parsed.wireo, tassel: parsed.tassel, elastico: parsed.elastico, image_url: product.image_key ? `/api/images/${product.id}` : null }, confidence: ai.confidence });
      }

      if (env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const msg = error?.message || 'Erro interno';
      const status = /UNIQUE constraint/i.test(msg) ? 409 : 400;
      return json({ error: msg }, status);
    }
  }
};
