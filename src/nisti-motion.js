// Anel de clique do painel administrativo: só reage a cliques, nunca roda sozinho.
const TARGET = 'button,[role="button"],[role="tab"],.sidebar-nav-item';
const AREA = '.admin-page-content,.admin-sidebar';

export function installClickRing(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || doc.__nistiClickRing) return;
  doc.__nistiClickRing = true;
  doc.addEventListener('click', event => {
    const el = event.target?.closest?.(TARGET);
    if (!el || el.disabled || !el.closest(AREA)) return;
    if (doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.remove('nm-click-ring');
    void el.offsetWidth;
    el.classList.add('nm-click-ring');
    el.addEventListener('animationend', () => el.classList.remove('nm-click-ring'), { once: true });
  }, true);
}

installClickRing();
