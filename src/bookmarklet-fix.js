const isAdminMode = new URLSearchParams(window.location.search).get('nisti_admin') === '1';

function ensureCaptureModal() {
  let modal = document.getElementById('nisti-ml-local-capture-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'nisti-ml-local-capture-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="nisti-capture-backdrop" data-close-capture></div>
    <section class="nisti-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="nisti-capture-title">
      <button type="button" class="nisti-capture-close" data-close-capture aria-label="Fechar">×</button>
      <p class="eyebrow">MERCADO LIVRE · FALLBACK LOCAL</p>
      <h3 id="nisti-capture-title">Capturar variações no seu navegador</h3>
      <p class="nisti-capture-intro">Use somente quando a análise automática do Mercado Livre não conseguir trazer as variações. Não precisa entrar na conta da NISTI PRINT.</p>
      <ol>
        <li><strong>Abra o anúncio</strong> pelo botão do NISTI.</li>
        <li>Deixe visível a linha de opções, por exemplo <strong>Cor: CAPA 01</strong> e as miniaturas.</li>
        <li>Clique no ícone da extensão <strong>NISTI Capturar ML</strong> no Chrome.</li>
        <li>O capturador percorre as opções e devolve as variações para esta tela.</li>
        <li>Confira imagem, nome da variação e CAPA_CODE antes de cadastrar.</li>
      </ol>
      <div class="nisti-capture-note">O capturador só é necessário no computador administrativo. Os usuários do Painel Geral não instalam nada.</div>
      <button type="button" class="nisti-capture-ok" data-close-capture>Entendi</button>
    </section>`;

  const style = document.createElement('style');
  style.textContent = `
    #nisti-ml-local-capture-modal[hidden]{display:none!important}
    #nisti-ml-local-capture-modal{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px}
    .nisti-capture-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.58);backdrop-filter:blur(4px)}
    .nisti-capture-dialog{position:relative;width:min(560px,100%);max-height:min(760px,90vh);overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:22px;padding:26px;box-shadow:0 26px 80px rgba(15,23,42,.28);color:#111827}
    .nisti-capture-dialog h3{margin:4px 0 10px;font-size:25px;letter-spacing:-.02em}.nisti-capture-intro{margin:0 0 18px;color:#64748b;line-height:1.55}
    .nisti-capture-dialog ol{display:grid;gap:10px;margin:0;padding-left:22px;color:#334155;line-height:1.5}.nisti-capture-note{margin-top:18px;padding:12px 14px;border-radius:12px;background:#eff6ff;color:#1e3a8a;font-size:13px;font-weight:700;line-height:1.45}
    .nisti-capture-close{position:absolute;right:14px;top:12px;border:0;background:transparent;color:#64748b;font-size:28px;line-height:1;cursor:pointer}.nisti-capture-ok{width:100%;margin-top:18px;border:0;border-radius:12px;padding:13px 16px;background:#111827;color:#fff;font-weight:900;cursor:pointer}
  `;
  document.head.appendChild(style);
  document.body.appendChild(modal);

  modal.addEventListener('click', event => {
    if (event.target.closest('[data-close-capture]')) modal.hidden = true;
  });

  return modal;
}

function openCaptureModal() {
  const modal = ensureCaptureModal();
  modal.hidden = false;
}

function rewriteMercadoLivreUi() {
  if (!isAdminMode) return;

  for (const tools of document.querySelectorAll('.qr-ml-tools')) {
    const strong = tools.querySelector('strong');
    const span = tools.querySelector('span');
    const anchor = tools.querySelector('a');
    const button = tools.querySelector('button');

    if (strong && strong.textContent !== 'Mercado Livre · automático + captura local') {
      strong.textContent = 'Mercado Livre · automático + captura local';
    }
    if (span && span.textContent !== 'O NISTI tenta automaticamente primeiro. Se o Mercado Livre bloquear, use o Capturador NISTI instalado somente neste computador administrativo.') {
      span.textContent = 'O NISTI tenta automaticamente primeiro. Se o Mercado Livre bloquear, use o Capturador NISTI instalado somente neste computador administrativo.';
    }
    if (anchor && anchor.textContent !== 'Abrir anúncio para captura') {
      anchor.textContent = 'Abrir anúncio para captura';
    }
    if (button && button.textContent !== 'Como usar a captura local') {
      button.textContent = 'Como usar a captura local';
      button.dataset.nistiLocalCapture = '1';
    }
  }

  for (const button of document.querySelectorAll('.mercadolivre-batch button')) {
    if (/copiar capturador ml/i.test(button.textContent || '')) {
      button.textContent = 'Como usar a captura local';
      button.dataset.nistiLocalCapture = '1';
    }
  }

  for (const message of document.querySelectorAll('.qr-message, .quick-message, p.message')) {
    const text = message.textContent || '';
    if (/Preparar captura ML|favorito NISTI|capturador copiado|salve.*favorito/i.test(text)) {
      message.textContent = 'O Mercado Livre não liberou as variações automaticamente. Abra o anúncio, deixe as opções de capa visíveis e use a extensão NISTI Capturar ML neste computador. A captura volta para o Cadastro Rápido automaticamente.';
    }
  }
}

if (isAdminMode) {
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;

    const isLocalButton = button.dataset.nistiLocalCapture === '1' ||
      /preparar captura ml|copiar capturador ml|como usar a captura local/i.test(button.textContent || '');

    if (!isLocalButton) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openCaptureModal();
  }, true);

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      rewriteMercadoLivreUi();
    });
  };

  const root = document.getElementById('root');
  if (root) {
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
  }

  rewriteMercadoLivreUi();
}
