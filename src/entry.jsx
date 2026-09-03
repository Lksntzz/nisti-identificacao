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
