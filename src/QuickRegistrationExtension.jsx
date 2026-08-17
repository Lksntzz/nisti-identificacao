import React from 'react';
import { createRoot } from 'react-dom/client';
import QuickRegistration from './QuickRegistration.jsx';

const host = document.createElement('div');
host.id = 'quick-registration-extension';

const divider = document.createElement('div');
divider.className = 'migration-divider';
const dividerTitle = document.createElement('strong');
dividerTitle.textContent = 'Migração / manutenção';
const dividerText = document.createElement('span');
dividerText.textContent = 'As ferramentas abaixo ficam para catálogo antigo, revisão de imagens e exceções.';
divider.append(dividerTitle, dividerText);

createRoot(host).render(<QuickRegistration/>);

let placing = false;
function place() {
  if (placing) return;
  const adminPanel = document.querySelector('main.shell > section.panel');
  const shopee = adminPanel?.querySelector('.shopee-batch');

  if (!adminPanel || !shopee) {
    host.remove();
    divider.remove();
    return;
  }

  placing = true;
  if (shopee.previousElementSibling !== divider) {
    shopee.insertAdjacentElement('beforebegin', divider);
  }
  if (divider.previousElementSibling !== host) {
    divider.insertAdjacentElement('beforebegin', host);
  }
  queueMicrotask(() => { placing = false; });
}

const root = document.getElementById('root');
if (root) {
  const observer = new MutationObserver(place);
  observer.observe(root, { childList: true, subtree: true });
}

place();
