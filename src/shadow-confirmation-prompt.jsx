import React, { useEffect, useState } from 'react';
import { READY_EVENT, STATE_EVENT } from './shadow-confirmation-client.js';

export default function ShadowConfirmationPrompt() {
  const [current, setCurrent] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const onReady = event => {
      const detail = event?.detail || {};
      if (!detail.capa_code || !detail.platform) return;
      setCurrent({ capaCode: detail.capa_code, platform: detail.platform });
      setStatus('idle');
      setError('');
    };

    const onState = event => {
      const detail = event?.detail || {};
      if (detail.status === 'confirmed') {
        setStatus('confirmed');
        setError('');
      } else if (detail.status === 'confirming') {
        setStatus('confirming');
        setError('');
      } else if (detail.status === 'error') {
        setStatus('error');
        setError(detail.error || 'Falha ao confirmar a capa.');
      }
    };

    window.addEventListener(READY_EVENT, onReady);
    window.addEventListener(STATE_EVENT, onState);
    return () => {
      window.removeEventListener(READY_EVENT, onReady);
      window.removeEventListener(STATE_EVENT, onState);
    };
  }, []);

  if (!current) return null;

  const confirmCorrect = async () => {
    if (status === 'confirming' || status === 'confirmed') return;
    try {
      setStatus('confirming');
      setError('');
      const confirmFn = window.__NISTI_CONFIRM_SHADOW_RESULT__;
      if (typeof confirmFn !== 'function') throw new Error('Confirmação shadow indisponível.');
      await confirmFn({ capaCode: current.capaCode, platform: current.platform });
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Falha ao confirmar a capa.');
    }
  };

  return (
    <aside
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: '18px',
        transform: 'translateX(-50%)',
        zIndex: 80,
        width: 'min(520px, calc(100vw - 28px))',
        background: '#ffffff',
        border: '1px solid #dbeafe',
        borderRadius: '14px',
        boxShadow: '0 14px 38px rgba(15,23,42,.18)',
        padding: '11px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '11px', color: '#475569', fontWeight: 700 }}>
          Validação do reconhecimento
        </div>
        <div style={{ fontSize: '12px', color: '#0f172a', marginTop: '2px' }}>
          A capa mostrada <strong>{current.capaCode}</strong> está correta?
        </div>
        <div style={{ fontSize: '9.5px', color: '#64748b', marginTop: '2px' }}>
          Confirma apenas a evidência shadow. Não treina o sistema e não altera SKU.
        </div>
        {error && (
          <div style={{ fontSize: '10px', color: '#b91c1c', marginTop: '3px', fontWeight: 700 }}>
            {error}
          </div>
        )}
      </div>

      {status === 'confirmed' ? (
        <span style={{ fontSize: '11px', fontWeight: 800, color: '#15803d', whiteSpace: 'nowrap' }}>
          ✓ Confirmada
        </span>
      ) : (
        <button
          type="button"
          onClick={confirmCorrect}
          disabled={status === 'confirming'}
          style={{
            border: 0,
            borderRadius: '10px',
            padding: '9px 12px',
            fontSize: '11px',
            fontWeight: 800,
            cursor: status === 'confirming' ? 'wait' : 'pointer',
            background: '#16a34a',
            color: '#fff',
            whiteSpace: 'nowrap',
            opacity: status === 'confirming' ? 0.7 : 1
          }}
        >
          {status === 'confirming' ? 'Confirmando…' : '✓ Capa correta'}
        </button>
      )}
    </aside>
  );
}
