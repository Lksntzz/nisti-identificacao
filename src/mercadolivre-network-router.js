import puppeteer from '@cloudflare/puppeteer';
import app from './mercadolivre-catalog-router.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function parseTarget(value) {
  let target;
  try { target = new URL(value); } catch { throw new Error('Link do Mercado Livre inválido'); }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' || (host !== 'mercadolivre.com.br' && !host.endsWith('.mercadolivre.com.br'))) {
    throw new Error('Use um link HTTPS do Mercado Livre Brasil');
  }
  return target;
}

function normalizeMlImage(value) {
  let text = String(value || '').trim().replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  if (!text) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  if (text.startsWith('http://')) text = `https://${text.slice(7)}`;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (host !== 'mlstatic.com' && !host.endsWith('.mlstatic.com'))) return null;
    if (!/\/D_NQ_[A-Z0-9_-]+/i.test(parsed.pathname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function proxyImage(source) {
  return `/api/admin/listing-image?src=${encodeURIComponent(source)}`;
}

function findMlbu(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).match(/MLBU\d+/i)?.[0]?.toUpperCase() || null;
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
    value.href
  ];
  for (const item of preferred) {
    const id = findMlbu(item);
    if (id) return id;
  }
  return null;
}

function findImage(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === 'string') return normalizeMlImage(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = findImage(item, depth + 1);
      if (image) return image;
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
      const image = findImage(item, depth + 1);
      if (image) return image;
    }
  }
  return null;
}

function addLabel(labels, value) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) addLabel(labels, item);
    return;
  }
  if (typeof value === 'object') {
    for (const key of ['name', 'label', 'value_name', 'valueName', 'value', 'title']) addLabel(labels, value[key]);
    return;
  }
  const text = String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 120) return;
  if (!labels.includes(text)) labels.push(text);
}

function labelsFromObject(value) {
  if (!value || typeof value !== 'object') return [];
  const labels = [];
  for (const key of [
    'picker_label','pickerLabel','variation_name','variationName','value_name','valueName',
    'name','label','title','value','option_name','optionName','attributes','variation_attributes',
    'variationAttributes','attribute_combinations','attributeCombinations'
  ]) addLabel(labels, value[key]);
  return labels;
}

function putCandidate(output, candidate) {
  if (!candidate?.image_source_url) return;
  const id = candidate.user_product_id || null;
  const stableKey = id || `${normalizeLabel(candidate.name)}|${candidate.image_source_url}`;
  const current = output.get(stableKey);
  const score = (candidate.labels?.length || 0) + (id ? 5 : 0) + (candidate.name ? 2 : 0);
  const currentScore = current ? (current.labels?.length || 0) + (current.user_product_id ? 5 : 0) + (current.name ? 2 : 0) : -1;
  if (!current || score > currentScore) output.set(stableKey, candidate);
}

function collectCandidates(value, output, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 18 || seen.has(value) || output.size > 100) return;
  seen.add(value);

  if (!Array.isArray(value)) {
    const userProductId = findMlbu(value);
    const image = findImage(value);
    if (image) {
      const labels = labelsFromObject(value);
      putCandidate(output, {
        key: userProductId || `network-${crypto.randomUUID()}`,
        user_product_id: userProductId,
        name: labels[0] || userProductId || 'Opção visual',
        labels: labels.length ? labels : (userProductId ? [userProductId] : []),
        image_source_url: image,
        image_url: proxyImage(image)
      });
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, output, depth + 1, seen);
  } else {
    for (const item of Object.values(value)) collectCandidates(item, output, depth + 1, seen);
  }
}

