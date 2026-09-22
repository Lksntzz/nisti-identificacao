import React, { useEffect, useMemo, useState } from 'react';
import {
  AMBIGUOUS_READY_EVENT,
  AMBIGUOUS_STATE_EVENT
} from './shadow-confirmation-client.js';

function operatorHeaders() {
  let operatorId = 'op_guest';
  let operatorName = '';
  try {
    operatorId = localStorage.getItem('nisti_shipping_user_id') || 'op_guest';
    operatorName = localStorage.getItem('nisti_operator_name') || '';
  } catch {}
  return {
    'content-type': 'application/json',
    'x-user-id': operatorId,
    ...(operatorName ? { 'x-operator-name': encodeURIComponent(operatorName) } : {})
  };
}

async function responseJson(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null;
  return response.json().catch(() => null);
}

function CandidateImage({ candidate }) {
  if (!candidate?.image_url) {
    return (
      <div style={{
        width: '68px',
        height: '88px',
        borderRadius: '9px',
        background: '#f1f5f9',
        display: 'grid',
        placeItems: 'center',
        color: '#94a3b8',
        fontSize: '9px',
        textAlign: 'center',
        padding: '4px'
      }}>
        Sem imagem
      </div>
    );
  }

  return (
    <img
      src={candidate.image_url}
      alt={`Capa ${candidate.capa_code}`}
      style={{
        width: '68px',
        height: '88px',
        borderRadius: '9px',
        objectFit: 'cover',
        border: '1px solid #e2e8f0',
        background: '#f8fafc'
      }}
    />
  );
}

function ProductImage({ product }) {
  if (!product?.image_url) return null;
  return (
    <img
      src={product.image_url}
      alt={product.sku || 'Produto'}
      style={{
        width: '54px',
        height: '70px',
        borderRadius: '8px',
        objectFit: 'cover',
        border: '1px solid #e2e8f0'
      }}
    />
  );
}

