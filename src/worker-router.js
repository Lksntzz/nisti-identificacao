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

function shopeeNodeScore(value) {
  if (!value || typeof value !== 'object') return -1;
  const models = Array.isArray(value.models) ? value.models : [];
  const tiers = Array.isArray(value.tier_variations) ? value.tier_variations : [];
  if (!models.length && !tiers.length) return -1;

  let score = models.length ? 10 : 0;
  score += tiers.length ? 20 : 0;
  for (const tier of tiers) {
    if (Array.isArray(tier?.options) && tier.options.length) score += 4;
    if (Array.isArray(tier?.images) && tier.images.some(Boolean)) score += 12;
    if (Array.isArray(tier?.image_ids) && tier.image_ids.some(Boolean)) score += 12;
  }
  return score;
}

function findShopeeItemNode(value) {
  let best = null;
  let bestScore = -1;
  const seen = new Set();

  const visit = (current, depth = 0) => {
    if (!current || typeof current !== 'object' || depth > 16 || seen.has(current)) return;
    seen.add(current);

    const score = shopeeNodeScore(current);
    if (score > bestScore) {
      best = current;
      bestScore = score;
    }

    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
      return;
    }

    for (const item of Object.values(current)) visit(item, depth + 1);
  };

  visit(value);
  return best;
}

function parseJsonScripts(html) {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  let best = null;
  let bestScore = -1;

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
      const score = shopeeNodeScore(node);
      if (node && score > bestScore) {
        best = node;
        bestScore = score;
      }
    } catch {
      // Alguns scripts são JavaScript, não JSON puro.
    }
  }
  return best;
}

function shopeeImageSource(value, depth = 0) {
  if (!value || depth > 5) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const source = shopeeImageSource(item, depth + 1);
      if (source) return source;
    }
    return null;
  }

  if (typeof value === 'object') {
    const preferred = [
      value.image,
      value.image_id,
      value.imageId,
      value.url,
      value.image_url,
      value.imageUrl,
      value.filename,
      value.file
    ];
    for (const item of preferred) {
      const source = shopeeImageSource(item, depth + 1);
      if (source) return source;
    }
    return null;
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

function tierIndexForModel(model) {
  const candidates = [
    model?.tier_index,
    model?.tierIndex,
    model?.extinfo?.tier_index,
    model?.extinfo?.tierIndex,
    model?.ext_info?.tier_index,
    model?.ext_info?.tierIndex
  ];
  return candidates.find(Array.isArray) || [];
}

function tierImageAt(tier, optionIndex) {
  if (!tier || !Number.isInteger(optionIndex) || optionIndex < 0) return null;
  const option = Array.isArray(tier.options) ? tier.options[optionIndex] : null;
  const candidates = [
    option?.image,
    option?.image_id,
    option?.imageId,
    option?.image_url,
    option?.imageUrl,
    Array.isArray(tier.images) ? tier.images[optionIndex] : null,
    Array.isArray(tier.image_ids) ? tier.image_ids[optionIndex] : null,
    Array.isArray(tier.imageIds) ? tier.imageIds[optionIndex] : null,
    Array.isArray(tier.option_images) ? tier.option_images[optionIndex] : null,
    Array.isArray(tier.optionImages) ? tier.optionImages[optionIndex] : null
  ];

  for (const candidate of candidates) {
    const source = shopeeImageSource(candidate);
    if (source) return source;
  }
  return null;
}

function buildShopeeVariations(node) {
  const models = Array.isArray(node?.models) ? node.models : [];
  const tiers = Array.isArray(node?.tier_variations) ? node.tier_variations : [];
  const variations = [];
  const seen = new Set();

  for (let index = 0; index < models.length; index++) {
    const model = models[index] || {};
    let tierIndex = tierIndexForModel(model);

    if (!tierIndex.length && tiers.length === 1 && models.length === (tiers[0]?.options?.length || 0)) {
      tierIndex = [index];
    }

    const labels = [];
    let optionImage = null;

    for (let tierPos = 0; tierPos < tierIndex.length; tierPos++) {
      const optionIndex = Number(tierIndex[tierPos]);
      if (!Number.isInteger(optionIndex) || optionIndex < 0) continue;
      const tier = tiers?.[tierPos];
      const option = tier?.options?.[optionIndex];
      const label = cleanText(option?.name || option?.value || option?.label);
      if (label) labels.push(label);
      if (!optionImage) optionImage = tierImageAt(tier, optionIndex);
    }

    const modelName = cleanText(model.name);
    const name = modelName || labels.join(' / ') || `Variação ${index + 1}`;
    const source = shopeeImageSource(
      model.image || model.image_id || model.imageId || model.image_url || model.imageUrl
    ) || optionImage;

    if (!source) continue;
    const key = String(model.modelid || model.model_id || model.id || `${index}-${name}`);
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

  if (!variations.length) {
    for (let tierPos = 0; tierPos < tiers.length; tierPos++) {
      const tier = tiers[tierPos] || {};
      const options = Array.isArray(tier.options) ? tier.options : [];
      for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
        const option = options[optionIndex] || {};
        const name = cleanText(option.name || option.value || option.label) || `Variação ${optionIndex + 1}`;
        const source = tierImageAt(tier, optionIndex);
        if (!source) continue;
        const dedupe = `${name.toUpperCase()}|${source}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        variations.push({
          key: `tier-${tierPos}-option-${optionIndex}`,
          name,
          labels: [name],
          image_source_url: source,
          image_url: proxyImage(source)
        });
      }
    }
  }

  return variations;
}

function variationDiagnostics(node) {
  const models = Array.isArray(node?.models) ? node.models : [];
  const tiers = Array.isArray(node?.tier_variations) ? node.tier_variations : [];
  return {
    models: models.length,
    tiers: tiers.length,
    tier_options: tiers.map(tier => Array.isArray(tier?.options) ? tier.options.length : 0),
    tier_images: tiers.map(tier => {
      if (Array.isArray(tier?.images)) return tier.images.filter(Boolean).length;
      if (Array.isArray(tier?.image_ids)) return tier.image_ids.filter(Boolean).length;
      return 0;
    })
  };
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
    const diag = variationDiagnostics(node);
    throw new Error(
      `Encontrei o anúncio, mas não consegui ligar imagens às variações. ` +
      `Diagnóstico: ${diag.models} modelos, ${diag.tiers} grupo(s) de variação, ` +
      `opções ${diag.tier_options.join('/') || '0'}, imagens de opções ${diag.tier_images.join('/') || '0'}.`
    );
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
