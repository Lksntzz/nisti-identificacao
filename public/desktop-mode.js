(() => {
  const params = new URLSearchParams(window.location.search);
  const isAdmin = window.location.pathname.startsWith('/admin');
  if (!isAdmin || params.get('desktop') !== '1') return;
  const viewport = document.getElementById('nisti-viewport');
  if (!viewport) return;
  const screenWidth = Math.max(320, Math.min(Number(window.screen?.width) || 390, 600));
  const scale = Math.max(0.22, Math.min(1, screenWidth / 1440));
  viewport.setAttribute(
    'content',
    `width=1440,initial-scale=${scale.toFixed(3)},minimum-scale=${Math.max(0.18, scale * 0.8).toFixed(3)},maximum-scale=3,user-scalable=yes,viewport-fit=cover`
  );
  document.documentElement.dataset.nistiDesktopPreview = '1';
})();