export default function AmbiguousReviewPrompt() {
  const [review, setReview] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);

  useEffect(() => {
    const onReady = event => {
      const detail = event?.detail || {};
      const candidates = Array.isArray(detail.candidates) ? detail.candidates : [];
      if (!detail.occurrence_id || !detail.review_token || candidates.length < 2) return;
      setReview({
        occurrenceId: Number(detail.occurrence_id),
        reviewToken: String(detail.review_token),
        platform: String(detail.platform || '').trim().toUpperCase(),
        candidates,
        originalError: detail.original_error || ''
      });
      setStatus('idle');
      setError('');
      setResolved(null);
      setSelectedProduct(null);
    };

    const onState = event => {
      const detail = event?.detail || {};
      if (detail.status === 'error' && !review) {
        setError(detail.error || 'Falha ao preparar revisão humana.');
      }
    };

    window.addEventListener(AMBIGUOUS_READY_EVENT, onReady);
    window.addEventListener(AMBIGUOUS_STATE_EVENT, onState);
    return () => {
      window.removeEventListener(AMBIGUOUS_READY_EVENT, onReady);
      window.removeEventListener(AMBIGUOUS_STATE_EVENT, onState);
    };
  }, [review]);

  const orderedCandidates = useMemo(() => {
    return [...(review?.candidates || [])]
      .sort((a, b) => Number(a.candidate_rank || 999) - Number(b.candidate_rank || 999))
      .slice(0, 5);
  }, [review]);

  if (!review) return null;

  const chooseCandidate = async candidate => {
    if (status === 'confirming' || resolved) return;
    try {
      setStatus('confirming');
      setError('');
      const response = await fetch('/api/operator/ambiguous-review/confirm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: operatorHeaders(),
        body: JSON.stringify({
          occurrence_id: review.occurrenceId,
          review_token: review.reviewToken,
          capa_code: candidate.capa_code
        })
      });
      const data = await responseJson(response);
      if (!response.ok || !data?.ok || !data?.confirmed) {
        throw new Error(data?.error || `Falha ao confirmar capa (${response.status}).`);
      }
      setResolved(data);
      setSelectedProduct(data.product || null);
      setStatus('confirmed');
    } catch (err) {
      setStatus('error');
      setError(err?.message || 'Falha ao confirmar a capa.');
    }
  };

  const keepForAdmin = () => {
    setStatus('none');
    setResolved(null);
    setSelectedProduct(null);
    setError('');
  };

  const newConsultation = () => {
    window.location.reload();
  };

  const products = Array.isArray(resolved?.products) ? resolved.products : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Revisão de capas semelhantes"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: 'rgba(15,23,42,.48)',
        display: 'grid',
        placeItems: 'center',
        padding: '16px'
      }}
    >
      <section style={{
        width: 'min(560px, 100%)',
        maxHeight: 'min(760px, calc(100vh - 32px))',
        overflowY: 'auto',
        background: '#fff',
        borderRadius: '18px',
        boxShadow: '0 24px 60px rgba(15,23,42,.28)',
        border: '1px solid #dbeafe',
        padding: '14px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 900, color: '#4f46e5', letterSpacing: '.06em', textTransform: 'uppercase' }}>
              Revisão supervisionada
            </div>
            <h3 style={{ margin: '3px 0 2px', fontSize: '17px', color: '#0f172a' }}>
              Qual destas capas é a correta?
            </h3>
            <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.45, color: '#64748b' }}>
              O reconhecimento automático recusou o Top-1 por ambiguidade. Sua escolha será validada no servidor e usada como treinamento supervisionado.
            </p>
          </div>
          <span style={{
            flex: '0 0 auto',
            fontSize: '9px',
            fontWeight: 800,
            color: '#475569',
            background: '#f1f5f9',
            borderRadius: '999px',
            padding: '5px 7px'
          }}>
            {review.platform}
          </span>
        </div>

        {status === 'none' ? (
          <div style={{ marginTop: '14px', padding: '14px', borderRadius: '12px', background: '#fff7ed', border: '1px solid #fed7aa' }}>
            <strong style={{ fontSize: '12px', color: '#9a3412' }}>Nenhuma candidata foi escolhida.</strong>
            <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#9a3412', lineHeight: 1.45 }}>
              A ocorrência #{review.occurrenceId} permanece pendente para análise no ADM. Nenhum treinamento foi executado.
            </p>
          </div>
        ) : resolved ? (
          <div style={{ marginTop: '14px' }}>
            <div style={{ padding: '12px', borderRadius: '12px', background: '#ecfdf5', border: '1px solid #86efac' }}>
              <strong style={{ fontSize: '12px', color: '#166534' }}>
                ✓ Capa {resolved.capa_code} confirmada e treinada
              </strong>
              <p style={{ margin: '3px 0 0', fontSize: '10.5px', color: '#166534' }}>
                A ocorrência #{review.occurrenceId} virou ground truth supervisionado. Nenhum threshold foi reduzido.
              </p>
            </div>

            {products.length > 1 && !selectedProduct && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: '#334155', marginBottom: '6px' }}>
                  Esta capa possui mais de um SKU. Escolha a variação:
                </div>
                <div style={{ display: 'grid', gap: '7px' }}>
                  {products.map(product => (
                    <button
                      key={product.id || product.sku}
                      type="button"
                      onClick={() => setSelectedProduct(product)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '9px',
                        width: '100%',
                        textAlign: 'left',
                        border: '1px solid #cbd5e1',
                        borderRadius: '11px',
                        background: '#fff',
                        padding: '8px',
                        cursor: 'pointer'
                      }}
                    >
                      <ProductImage product={product} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 900, color: '#0f172a', overflowWrap: 'anywhere' }}>{product.sku}</div>
                        <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                          {product.nome || product.variacao || `Capa ${product.capa_code}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedProduct && (
              <div style={{
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                border: '1px solid #dbeafe',
                borderRadius: '11px',
                background: '#f8fafc'
              }}>
                <ProductImage product={selectedProduct} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748b' }}>Produto resolvido</div>
                  <div style={{ fontSize: '14px', fontWeight: 900, color: '#0f172a', overflowWrap: 'anywhere' }}>{selectedProduct.sku}</div>
                  <div style={{ fontSize: '10.5px', color: '#334155', marginTop: '2px' }}>Capa: {selectedProduct.capa_code}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: '8px', marginTop: '12px' }}>
              {orderedCandidates.map(candidate => {
                const score = Math.round(Number(candidate.retrieval_score || 0) * 1000) / 10;
                return (
                  <button
                    key={`${candidate.capa_code}-${candidate.reference_id || candidate.candidate_rank}`}
                    type="button"
                    disabled={status === 'confirming'}
                    onClick={() => chooseCandidate(candidate)}
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: '12px',
                      background: '#fff',
                      padding: '8px 6px',
                      display: 'grid',
                      justifyItems: 'center',
                      gap: '4px',
                      cursor: status === 'confirming' ? 'wait' : 'pointer',
                      opacity: status === 'confirming' ? 0.65 : 1
                    }}
                  >
                    <CandidateImage candidate={candidate} />
                    <strong style={{ fontSize: '12px', color: '#0f172a' }}>{candidate.capa_code}</strong>
                    <span style={{ fontSize: '9px', color: '#64748b' }}>#{candidate.candidate_rank} · {score}%</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={keepForAdmin}
              disabled={status === 'confirming'}
              style={{
                width: '100%',
                marginTop: '9px',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                background: '#fff',
                color: '#475569',
                padding: '9px 10px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: status === 'confirming' ? 'wait' : 'pointer'
              }}
            >
              Nenhuma destas capas
            </button>
          </>
        )}

        {status === 'confirming' && (
          <div style={{ marginTop: '8px', fontSize: '10.5px', color: '#4f46e5', fontWeight: 800 }}>
            Confirmando e registrando treinamento supervisionado…
          </div>
        )}
        {error && (
          <div style={{ marginTop: '8px', fontSize: '10.5px', color: '#b91c1c', fontWeight: 800 }}>
            {error}
          </div>
        )}

        {(status === 'none' || (resolved && (selectedProduct || products.length <= 1))) && (
          <button
            type="button"
            onClick={newConsultation}
            style={{
              width: '100%',
              marginTop: '11px',
              border: 0,
              borderRadius: '10px',
              background: '#2563eb',
              color: '#fff',
              padding: '10px 12px',
              fontSize: '11px',
              fontWeight: 900,
              cursor: 'pointer'
            }}
          >
            Nova consulta
          </button>
        )}
      </section>
    </div>
  );
}
