import app from './worker-router.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function decodeMarkup(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/');
}

function proxyImage(source) {
  return source ? `/api/admin/listing-image?src=${encodeURIComponent(source)}` : null;
}

function parseMercadoLivreProductUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('Link do Mercado Livre inválido');
  }

  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' || (host !== 'mercadolivre.com.br' && !host.endsWith('.mercadolivre.com.br'))) {
    throw new Error('Use um link HTTPS do Mercado Livre Brasil');
  }

  const match = target.pathname.match(/\/up\/(MLBU\d+)/i);
  if (!match) {
    throw new Error('Este link não contém um User Product MLBU. Abra o anúncio com /up/MLBU...');
  }

  return { target, userProductId: match[1].toUpperCase() };
}

function mercadoImageSource(value, depth = 0) {
  if (!value || depth > 5) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const source = mercadoImageSource(item, depth + 1);
      if (source) return source;
    }
    return null;
  }

  if (typeof value === 'object') {
    const preferred = [
      value.secure_url,
      value.secureUrl,
      value.thumbnail,
      value.thumbnail_url,
      value.thumbnailUrl,
      value.picture,
      value.pictures,
      value.image,
      value.images,
      value.src,
      value.url
    ];
    for (const item of preferred) {
      const source = mercadoImageSource(item, depth + 1);
      if (source) return source;
    }
    return null;
  }

  let text = decodeMarkup(value).trim();
  if (!text) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  if (text.startsWith('http://')) text = `https://${text.slice('http://'.length)}`;
  if (!text.startsWith('https://')) return null;

  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'mlstatic.com' && !host.endsWith('.mlstatic.com')) return null;
    if (!/\/D_NQ_[A-Z0-9_-]+/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function mercadoUserProductId(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    const match = String(value).match(/MLBU\d+/i);
    return match ? match[0].toUpperCase() : null;
  }
  if (!value || typeof value !== 'object') return null;

  const preferred = [
    value.user_product_id,
    value.userProductId,
    value.user_product?.id,
    value.userProduct?.id,
    value.id,
    value.permalink,
    value.url,
    value.href,
    value.link
  ];
  for (const item of preferred) {
    const id = mercadoUserProductId(item);
    if (id) return id;
  }
  return null;
}

function addMercadoLabel(labels, value) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) addMercadoLabel(labels, item);
    return;
  }
  if (typeof value === 'object') {
    addMercadoLabel(labels, value.value_name);
    addMercadoLabel(labels, value.valueName);
    addMercadoLabel(labels, value.name);
    addMercadoLabel(labels, value.label);
    addMercadoLabel(labels, value.value);
    addMercadoLabel(labels, value.values);
    return;
  }

  const text = cleanText(decodeMarkup(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  if (!text || text.length > 140) return;
  if (!labels.includes(text)) labels.push(text);
}

function mercadoLabelsFromObject(value) {
  if (!value || typeof value !== 'object') return [];
  const labels = [];

  for (const key of [
    'picker_label', 'pickerLabel', 'variation_name', 'variationName', 'value_name', 'valueName',
    'label', 'name', 'title', 'value', 'option_name', 'optionName'
  ]) addMercadoLabel(labels, value[key]);

  for (const key of [
    'attributes', 'attribute_combinations', 'attributeCombinations', 'variation_attributes',
    'variationAttributes', 'options', 'values'
  ]) addMercadoLabel(labels, value[key]);

  return labels;
}

function putMercadoCandidate(output, candidate) {
  if (!candidate?.user_product_id || !candidate?.image_source_url) return;
  const current = output.get(candidate.user_product_id);
  if (!current) {
    output.set(candidate.user_product_id, candidate);
    return;
  }

  const currentScore = (current.labels?.length || 0) + (current.name && current.name !== current.user_product_id ? 3 : 0);
  const nextScore = (candidate.labels?.length || 0) + (candidate.name && candidate.name !== candidate.user_product_id ? 3 : 0);
  if (nextScore > currentScore) output.set(candidate.user_product_id, candidate);
}

function collectMercadoCandidates(value, output, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 18 || seen.has(value) || output.size > 100) return;
  seen.add(value);

  if (!Array.isArray(value)) {
    const userProductId = mercadoUserProductId(value);
    const image = mercadoImageSource(value);
    if (userProductId && image) {
      const labels = mercadoLabelsFromObject(value);
      putMercadoCandidate(output, {
        key: userProductId,
        user_product_id: userProductId,
        name: labels[0] || userProductId,
        labels: labels.length ? labels : [userProductId],
        image_source_url: image,
        image_url: proxyImage(image)
      });
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) collectMercadoCandidates(item, output, depth + 1, seen);
    return;
  }

  for (const item of Object.values(value)) collectMercadoCandidates(item, output, depth + 1, seen);
}

