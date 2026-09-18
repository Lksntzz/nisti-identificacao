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
    Promise.all([
      import('./public-main.jsx'),
      import('./shadow-confirmation-client.js'),
      import('./shadow-confirmation-prompt.jsx'),
      import('./gtin-scanner-overlay.jsx')
    ]).then(([publicMod, _clientMod, promptMod, scannerMod]) => {
      const Component = publicMod.default || publicMod.PublicIdentificationApp;
      const ShadowConfirmationPrompt = promptMod.default;
      const GtinScannerOverlay = scannerMod.default;
      root.render(
        <>
          <Component />
          <ShadowConfirmationPrompt />
          <GtinScannerOverlay />
        </>
      );
    });
  }
}
