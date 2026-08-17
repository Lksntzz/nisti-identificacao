import puppeteer from '@cloudflare/puppeteer';
import app from './mercadolivre-browser-router.js';

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
  try {
    target = new URL(value);
  } catch {
    throw new Error('Link do Mercado Livre inválido');
  }

  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' || (host !== 'mercadolivre.com.br' && !host.endsWith('.mercadolivre.com.br'))) {
    throw new Error('Use um link HTTPS do Mercado Livre Brasil');
  }

  return target;
}

function normalizeMlImage(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text.startsWith('//') ? `https:${text}` : text);
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

async function shortWait(ms = 700) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function clickExpectedVariation(page, expected) {
  const target = normalizeLabel(expected);
  if (!target) return { found: false, expected };

  const attempt = async () => page.evaluate((targetLabel) => {
    const normalize = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none';
    };

    const nodes = Array.from(document.querySelectorAll(
      'button,a,label,[role="button"],[role="option"],[role="radio"],li,div,span,img'
    ));

    const scored = [];
    for (const el of nodes) {
      if (!visible(el)) continue;
      const values = [
        el.innerText,
        el.textContent,
        el.getAttribute('aria-label'),
        el.getAttribute('title'),
        el.getAttribute('alt'),
        el.getAttribute('data-title'),
        el.getAttribute('data-value')
      ].map(normalize).filter(Boolean);

      let score = -1;
      for (const value of values) {
        if (value === targetLabel) score = Math.max(score, 100);
        else if (value.includes(targetLabel) && value.length <= targetLabel.length + 24) score = Math.max(score, 65);
      }
      if (score < 0) continue;

      const clickable = el.closest('button,a,label,[role="button"],[role="option"],[role="radio"]') || el;
      if (clickable !== el) score += 15;
      const href = clickable.getAttribute?.('href') || '';
      if (/\/up\/MLBU\d+/i.test(href)) score += 20;
      const rect = clickable.getBoundingClientRect();
      if (rect.width < 500 && rect.height < 180) score += 5;
      scored.push({ el, clickable, score, text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim(), href });
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) return { found: false };

    best.clickable.scrollIntoView({ block: 'center', inline: 'center' });
    best.clickable.click();
    return {
      found: true,
      score: best.score,
      text: best.text,
      href: best.href || null,
      tag: best.clickable.tagName
    };
  }, target);

  let result = await attempt();
  if (result?.found) return { ...result, expected };

  // Alguns anúncios escondem as opções atrás de um seletor. Abrimos somente controles
  // claramente relacionados a modelo/cor/variação e tentamos novamente.
  await page.evaluate(() => {
    const normalize = value => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    const controls = Array.from(document.querySelectorAll('button,[role="button"],[aria-haspopup="listbox"]'));
    const opener = controls.find(el => {
      const text = normalize(`${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`);
      return /(VARIA|MODELO|COR|ESTAMPA|CAPA|ESCOLH|SELECION)/.test(text);
    });
    opener?.click();
  });
  await shortWait(350);
  result = await attempt();
  return { ...(result || { found: false }), expected };
}

async function readMainProductImage(page) {
  const raw = await page.evaluate(() => {
    const candidates = [];
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 30 && rect.height > 30 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    for (const img of document.querySelectorAll('img')) {
      if (!visible(img)) continue;
      const rect = img.getBoundingClientRect();
      const sources = [
        img.getAttribute('data-zoom'),
        img.getAttribute('data-src'),
        img.currentSrc,
        img.src,
        img.getAttribute('srcset')?.split(',').pop()?.trim().split(/\s+/)[0]
      ].filter(Boolean);
      const source = sources.find(value => /mlstatic\.com\/D_NQ_/i.test(value));
      if (!source) continue;

      let score = rect.width * rect.height;
      const context = `${img.className || ''} ${img.parentElement?.className || ''} ${img.closest('figure')?.className || ''}`.toLowerCase();
      if (/(gallery|figure|carousel|picture|image)/.test(context)) score += 250000;
      if (rect.width >= 250 && rect.height >= 250) score += 500000;
      if (rect.width < 120 || rect.height < 120) score -= 250000;
      candidates.push({ source, score, width: rect.width, height: rect.height, alt: img.alt || '' });
    }

    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0]) return candidates[0];

    const meta = document.querySelector('meta[property="og:image"],meta[name="og:image"]');
    return meta?.content ? { source: meta.content, score: 0, width: 0, height: 0, alt: 'og:image' } : null;
  });

  if (!raw?.source) return null;
  const source = normalizeMlImage(raw.source);
  return source ? { ...raw, source } : null;
}

