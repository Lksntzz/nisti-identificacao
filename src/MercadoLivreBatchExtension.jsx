import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MercadoLivreBatch from './MercadoLivreBatch.jsx';
import './mercadolivre.css';

const isAdminArea = /^\/admin(?:\/|$)/i.test(window.location.pathname);

if (isAdminArea) {
  const host = document.createElement('div');
  host.id = 'mercadolivre-batch-extension';
  host.className = 'adm-extension-slot';

  function Extension() {
    const [products, setProducts] = useState([]);

    const refresh = async () => {
      const response = await fetch('/api/products');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar produtos');
      setProducts(data.products || []);
    };

    const refreshIndex = async () => {
      const response = await fetch('/api/admin/cover-index');
      if (!response.ok) throw new Error('Falha ao atualizar índice visual');
      return response.json();
    };

    useEffect(() => {
      refresh().catch(() => {});
    }, []);

    return <MercadoLivreBatch
      products={products}
      onRefresh={refresh}
      onRefreshIndex={refreshIndex}
    />;
  }

  createRoot(host).render(<Extension/>);

  let scheduled = false;
  function placeExtension() {
    scheduled = false;
    const shopeeSection = document.querySelector('.shopee-batch');
    if (!shopeeSection?.parentElement) {
      if (host.isConnected) host.remove();
      return;
    }

    if (shopeeSection.nextElementSibling !== host) {
      shopeeSection.insertAdjacentElement('afterend', host);
    }
  }

  function schedulePlace() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(placeExtension);
  }

  const appRoot = document.getElementById('root');
  if (appRoot) {
    const observer = new MutationObserver(schedulePlace);
    observer.observe(appRoot, { childList: true, subtree: true });
  }

  schedulePlace();
}
