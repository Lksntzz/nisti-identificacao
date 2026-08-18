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

  const draftJson = JSON.stringify({
    link: capture.source_url,
    title: capture.page_title || '',
    common: {}
  })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>NISTI · Captura recebida</title>
  <style>
    *{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;background:#f3f4f6;color:#111827;min-height:100vh;display:grid;place-items:center;padding:20px}
    main{width:min(520px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:28px;box-shadow:0 18px 50px rgba(17,24,39,.10)}
    .brand{font-size:11px;font-weight:900;letter-spacing:.16em;color:#6b7280;margin:0 0 8px}h1{font-size:27px;margin:0 0 8px}p{color:#4b5563;line-height:1.55;margin:0}.ok{margin-top:18px;padding:12px 14px;border-radius:12px;background:#ecfdf5;color:#065f46;font-weight:800}
  </style>
</head>
<body>
  <main>
    <p class="brand">NISTI PRINT</p>
    <h1>Variações recebidas</h1>
    <p>O capturador local encontrou as opções deste anúncio do Mercado Livre.</p>
    <div class="ok">${capture.images.length} variação(ões) recebida(s). Abrindo o cadastro rápido…</div>
  </main>
  <script>
    sessionStorage.setItem('nisti_ml_capture', JSON.stringify(${safeJson}));
    sessionStorage.setItem('nisti_quick_registration_draft', JSON.stringify(${draftJson}));
    setTimeout(() => location.replace('/admin'), 450);
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
          return html('<h1>Captura inválida</h1><p>Execute o Capturador NISTI dentro de um anúncio do Mercado Livre Brasil.</p>', 400);
        }
        if (rawPayload.length > 250000) {
          return html('<h1>Captura muito grande</h1><p>Deixe somente o seletor de variações do anúncio visível e execute o Capturador NISTI novamente.</p>', 413);
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
          return html(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:32px;max-width:720px;margin:auto"><h1>Nenhuma variação encontrada</h1><p>Volte ao anúncio, deixe as opções de capa visíveis e execute o Capturador NISTI novamente.</p></body></html>`, 400);
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
