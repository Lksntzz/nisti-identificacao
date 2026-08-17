import app from './mercadolivre-network-router.js';

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function validMercadoUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br'));
  } catch {
    return false;
  }
}

function normalizeMlImage(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (host !== 'mlstatic.com' && !host.endsWith('.mlstatic.com')) return null;
    if (!/\/D_NQ_[A-Z0-9_-]+/i.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeText(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function captureLanding(capture) {
  const safeJson = JSON.stringify(capture)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NISTI · Captura recebida</title></head>
<body style="font-family:system-ui;padding:32px;max-width:720px;margin:auto">
  <h1>Captura do Mercado Livre recebida</h1>
  <p>${capture.images.length} imagem(ns) encontrada(s). Abrindo a administração do NISTI…</p>
  <script>
    sessionStorage.setItem('nisti_ml_capture', JSON.stringify(${safeJson}));
    location.replace('/admin');
  </script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/admin/ml-browser-capture' && request.method === 'POST') {
      try {
        const form = await request.formData();
        const sourceUrl = String(form.get('source_url') || '').trim();
        const pageTitle = safeText(form.get('page_title'), 220);
        const rawPayload = String(form.get('payload') || '[]');

        if (!validMercadoUrl(sourceUrl)) {
          return html('<h1>Captura inválida</h1><p>Execute o capturador dentro de um anúncio do Mercado Livre Brasil.</p>', 400);
        }
        if (rawPayload.length > 250000) {
          return html('<h1>Captura muito grande</h1><p>Reabra somente o seletor de variações do anúncio e execute o capturador NISTI novamente.</p>', 413);
        }

        const parsed = JSON.parse(rawPayload);
        const rows = Array.isArray(parsed) ? parsed : [];
        const images = [];
        const seen = new Set();

        for (const row of rows.slice(0, 180)) {
          const image = normalizeMlImage(row?.url || row?.src || row?.image);
          if (!image || seen.has(image)) continue;
          seen.add(image);
          images.push({
            url: image,
            text: safeText(row?.text || row?.label || row?.alt, 160),
            width: Number.isFinite(Number(row?.width)) ? Number(row.width) : null,
            height: Number.isFinite(Number(row?.height)) ? Number(row.height) : null
          });
        }

        if (!images.length) {
          return html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;max-width:720px;margin:auto"><h1>Nenhuma imagem de produto encontrada</h1><p>Volte ao anúncio, abra o seletor de variações para deixar as opções visíveis e execute o capturador NISTI novamente.</p></body></html>`, 400);
        }

        const capture = {
          source_url: sourceUrl,
          page_title: pageTitle,
          captured_at: new Date().toISOString(),
          images
        };
        return html(captureLanding(capture));
      } catch (error) {
        return html(`<h1>Falha na captura</h1><p>${safeText(error?.message || 'Dados inválidos')}</p>`, 400);
      }
    }

    return app.fetch(request, env, ctx);
  }
};
