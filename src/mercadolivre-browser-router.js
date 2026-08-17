import app from './mercadolivre-router.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
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

function cleanText(value) {
  return decodeMarkup(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTarget(value) {
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

  const id = target.pathname.match(/\/up\/(MLBU\d+)/i)?.[1]?.toUpperCase() || null;
  if (!id) throw new Error('O link precisa conter /up/MLBU...');
  return { target, currentUserProductId: id };
}

function mlbu(value) {
  return String(value || '').match(/MLBU\d+/i)?.[0]?.toUpperCase() || null;
}

function normalizeImage(value) {
  let text = decodeMarkup(value).trim();
  if (!text) return null;
  text = text.split(/\s+/)[0].replace(/[),;]+$/, '');
  if (text.startsWith('//')) text = `https:${text}`;
  if (text.startsWith('http://')) text = `https://${text.slice(7)}`;
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

function proxyImage(source) {
  return `/api/admin/listing-image?src=${encodeURIComponent(source)}`;
}

function extractImages(fragment) {
  const images = [];
  const decoded = decodeMarkup(fragment);
  const attrRegex = /(?:src|data-src|data-zoom|srcset)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRegex.exec(decoded))) {
    for (const piece of match[1].split(',')) {
      const image = normalizeImage(piece.trim());
      if (image && !images.includes(image)) images.push(image);
    }
  }

  const absoluteRegex = /https:\/\/[^"'<>\s\\]+mlstatic\.com\/D_NQ_[^"'<>\s\\]+/gi;
  while ((match = absoluteRegex.exec(decoded))) {
    const image = normalizeImage(match[0]);
    if (image && !images.includes(image)) images.push(image);
  }
  return images;
}

function extractLabels(attrs, inner) {
  const labels = [];
  const add = value => {
    const text = cleanText(value);
    if (!text || text.length > 120) return;
    if (!labels.includes(text)) labels.push(text);
  };

  for (const regex of [
    /\baria-label\s*=\s*["']([^"']+)["']/i,
    /\btitle\s*=\s*["']([^"']+)["']/i,
    /\bdata-title\s*=\s*["']([^"']+)["']/i,
    /\bdata-value\s*=\s*["']([^"']+)["']/i
  ]) add(attrs.match(regex)?.[1]);

  const imgAlt = inner.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i)?.[1];
  add(imgAlt);
  add(inner);
  return labels;
}

function putCandidate(map, candidate) {
  if (!candidate?.user_product_id || !candidate?.image_source_url) return;
  const current = map.get(candidate.user_product_id);
  const nextScore = (candidate.labels?.length || 0) + (candidate.name && candidate.name !== candidate.user_product_id ? 4 : 0);
  const currentScore = current ? (current.labels?.length || 0) + (current.name && current.name !== current.user_product_id ? 4 : 0) : -1;
  if (!current || nextScore > currentScore) map.set(candidate.user_product_id, candidate);
}

