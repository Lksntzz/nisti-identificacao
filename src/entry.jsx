import React from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);

  if (window.location.pathname.startsWith('/admin')) {
    import('./main.jsx').then(mod => {
      const Component = mod.default || mod.AdminApp;
      root.render(<Component />);
    });
  } else {
    import('./public-main.jsx').then(mod => {
      const Component = mod.default || mod.PublicIdentificationApp;
      root.render(<Component />);
    });
  }
}