function parseMercadoJsonScripts(html, output) {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  let parsedScripts = 0;

  for (const script of scripts) {
    if (output.size > 100) break;
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    if (!body || body.length > 10_000_000) continue;

    const jsonCandidates = [body];
    const assignment = body.match(/^[\w.$]+\s*=\s*([\s\S]+?);?$/);
    if (assignment?.[1]) jsonCandidates.push(assignment[1].trim());

    for (const candidate of jsonCandidates) {
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(candidate);
        parsedScripts += 1;
        collectMercadoCandidates(parsed, output);
        break;
      } catch {
        // Estado serializado pode ser JavaScript, não JSON estrito.
      }
    }
  }

  return parsedScripts;
}

function parseMercadoHtmlPickers(html, output) {
  const anchorRegex = /<a\b([^>]*\bhref\s*=\s*["']([^"']*\/up\/MLBU\d+[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  let anchors = 0;

  while ((match = anchorRegex.exec(html)) && output.size <= 100) {
    anchors += 1;
    const attrs = decodeMarkup(match[1]);
    const href = decodeMarkup(match[2]);
    const inner = decodeMarkup(match[3]);
    const userProductId = mercadoUserProductId(href);
    if (!userProductId) continue;

    const imageCandidates = [];
    const imageRegex = /(?:src|data-src|srcset)\s*=\s*["']([^"']+)["']/gi;
    let imageMatch;
    while ((imageMatch = imageRegex.exec(inner))) {
      const pieces = imageMatch[1].split(',').map(item => item.trim().split(/\s+/)[0]);
      imageCandidates.push(...pieces);
    }

    let image = null;
    for (const candidate of imageCandidates) {
      image = mercadoImageSource(candidate);
      if (image) break;
    }
    if (!image) continue;

    const labels = [];
    const aria = attrs.match(/\b(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1];
    addMercadoLabel(labels, aria);
    addMercadoLabel(labels, inner.replace(/<[^>]+>/g, ' '));

    putMercadoCandidate(output, {
      key: userProductId,
      user_product_id: userProductId,
      name: labels[0] || userProductId,
      labels: labels.length ? labels : [userProductId],
      image_source_url: image,
      image_url: proxyImage(image)
    });
  }

  return anchors;
}

function parseMercadoEmbeddedWindows(html, output) {
  const decoded = decodeMarkup(html);
  const idRegex = /MLBU\d+/gi;
  let match;
  let windows = 0;
  const handled = new Set();

  while ((match = idRegex.exec(decoded)) && windows < 160 && output.size <= 100) {
    const userProductId = match[0].toUpperCase();
    const marker = `${userProductId}:${Math.floor(match.index / 600)}`;
    if (handled.has(marker)) continue;
    handled.add(marker);
    windows += 1;

    const start = Math.max(0, match.index - 5000);
    const end = Math.min(decoded.length, match.index + 6000);
    const windowText = decoded.slice(start, end);

    const images = windowText.match(/https:\/\/[^"'<>\s]*mlstatic\.com\/D_NQ_[^"'<>\s\\]+/gi) || [];
    let image = null;
    for (const raw of images) {
      image = mercadoImageSource(raw);
      if (image) break;
    }
    if (!image) continue;

    const labels = [];
    const labelRegex = /["'](?:picker_label|pickerLabel|variation_name|variationName|value_name|valueName|label|option_name|optionName)["']\s*:\s*["']([^"']{1,140})["']/gi;
    let labelMatch;
    while ((labelMatch = labelRegex.exec(windowText)) && labels.length < 12) addMercadoLabel(labels, labelMatch[1]);

    putMercadoCandidate(output, {
      key: userProductId,
      user_product_id: userProductId,
      name: labels[0] || userProductId,
      labels: labels.length ? labels : [userProductId],
      image_source_url: image,
      image_url: proxyImage(image)
    });
  }

  return windows;
}

function mercadoPageTitle(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (String(property || '').toLowerCase() !== 'og:title') continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return cleanText(decodeMarkup(content));
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? cleanText(decodeMarkup(title).replace(/<[^>]+>/g, ' ')) : null;
}

function extractIds(html) {
  const decoded = decodeMarkup(html);
  const userProducts = [...new Set((decoded.match(/MLBU\d+/gi) || []).map(id => id.toUpperCase()))];
  const items = [...new Set((decoded.match(/\bMLB\d{8,}\b/gi) || []).map(id => id.toUpperCase()))];
  const sellerMatch = decoded.match(/["']?(?:seller_id|sellerId)["']?\s*[:=]\s*["']?(\d{5,})/i);
  const familyMatch = decoded.match(/["']?(?:family_id|familyId)["']?\s*[:=]\s*["']?(\d{4,})/i);
  return {
    userProducts,
    items,
    sellerId: sellerMatch?.[1] || null,
    familyId: familyMatch?.[1] || null
  };
}

function addApiResultCandidate(result, output) {
  if (!result || typeof result !== 'object') return;
  const userProductId = mercadoUserProductId(result.user_product_id || result.userProductId || result);
  const image = mercadoImageSource(result.thumbnail || result.secure_thumbnail || result.pictures || result);
  if (!userProductId || !image) return;

  const labels = [];
  addMercadoLabel(labels, result.title);
  addMercadoLabel(labels, result.attributes);
  addMercadoLabel(labels, result.variation_attributes);

  putMercadoCandidate(output, {
    key: userProductId,
    user_product_id: userProductId,
    name: labels[0] || userProductId,
    labels: labels.length ? labels : [userProductId],
    image_source_url: image,
    image_url: proxyImage(image),
    item_id: result.id || null,
    family_id: result.family_id || null
  });
}

async function tryPublicItemLookup(itemIds, output) {
  if (!itemIds.length) return { status: null, count: 0, seller_id: null, family_id: null };
  const ids = itemIds.slice(0, 20).join(',');
  const endpoint = `https://api.mercadolibre.com/items?ids=${encodeURIComponent(ids)}&attributes=id,title,seller_id,thumbnail,pictures,attributes,user_product_id,family_id`;

  try {
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (!response.ok) return { status: response.status, count: 0, seller_id: null, family_id: null };
    const payload = await response.json();
    let count = 0;
    let sellerId = null;
    let familyId = null;
    for (const entry of Array.isArray(payload) ? payload : []) {
      const body = entry?.body || entry;
      if (!body || entry?.code >= 400) continue;
      sellerId ||= body.seller_id ? String(body.seller_id) : null;
      familyId ||= body.family_id ? String(body.family_id) : null;
      const before = output.size;
      addApiResultCandidate(body, output);
      if (output.size > before) count += 1;
    }
    return { status: response.status, count, seller_id: sellerId, family_id: familyId };
  } catch {
    return { status: 'network-error', count: 0, seller_id: null, family_id: null };
  }
}

async function tryPublicSearch({ title, sellerId, familyId, knownUserProducts }, output) {
  if (!title) return { status: null, count: 0, total: 0 };

  const params = new URLSearchParams({ q: title, limit: '50' });
  if (sellerId) params.set('seller_id', sellerId);
  const endpoint = `https://api.mercadolibre.com/sites/MLB/search?${params.toString()}`;

  try {
    const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
    if (!response.ok) return { status: response.status, count: 0, total: 0 };
    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    let count = 0;

    for (const result of results) {
      const up = mercadoUserProductId(result.user_product_id || result.userProductId || result);
      const sameKnownUp = up && knownUserProducts.has(up);
      const sameFamily = familyId && String(result.family_id || '') === String(familyId);
      const sameSeller = sellerId && String(result.seller?.id || result.seller_id || '') === String(sellerId);
      if (knownUserProducts.size && !sameKnownUp && !sameFamily && !sameSeller) continue;

      const before = output.size;
      addApiResultCandidate(result, output);
      if (output.size > before) count += 1;
    }

    return { status: response.status, count, total: results.length };
  } catch {
    return { status: 'network-error', count: 0, total: 0 };
  }
}

async function analyzeMercadoLivreListing(listingUrl) {
  const { target, userProductId } = parseMercadoLivreProductUrl(listingUrl);
  const response = await fetch(target.toString(), {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7'
    }
  });

  if (!response.ok) throw new Error(`Mercado Livre não pôde ser aberto (${response.status})`);
  const finalUrl = new URL(response.url || target.toString());
  const finalHost = finalUrl.hostname.toLowerCase();
  if (finalHost !== 'mercadolivre.com.br' && !finalHost.endsWith('.mercadolivre.com.br')) {
    throw new Error('O anúncio redirecionou para fora do Mercado Livre');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error('Mercado Livre não retornou uma página HTML válida');

  const html = await response.text();
  const title = mercadoPageTitle(html);
  const ids = extractIds(html);
  if (!ids.userProducts.includes(userProductId)) ids.userProducts.unshift(userProductId);

  const candidates = new Map();
  const parsedScripts = parseMercadoJsonScripts(html, candidates);
  const pickerAnchors = parseMercadoHtmlPickers(html, candidates);
  const windows = parseMercadoEmbeddedWindows(html, candidates);

  const itemLookup = await tryPublicItemLookup(ids.items, candidates);
  const sellerId = ids.sellerId || itemLookup.seller_id;
  const familyId = ids.familyId || itemLookup.family_id;
  const searchLookup = await tryPublicSearch({
    title,
    sellerId,
    familyId,
    knownUserProducts: new Set(ids.userProducts)
  }, candidates);

  const variations = [...candidates.values()];
  if (!variations.length) {
    throw new Error(
      `Encontrei o anúncio MLBU, mas ainda não consegui obter as variações com imagem. ` +
      `Diagnóstico: ${parsedScripts} JSON, ${pickerAnchors} picker(s), ${windows} bloco(s) MLBU, ` +
      `${ids.userProducts.length} MLBU detectado(s), ${ids.items.length} item(ns) MLB, ` +
      `API itens=${itemLookup.status ?? 'n/a'}, busca=${searchLookup.status ?? 'n/a'}.`
    );
  }

  return {
    ok: true,
    platform: 'MERCADO LIVRE',
    listing_url: finalUrl.toString(),
    user_product_id: userProductId,
    title,
    source: candidates.size ? 'upp-page+public-fallbacks' : 'upp-page',
    variation_count: variations.length,
    variations,
    diagnostics: {
      json_scripts: parsedScripts,
      picker_links: pickerAnchors,
      mlbu_windows: windows,
      detected_user_products: ids.userProducts.length,
      detected_items: ids.items.length,
      seller_id: sellerId,
      family_id: familyId,
      public_items_status: itemLookup.status,
      public_items_matches: itemLookup.count,
      public_search_status: searchLookup.status,
      public_search_matches: searchLookup.count,
      public_search_total: searchLookup.total
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/mercadolivre-analyze' && request.method === 'POST') {
      try {
        const body = await request.json();
        return json(await analyzeMercadoLivreListing(body?.url));
      } catch (error) {
        return json({ error: error?.message || 'Falha ao analisar anúncio do Mercado Livre' }, 400);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
