import app from './worker.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function parseShopeeProductUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('Link da Shopee inválido');
  }

  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' || (host !== 'shopee.com.br' && !host.endsWith('.shopee.com.br'))) {
    throw new Error('Use um link HTTPS da Shopee Brasil');
  }

  let shopId = null;
  let itemId = null;

  const productPath = target.pathname.match(/\/product\/(\d+)\/(\d+)/i);
  if (productPath) {
    shopId = productPath[1];
    itemId = productPath[2];
  }

  if (!shopId || !itemId) {
    const prettyPath = target.pathname.match(/-i\.(\d+)\.(\d+)(?:\/|$)/i);
    if (prettyPath) {
      shopId = prettyPath[1];
      itemId = prettyPath[2];
    }
  }

  if (!shopId || !itemId) {
    throw new Error('Não consegui extrair shop_id e item_id desse link da Shopee');
  }

  return { target, shopId, itemId };
}

function findShopeeItemNode(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 14 || seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value.models) && (Array.isArray(value.tier_variations) || value.models.length)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findShopeeItemNode(item, depth + 1, seen);
      if (found) return found;
    }
    return null;
  }

  for (const item of Object.values(value)) {
    const found = findShopeeItemNode(item, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

function parseJsonScripts(html) {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    if (!body || body.length > 8_000_000) continue;
    if (!body.startsWith('{') && !body.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(body);
      const node = findShopeeItemNode(parsed);
      if (node) return node;
    } catch {
      // Alguns scripts são JavaScript, não JSON puro.
    }
  }
  return null;
}

function shopeeImageSource(value) {
  if (!value) return null;

  if (typeof value === 'object') {
    return shopeeImageSource(
      value.image || value.image_id || value.imageId || value.url || value.image_url || value.imageUrl
    );
  }

  let text = cleanText(value);
  if (!text) return null;
  text = text.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  if (text.startsWith('//')) text = `https:${text}`;

  if (/^https:\/\//i.test(text)) {
    try {
      const parsed = new URL(text);
      if (parsed.hostname === 'susercontent.com' || parsed.hostname.endsWith('.susercontent.com')) {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }

  if (/^[A-Za-z0-9_-]{12,}$/.test(text)) {
    return `https://down-br.img.susercontent.com/file/${text}`;
  }

  return null;
}

function proxyImage(source) {
  return source ? `/api/admin/listing-image?src=${encodeURIComponent(source)}` : null;
}

function buildShopeeVariations(node) {
  const models = Array.isArray(node?.models) ? node.models : [];
  const tiers = Array.isArray(node?.tier_variations) ? node.tier_variations : [];
  const variations = [];
  const seen = new Set();

  for (let index = 0; index < models.length; index++) {
    const model = models[index] || {};
    const tierIndex = Array.isArray(model.tier_index) ? model.tier_index : [];
    const labels = [];
    let optionImage = null;

    for (let tierPos = 0; tierPos < tierIndex.length; tierPos++) {
      const optionIndex = Number(tierIndex[tierPos]);
      const option = tiers?.[tierPos]?.options?.[optionIndex];
      if (!option) continue;
      const label = cleanText(option.name || option.value || option.label);
      if (label) labels.push(label);
      if (!optionImage) optionImage = shopeeImageSource(option.image || option.image_id || option.image_url);
    }

    const modelName = cleanText(model.name);
    const name = modelName || labels.join(' / ') || `Variação ${index + 1}`;
    const source = shopeeImageSource(
      model.image || model.image_id || model.image_url || model.imageUrl
    ) || optionImage;

    if (!source) continue;
    const key = String(model.modelid || model.model_id || `${index}-${name}`);
    const dedupe = `${name.toUpperCase()}|${source}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    variations.push({
      key,
      name,
      labels: labels.length ? labels : [name],
      image_source_url: source,
      image_url: proxyImage(source)
    });
  }

  if (!variations.length && tiers.length === 1) {
    const options = Array.isArray(tiers[0]?.options) ? tiers[0].options : [];
    for (let index = 0; index < options.length; index++) {
      const option = options[index] || {};
      const name = cleanText(option.name || option.value || option.label) || `Variação ${index + 1}`;
      const source = shopeeImageSource(option.image || option.image_id || option.image_url);
      if (!source) continue;
      variations.push({
        key: `option-${index}`,
        name,
        labels: [name],
        image_source_url: source,
        image_url: proxyImage(source)
      });
    }
  }

  return variations;
}

async function analyzeShopeeListing(listingUrl) {
  const { target, shopId, itemId } = parseShopeeProductUrl(listingUrl);
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36',
    'accept': 'application/json,text/plain,*/*',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
    'referer': target.toString(),
    'x-api-source': 'pc'
  };

  let node = null;
  let source = null;
  let apiStatus = null;

  try {
    const endpoint = `https://shopee.com.br/api/v4/pdp/get_pc?item_id=${encodeURIComponent(itemId)}&shop_id=${encodeURIComponent(shopId)}`;
    const response = await fetch(endpoint, { headers, redirect: 'follow' });
    apiStatus = response.status;
    if (response.ok) {
      const payload = await response.json();
      node = findShopeeItemNode(payload);
      if (node) source = 'pdp-json';
    }
  } catch {
    // Se o JSON público estiver indisponível, tentamos o HTML do próprio anúncio.
  }

  if (!node) {
    const response = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'user-agent': headers['user-agent'],
        'accept-language': headers['accept-language']
      }
    });
    if (!response.ok) throw new Error(`Shopee não pôde ser aberta (${response.status})`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error('Shopee não retornou uma página HTML válida');
    node = parseJsonScripts(await response.text());
    if (node) source = 'page-json';
  }

  if (!node) {
    const detail = apiStatus ? ` Resposta do catálogo: ${apiStatus}.` : '';
    throw new Error(`A Shopee abriu, mas não expôs os dados estruturados das variações neste anúncio.${detail}`);
  }

  const variations = buildShopeeVariations(node);
  if (!variations.length) {
    throw new Error('Encontrei o anúncio, mas nenhuma variação com imagem própria pôde ser extraída');
  }

  return {
    ok: true,
    platform: 'SHOPEE',
    listing_url: target.toString(),
    shop_id: shopId,
    item_id: itemId,
    title: cleanText(node.name || node.title || node.item_name) || null,
    source,
    variation_count: variations.length,
    variations
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/shopee-analyze' && request.method === 'POST') {
      try {
        const body = await request.json();
        return json(await analyzeShopeeListing(body?.url));
      } catch (error) {
        return json({ error: error?.message || 'Falha ao analisar anúncio da Shopee' }, 400);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
