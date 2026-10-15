import React, { useEffect, useState } from 'react';
import './app.css';
import './mural-standalone.css';
import LOGO from './assets/logo.png';
import MuralNisti from './mural-nisti.jsx';

// The dedicated Mural hostname never mounts the Scanner or admin interface.
export default function MuralStandaloneApp() {
  const [access, setAccess] = useState('loading');

  useEffect(() => {
    document.title = 'Mural NISTI · Novidades e coleções';
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute('content', 'Mural NISTI');

    let active = true;
    fetch('/api/mural/access', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Falha ao verificar o Mural');
        return response.json();
      })
      .then(payload => { if (active) setAccess(payload?.released ? 'ready' : 'unavailable'); })
      .catch(() => { if (active) setAccess('error'); });
    return () => { active = false; };
  }, []);

  return (
    <main className="app general mural-viewport mural-standalone">
      <header className="brand-topbar mural-standalone-header">
        <div className="brand-identity">
          <img className="brand-icon-mark" src={LOGO} alt="NISTI PRINT" />
          <div className="brand-titles">
            <strong className="brand-main-title">NISTI PRINT</strong>
            <span className="brand-subtext">Central de novidades</span>
          </div>
        </div>
        <span className="mural-standalone-channel">MURAL</span>
      </header>
      {access === 'ready' ? (
        <MuralNisti />
      ) : (
        <section className="mural-standalone-status" role="status">
          <h1>Mural NISTI</h1>
          <p>{access === 'loading'
            ? 'Carregando publicações…'
            : access === 'unavailable'
              ? 'O Mural não está disponível no momento.'
              : 'Não foi possível conectar ao Mural. Atualize a página para tentar novamente.'}</p>
          {access !== 'loading' && (
            <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button>
          )}
        </section>
      )}
    </main>
  );
}