function extractRenderedCandidates(html, currentUserProductId) {
  const decoded = decodeMarkup(html);
  const candidates = new Map();
  let anchors = 0;

  const anchorRegex = /<a\b([^>]*\bhref\s*=\s*["']([^"']*\/up\/MLBU\d+[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(decoded)) && candidates.size < 100) {
    anchors += 1;
    const attrs = match[1];
    const href = match[2];
    const inner = match[3];
    const userProductId = mlbu(href) || mlbu(attrs) || mlbu(inner);
    if (!userProductId) continue;
    const image = extractImages(inner)[0] || extractImages(attrs)[0];
    if (!image) continue;
    const labels = extractLabels(attrs, inner);
    putCandidate(candidates, {
      key: userProductId,
      user_product_id: userProductId,
      name: labels[0] || userProductId,
      labels: labels.length ? labels : [userProductId],
      image_source_url: image,
      image_url: proxyImage(image)
    });
  }

  // Alguns pickers são botões/divs com data-href, não anchors.
  const tagRegex = /<(?:button|li|div)\b([^>]*MLBU\d+[^>]*)>([\s\S]{0,3500}?)<\/(?:button|li|div)>/gi;
  while ((match = tagRegex.exec(decoded)) && candidates.size < 100) {
    const attrs = match[1];
    const inner = match[2];
    const userProductId = mlbu(attrs) || mlbu(inner);
    if (!userProductId) continue;
    const image = extractImages(inner)[0] || extractImages(attrs)[0];
    if (!image) continue;
    const labels = extractLabels(attrs, inner);
    putCandidate(candidates, {
      key: userProductId,
      user_product_id: userProductId,
      name: labels[0] || userProductId,
      labels: labels.length ? labels : [userProductId],
      image_source_url: image,
      image_url: proxyImage(image)
    });
  }

  // Fallback: procura imagem próxima de cada MLBU no HTML já renderizado.
  const idRegex = /MLBU\d+/gi;
  let windows = 0;
  const seenWindows = new Set();
  while ((match = idRegex.exec(decoded)) && windows < 220 && candidates.size < 100) {
    const userProductId = match[0].toUpperCase();
    const key = `${userProductId}:${Math.floor(match.index / 800)}`;
    if (seenWindows.has(key)) continue;
    seenWindows.add(key);
    windows += 1;
    const fragment = decoded.slice(Math.max(0, match.index - 4500), Math.min(decoded.length, match.index + 5500));
    const image = extractImages(fragment)[0];
    if (!image) continue;
    const labelMatch = fragment.match(/(?:aria-label|title|data-title|data-value)\s*=\s*["']([^"']{1,120})["']/i);
    const labels = [];
    if (labelMatch?.[1]) labels.push(cleanText(labelMatch[1]));
    putCandidate(candidates, {
      key: userProductId,
      user_product_id: userProductId,
      name: labels[0] || userProductId,
      labels: labels.length ? labels : [userProductId],
      image_source_url: image,
      image_url: proxyImage(image)
    });
  }

  // A opção atualmente selecionada pode não ser um link. Usa og:image somente para o MLBU atual.
  if (!candidates.has(currentUserProductId)) {
    const metaImage = decoded.match(/<meta\b[^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]
      || decoded.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i)?.[1];
    const image = normalizeImage(metaImage);
    if (image) {
      putCandidate(candidates, {
        key: currentUserProductId,
        user_product_id: currentUserProductId,
        name: currentUserProductId,
        labels: [currentUserProductId],
        image_source_url: image,
        image_url: proxyImage(image)
      });
    }
  }

  return { variations: [...candidates.values()], anchors, windows };
}

function pageTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? cleanText(title) : null;
}

async function analyzeWithBrowserRun(listingUrl, env) {
  const { target, currentUserProductId } = parseTarget(listingUrl);
  if (!env.BROWSER?.quickAction) {
    throw new Error('Browser Run ainda não está disponível neste deploy.');
  }

  const rendered = await env.BROWSER.quickAction('content', {
    url: target.toString(),
    gotoOptions: { waitUntil: 'networkidle2' },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136 Safari/537.36'
  });

  if (!rendered.ok) {
    throw new Error(`Browser Run não conseguiu renderizar o anúncio (${rendered.status}).`);
  }

  const html = await rendered.text();
  const extracted = extractRenderedCandidates(html, currentUserProductId);
  if (!extracted.variations.length) {
    const mlbuCount = new Set((decodeMarkup(html).match(/MLBU\d+/gi) || []).map(id => id.toUpperCase())).size;
    throw new Error(
      `Browser Run abriu o anúncio, mas não encontrou miniaturas de variação. ` +
      `Diagnóstico: ${mlbuCount} MLBU no DOM renderizado, ${extracted.anchors} link(s) de picker e ${extracted.windows} bloco(s) analisados.`
    );
  }

  return {
    ok: true,
    platform: 'MERCADO LIVRE',
    listing_url: target.toString(),
    user_product_id: currentUserProductId,
    title: pageTitle(html),
    source: 'cloudflare-browser-run',
    variation_count: extracted.variations.length,
    variations: extracted.variations,
    diagnostics: {
      browser_run: true,
      picker_links: extracted.anchors,
      mlbu_windows: extracted.windows,
      detected_user_products: new Set((decodeMarkup(html).match(/MLBU\d+/gi) || []).map(id => id.toUpperCase())).size
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/mercadolivre-analyze' && request.method === 'POST') {
      const fallbackRequest = request.clone();
      try {
        const body = await request.json();
        return json(await analyzeWithBrowserRun(body?.url, env));
      } catch (browserError) {
        try {
          const fallbackResponse = await app.fetch(fallbackRequest, env, ctx);
          if (fallbackResponse.ok) return fallbackResponse;
          const fallbackPayload = await fallbackResponse.clone().json().catch(() => null);
          return json({
            error: `${browserError?.message || 'Falha no Browser Run'} ` +
              `Fallback anterior: ${fallbackPayload?.error || `HTTP ${fallbackResponse.status}`}`
          }, 400);
        } catch {
          return json({ error: browserError?.message || 'Falha ao analisar anúncio do Mercado Livre' }, 400);
        }
      }
    }

    return app.fetch(request, env, ctx);
  }
};