async function analyzeByClicking(listingUrl, expectedVariations, env) {
  const target = parseTarget(listingUrl);
  const expected = [...new Set((expectedVariations || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!expected.length) throw new Error('Nenhuma variação do catálogo foi enviada para o analisador do Mercado Livre.');

  let browser;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 900 });
    await page.goto(target.toString(), { waitUntil: 'networkidle2', timeout: 30000 });

    // Fecha avisos comuns sem interagir com compra/carrinho.
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find(el => /^(ACEITAR|ENTENDI|CONTINUAR)$/i.test((el.innerText || '').trim()));
      button?.click();
    });
    await shortWait(400);

    const variations = [];
    const diagnostics = [];

    for (let index = 0; index < expected.length; index++) {
      const label = expected[index];
      const clicked = await clickExpectedVariation(page, label);
      if (!clicked.found) {
        diagnostics.push({ label, found: false });
        continue;
      }

      try {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 3500 });
      } catch {
        await shortWait(900);
      }

      const image = await readMainProductImage(page);
      const currentUrl = page.url();
      const currentMlbu = currentUrl.match(/\/up\/(MLBU\d+)/i)?.[1]?.toUpperCase() || null;
      diagnostics.push({
        label,
        found: true,
        clicked_text: clicked.text || null,
        clicked_href: clicked.href || null,
        current_mlbu: currentMlbu,
        image: image?.source || null
      });

      if (!image?.source) continue;
      variations.push({
        key: currentMlbu || `click-${index}-${normalizeLabel(label)}`,
        user_product_id: currentMlbu,
        name: label,
        labels: [label],
        image_source_url: image.source,
        image_url: proxyImage(image.source)
      });
    }

    const deduped = [];
    const seenKeys = new Set();
    for (const variation of variations) {
      const key = `${normalizeLabel(variation.name)}|${variation.image_source_url}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      deduped.push(variation);
    }

    const uniqueImages = new Set(deduped.map(item => item.image_source_url)).size;
    if (!deduped.length) {
      throw new Error(`Puppeteer abriu o anúncio, mas não conseguiu clicar nas opções esperadas (${expected.join(', ')}).`);
    }
    if (expected.length > 1 && uniqueImages <= 1) {
      throw new Error(
        `Puppeteer encontrou ${deduped.length} opção(ões), mas todas apontaram para a mesma imagem. ` +
        `Não vou associar automaticamente porque isso pode misturar os SKUs.`
      );
    }

    return {
      ok: true,
      platform: 'MERCADO LIVRE',
      listing_url: target.toString(),
      title: await page.title(),
      source: 'cloudflare-puppeteer-click',
      variation_count: deduped.length,
      variations: deduped,
      diagnostics: {
        browser_run: true,
        expected: expected.length,
        found: deduped.length,
        unique_images: uniqueImages,
        clicks: diagnostics
      }
    };
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
        return json(await analyzeByClicking(body?.url, body?.expected_variations, env));
      } catch (puppeteerError) {
        try {
          const fallback = await app.fetch(fallbackRequest, env, ctx);
          if (fallback.ok) return fallback;
          const payload = await fallback.clone().json().catch(() => ({}));
          return json({
            error: `${puppeteerError?.message || 'Puppeteer falhou.'} Fallback anterior: ${payload?.error || `HTTP ${fallback.status}`}`
          }, 400);
        } catch (fallbackError) {
          return json({
            error: `${puppeteerError?.message || 'Puppeteer falhou.'} Fallback anterior: ${fallbackError?.message || 'falhou também.'}`
          }, 400);
        }
      }
    }

    return app.fetch(request, env, ctx);
  }
};