function collectTextWindows(text, output, imagePool) {
  const decoded = String(text || '').replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
  const images = decoded.match(/https?:\/\/[^"'<>\s]*mlstatic\.com\/D_NQ_[^"'<>\s\\]+/gi) || [];
  for (const raw of images) {
    const image = normalizeMlImage(raw);
    if (image) imagePool.add(image);
  }

  const ids = [...decoded.matchAll(/MLBU\d+/gi)];
  for (const match of ids.slice(0, 120)) {
    const id = match[0].toUpperCase();
    const fragment = decoded.slice(Math.max(0, match.index - 5000), Math.min(decoded.length, match.index + 6000));
    const fragmentImages = fragment.match(/https?:\/\/[^"'<>\s]*mlstatic\.com\/D_NQ_[^"'<>\s\\]+/gi) || [];
    const image = fragmentImages.map(normalizeMlImage).find(Boolean);
    if (!image) continue;
    const labels = [];
    const re = /["'](?:picker_label|pickerLabel|variation_name|variationName|value_name|valueName|label|option_name|optionName)["']\s*:\s*["']([^"']{1,120})["']/gi;
    let labelMatch;
    while ((labelMatch = re.exec(fragment)) && labels.length < 8) addLabel(labels, labelMatch[1]);
    putCandidate(output, {
      key: id,
      user_product_id: id,
      name: labels[0] || id,
      labels: labels.length ? labels : [id],
      image_source_url: image,
      image_url: proxyImage(image)
    });
  }
}

async function triggerPickerUi(page) {
  await page.evaluate(() => {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const candidates = Array.from(document.querySelectorAll('button,a,[role="button"]'))
      .filter(el => {
        const text = normalize(`${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`);
        if (/(COMPRAR|CARRINHO|PAGAR|FRETE)/.test(text)) return false;
        return /(OUTRAS? OPC|MAIS OPC|VER OPC|ESCOLH|SELECION|VARIA|MODELO|COR|ESTAMPA|CAPA)/.test(text);
      });
    candidates[0]?.click();
  }).catch(() => {});
}

async function analyzeNetwork(listingUrl, expectedVariations, env) {
  const target = parseTarget(listingUrl);
  const expected = [...new Set((expectedVariations || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!expected.length) throw new Error('Nenhuma variação do catálogo foi enviada para o analisador do Mercado Livre.');

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });

    const payloads = [];
    const responseTasks = [];
    const endpointUrls = new Set();

    page.on('response', response => {
      const task = (async () => {
        try {
          const responseUrl = response.url();
          if (!/mercadolivre|mercadolibre/i.test(responseUrl)) return;
          const headers = response.headers();
          const type = String(headers['content-type'] || '');
          if (!/(json|javascript|text|html)/i.test(type)) return;
          endpointUrls.add(responseUrl.split('?')[0]);
          const text = await response.text();
          if (!text || text.length > 6_000_000) return;
          if (!/(MLBU\d+|D_NQ_|user_product|variation|picker|family)/i.test(text)) return;
          payloads.push({ url: responseUrl, text });
        } catch {
          // Alguns corpos não ficam disponíveis depois do streaming; ignoramos esses casos.
        }
      })();
      responseTasks.push(task);
    });

    await page.goto(target.toString(), { waitUntil: 'networkidle2', timeout: 30000 });
    await triggerPickerUi(page);
    await new Promise(resolve => setTimeout(resolve, 900));

    // Força lazy-load de componentes e chamadas de dados sem acionar compra/carrinho.
    for (const y of [700, 1400, 2200, 3000]) {
      await page.evaluate(scrollY => window.scrollTo(0, scrollY), y).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 500));
    await Promise.allSettled(responseTasks);

    const candidates = new Map();
    const imagePool = new Set();
    let parsedJson = 0;

    for (const payload of payloads) {
      collectTextWindows(payload.text, candidates, imagePool);
      const trimmed = payload.text.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        parsedJson += 1;
        collectCandidates(parsed, candidates);
      } catch {
        // Muitas respostas carregam JavaScript ou JSONP, então mantemos o scanner textual.
      }
    }

    const paired = [...candidates.values()];
    const uniquePairedImages = new Set(paired.map(item => item.image_source_url)).size;
    if (paired.length >= Math.min(2, expected.length) && uniquePairedImages >= Math.min(2, expected.length)) {
      return {
        ok: true,
        platform: 'MERCADO LIVRE',
        listing_url: target.toString(),
        title: await page.title(),
        source: 'cloudflare-puppeteer-network',
        variation_count: paired.length,
        variations: paired.slice(0, Math.max(expected.length * 3, 18)),
        diagnostics: {
          network_payloads: payloads.length,
          json_payloads: parsedJson,
          endpoints: endpointUrls.size,
          paired_candidates: paired.length,
          unique_images: uniquePairedImages
        }
      };
    }

    const pairedImages = new Set(paired.map(item => item.image_source_url));
    const visualImages = [...imagePool].filter(image => !pairedImages.has(image));
    const combinedImages = [...new Set([...paired.map(item => item.image_source_url), ...visualImages])];
    if (combinedImages.length >= Math.min(2, expected.length)) {
      const variations = combinedImages.slice(0, Math.max(expected.length * 3, 18)).map((image, index) => ({
        key: `network-visual-${index}`,
        user_product_id: null,
        name: `Opção visual ${index + 1}`,
        labels: [`Opção visual ${index + 1}`],
        image_source_url: image,
        image_url: proxyImage(image)
      }));
      return {
        ok: true,
        platform: 'MERCADO LIVRE',
        listing_url: target.toString(),
        title: await page.title(),
        source: 'cloudflare-puppeteer-network-images',
        variation_count: variations.length,
        variations,
        diagnostics: {
          network_payloads: payloads.length,
          json_payloads: parsedJson,
          endpoints: endpointUrls.size,
          image_candidates: variations.length
        }
      };
    }

    throw new Error(
      `Rede do navegador analisada, mas sem opções suficientes: ${payloads.length} resposta(s) útil(eis), ` +
      `${parsedJson} JSON, ${endpointUrls.size} endpoint(s), ${paired.length} candidato(s) com MLBU e ${combinedImages.length} imagem(ns) distinta(s).`
    );
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin/mercadolivre-analyze' && request.method === 'POST') {
      const fallbackRequest = request.clone();
      try {
        const body = await request.json();
        return json(await analyzeNetwork(body?.url, body?.expected_variations, env));
      } catch (networkError) {
        try {
          const fallback = await app.fetch(fallbackRequest, env, ctx);
          if (fallback.ok) return fallback;
          const payload = await fallback.clone().json().catch(() => ({}));
          return json({
            error: `${networkError?.message || 'Análise da rede falhou.'} Fallback por interação: ${payload?.error || `HTTP ${fallback.status}`}`
          }, 400);
        } catch (fallbackError) {
          return json({
            error: `${networkError?.message || 'Análise da rede falhou.'} Fallback por interação: ${fallbackError?.message || 'falhou também.'}`
          }, 400);
        }
      }
    }
    return app.fetch(request, env, ctx);
  }
};
