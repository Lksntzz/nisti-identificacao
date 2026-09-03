import React from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  const pathname = window.location.pathname;

  if (pathname === '/admin/shadow-observability') {
    import('./geometric-shadow-observability.jsx').then(mod => {
      const Component = mod.default;
      root.render(<Component />);
    });
  } else if (pathname.startsWith('/admin')) {
    import('./main.jsx').then(mod => {
      const Component = mod.default || mod.AdminApp;
      root.render(<Component />);
    });
  } else {
    Promise.all([
      import('./public-main.jsx'),
      import('./shadow-confirmation-client.js'),
      import('./shadow-confirmation-prompt.jsx')
    ]).then(([publicMod, _clientMod, promptMod]) => {
      const Component = publicMod.default || publicMod.PublicIdentificationApp;
      const ShadowConfirmationPrompt = promptMod.default;
      root.render(
        <>
          <Component />
          <ShadowConfirmationPrompt />
        </>
      );
    });
  }
}
