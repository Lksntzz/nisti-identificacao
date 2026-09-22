import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isValidGtin13 } from './gtin.js';
import { decodeEan13LumaRow, imageDataToLumaRow } from './gtin-camera-decoder.js';
import './gtin-scanner.css';

const CAMERA_SCAN_INTERVAL_MS = 90;
const NOT_FOUND_COOLDOWN_MS = 1200;
const GTIN_HISTORY_STORAGE_KEY = 'nisti_gtin_scan_history_v1';
const GTIN_HISTORY_LIMIT = 20;
function scannerOperatorContext() {
  try {
    return {
      operatorName: localStorage.getItem('nisti_operator_name') || '',
      operatorId: localStorage.getItem('nisti_shipping_user_id') || ''
    };
  } catch {
    return { operatorName: '', operatorId: '' };
  }
}

async function improveCameraTrack(track) {
  if (!track?.getCapabilities || !track?.applyConstraints) return;

  let capabilities;
  try { capabilities = track.getCapabilities(); } catch { return; }

  const preferredModes = [
    ['focusMode', 'continuous'],
    ['exposureMode', 'continuous'],
    ['whiteBalanceMode', 'continuous']
  ];

  for (const [name, value] of preferredModes) {
    if (!Array.isArray(capabilities?.[name]) || !capabilities[name].includes(value)) continue;
    try { await track.applyConstraints({ advanced: [{ [name]: value }] }); } catch {}
  }
}

function BarcodeIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" />
      <path d="M8 5v14M15 5v14M19 5v14" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function loadGtinHistory() {
  try {
    const raw = localStorage.getItem(GTIN_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && /^\d{13}$/.test(String(item.gtin || '')) && item.product)
      .slice(0, GTIN_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistGtinHistory(history) {
  try {
    localStorage.setItem(GTIN_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, GTIN_HISTORY_LIMIT)));
  } catch {}
}

function historyEntry(gtin, product) {
  return {
    id: `${Date.now()}-${gtin}`,
    gtin,
    scanned_at: new Date().toISOString(),
    product: {
      id: product?.id || null,
      sku: product?.sku || '',
      nome: product?.nome || '',
      variacao: product?.variacao || '',
      capa_code: product?.capa_code || '',
      wireo: product?.wireo || product?.wireo_code || '',
      tassel: product?.tassel || product?.tassel_code || '',
      elastico: product?.elastico || product?.elastico_code || '',
      image_url: product?.image_url || ''
    }
  };
}

function formatHistoryTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function ProductSummary({ gtin, product }) {
  if (!product) return null;

  const details = [
    ['Capa', product.capa_code],
    ['Variação', product.variacao],
    ['Wire-o', product.wireo || product.wireo_code],
    ['Tassel', product.tassel || product.tassel_code],
    ['Elástico', product.elastico || product.elastico_code]
  ].filter(([, value]) => value);

  return (
    <article className="gtin-scanner-result">
      <div className="gtin-result-status">
        <div className="gtin-result-check" aria-hidden="true">✓</div>
        <div className="gtin-result-status-copy">
          <span className="gtin-result-label">Produto identificado</span>
          <strong className="gtin-result-code">EAN {gtin}</strong>
        </div>
      </div>

      <div className="gtin-result-content">
        {product.image_url && (
          <div className="gtin-result-image-frame">
            <span className="gtin-result-image-label">Capa do produto</span>
            <img className="gtin-result-image" src={product.image_url} alt={product.sku || gtin} />
          </div>
        )}

        <div className="gtin-result-copy">
          <div className="gtin-result-heading">
            <h3>{product.nome || product.sku}</h3>
            {product.nome && <p className="gtin-result-sku">SKU {product.sku}</p>}
          </div>

          <dl className="gtin-result-details">
            {details.map(([label, value]) => (
              <div className="gtin-result-detail" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </article>
  );
}

function GtinHistory({ history, onSelect, onClear }) {
  return (
    <section className="gtin-history" aria-label="Histórico de resultados">
      <div className="gtin-history-header">
        <div className="gtin-history-title">
          <span className="gtin-history-icon"><HistoryIcon /></span>
          <div>
            <h3>Histórico de resultados</h3>
            <p>{history.length ? `${history.length} leitura${history.length === 1 ? '' : 's'} neste aparelho` : 'As leituras recentes aparecerão aqui.'}</p>
          </div>
        </div>
        {history.length > 0 && (
          <button type="button" className="gtin-history-clear" onClick={onClear}>Limpar</button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="gtin-history-empty">
          <BarcodeIcon size={20} />
          <span>Nenhum EAN identificado ainda.</span>
        </div>
      ) : (
        <div className="gtin-history-list">
          {history.map(item => (
            <button
              type="button"
              className="gtin-history-item"
              key={item.id}
              onClick={() => onSelect(item.gtin)}
              aria-label={`Abrir novamente o EAN ${item.gtin}`}
            >
              <span className="gtin-history-thumb">
                {item.product.image_url
                  ? <img src={item.product.image_url} alt="" />
                  : <BarcodeIcon size={20} />}
              </span>
              <span className="gtin-history-copy">
                <strong>{item.product.nome || item.product.sku || `EAN ${item.gtin}`}</strong>
                <span>{item.product.sku ? `SKU ${item.product.sku}` : 'Produto identificado'}</span>
                <small>EAN {item.gtin}</small>
              </span>
              <span className="gtin-history-time">{formatHistoryTimestamp(item.scanned_at)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function GtinScannerOverlay({ embedded = false, onProductResolved }) {
  const [open, setOpen] = useState(embedded);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [lastGtin, setLastGtin] = useState('');
  const [product, setProduct] = useState(null);
  const [decoderMode, setDecoderMode] = useState('');
  const [history, setHistory] = useState(() => loadGtinHistory());

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const activeRef = useRef(false);
  const lookupBusyRef = useRef(false);
  const lastFrameRef = useRef(0);
  const animationRef = useRef(0);
  const lastRejectedRef = useRef({ value: '', at: 0 });
  const autoStartAttemptedRef = useRef(false);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    detectorRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const addToHistory = useCallback((gtin, resolvedProduct) => {
    const entry = historyEntry(gtin, resolvedProduct);
    setHistory(previous => {
      const next = [entry, ...previous].slice(0, GTIN_HISTORY_LIMIT);
      persistGtinHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    if (typeof window !== 'undefined' && !window.confirm('Limpar o histórico de EAN deste aparelho?')) return;
    setHistory([]);
    try { localStorage.removeItem(GTIN_HISTORY_STORAGE_KEY); } catch {}
  }, []);

  const lookup = useCallback(async (rawValue, options = {}) => {
    const gtin = String(rawValue || '').replace(/\D/g, '');
    if (!isValidGtin13(gtin) || lookupBusyRef.current) return false;

    const rejected = lastRejectedRef.current;
    if (rejected.value === gtin && Date.now() - rejected.at < NOT_FOUND_COOLDOWN_MS) return false;

    lookupBusyRef.current = true;
    setLookupBusy(true);
    setLookupError('');
    setManualValue(gtin);

    try {
      const { operatorName, operatorId } = scannerOperatorContext();
      const response = await fetch(`/api/gtin/${encodeURIComponent(gtin)}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          ...(operatorName ? { 'x-operator-name': encodeURIComponent(operatorName) } : {}),
          ...(operatorId ? { 'x-user-id': operatorId } : {})
        }
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.product) {
        if (response.status === 404) {
          lastRejectedRef.current = { value: gtin, at: Date.now() };
          setLookupError(`EAN ${gtin} não está cadastrado no sistema.`);
          return false;
        }
        setLookupError(data?.error || 'Não foi possível consultar este EAN.');
        return false;
      }

      setLastGtin(gtin);
      setProduct(data.product);
      if (options.recordHistory !== false) addToHistory(gtin, data.product);
      onProductResolved?.(data.product, gtin);
      setLookupError('');
      stopCamera();
      if (navigator.vibrate) navigator.vibrate(80);
      return true;
    } catch {
      setLookupError('Falha de conexão ao consultar o EAN.');
      return false;
    } finally {
      lookupBusyRef.current = false;
      setLookupBusy(false);
    }
  }, [addToHistory, onProductResolved, stopCamera]);

  const fallbackDetect = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

    const sourceX = Math.round(video.videoWidth * 0.06);
    const sourceY = Math.round(video.videoHeight * 0.27);
    const sourceWidth = Math.max(1, Math.round(video.videoWidth * 0.88));
    const sourceHeight = Math.max(1, Math.round(video.videoHeight * 0.46));
    const targetWidth = Math.min(1280, sourceWidth);
    const targetHeight = Math.max(1, Math.round(targetWidth * sourceHeight / sourceWidth));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(
      video,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, targetWidth, targetHeight
    );

    const rowRatios = [0.50, 0.46, 0.54, 0.42, 0.58, 0.38, 0.62, 0.34, 0.66, 0.30, 0.70];
    const bandHeight = Math.max(1, Math.min(5, Math.round(targetHeight * 0.012)));
    for (const ratio of rowRatios) {
      const centerY = Math.round(targetHeight * ratio);
      const y = Math.max(0, Math.min(targetHeight - bandHeight, centerY - Math.floor(bandHeight / 2)));
      const row = context.getImageData(0, y, targetWidth, bandHeight);
      const luma = imageDataToLumaRow(row);
      const decoded = luma ? decodeEan13LumaRow(luma) : null;
      if (decoded) return decoded;
    }
    return null;
  }, []);

  const scanFrame = useCallback(async timestamp => {
    if (!activeRef.current) return;

    if (timestamp - lastFrameRef.current >= CAMERA_SCAN_INTERVAL_MS && !lookupBusyRef.current) {
      lastFrameRef.current = timestamp;
      let value = null;

      try {
        const detector = detectorRef.current;
        if (detector && videoRef.current?.readyState >= 2) {
          const detections = await detector.detect(videoRef.current);
          const candidate = detections.find(item => /^\d{13}$/.test(String(item.rawValue || '')));
          if (candidate?.rawValue) value = String(candidate.rawValue);
        }
      } catch {
        detectorRef.current = null;
        setDecoderMode('compatibilidade');
      }

      if (!value) value = fallbackDetect();
      if (value && isValidGtin13(value)) await lookup(value);
    }

    if (activeRef.current) animationRef.current = requestAnimationFrame(scanFrame);
  }, [fallbackDetect, lookup]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setProduct(null);
    setLastGtin('');
    setLookupError('');
    setCameraError('');
    setDecoderMode('compatibilidade');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador não disponibiliza acesso à câmera. Use a leitura manual abaixo.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        }
      });
      streamRef.current = stream;

      const [videoTrack] = stream.getVideoTracks();
      await improveCameraTrack(videoTrack);
      const video = videoRef.current;
      if (!video) {
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        return;
      }

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();

      if ('BarcodeDetector' in window) {
        try {
          const supported = typeof window.BarcodeDetector.getSupportedFormats === 'function'
            ? await window.BarcodeDetector.getSupportedFormats()
            : ['ean_13'];
          if (supported.includes('ean_13')) {
            detectorRef.current = new window.BarcodeDetector({ formats: ['ean_13'] });
            setDecoderMode('nativo + compatibilidade');
          }
        } catch {
          detectorRef.current = null;
        }
      }

      activeRef.current = true;
      videoTrack?.addEventListener?.('ended', () => {
        if (!activeRef.current) return;
        activeRef.current = false;
        setCameraActive(false);
        setCameraError('A câmera foi interrompida. Toque para ativar novamente.');
      }, { once: true });
      lastFrameRef.current = 0;
      setCameraActive(true);
      animationRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setCameraError(denied
        ? 'A câmera está bloqueada. Libere a permissão do navegador e tente novamente.'
        : 'Não foi possível iniciar a câmera deste aparelho.');
      stopCamera();
    }
  }, [scanFrame, stopCamera]);

  useEffect(() => {
    if (!embedded || autoStartAttemptedRef.current) return;
    autoStartAttemptedRef.current = true;
    startCamera();
  }, [embedded, startCamera]);

  const openScanner = useCallback(() => {
    setOpen(true);
    setTimeout(() => startCamera(), 0);
  }, [startCamera]);

  const closeScanner = useCallback(() => {
    stopCamera();
    setOpen(false);
    setCameraError('');
    setLookupError('');
    setProduct(null);
    setLastGtin('');
  }, [stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const submitManual = event => {
    event?.preventDefault?.();
    const normalized = manualValue.replace(/\D/g, '');
    if (!isValidGtin13(normalized)) {
      setLookupError('Digite um EAN-13 válido com 13 dígitos.');
      return;
    }
    lookup(normalized);
  };

  const readAnother = () => {
    setProduct(null);
    setLastGtin('');
    setManualValue('');
    setLookupError('');
    startCamera();
  };

  const reopenHistoryItem = gtin => {
    setProduct(null);
    setLookupError('');
    lookup(gtin, { recordHistory: false });
  };

  const scannerPanel = (
    <div className={`gtin-scanner-panel${embedded ? ' embedded' : ''}`}>
      <header className="gtin-scanner-header">
        <div className="gtin-scanner-heading">
          <span className="gtin-scanner-header-icon"><BarcodeIcon size={24} /></span>
          <div>
            <span className="gtin-scanner-eyebrow">NISTI PRINT</span>
            <h2>Scanner de EAN</h2>
            <p>Identifique a capa pelo código de barras.</p>
          </div>
        </div>
        {!embedded && (
          <button type="button" className="gtin-scanner-close" onClick={closeScanner} aria-label="Fechar scanner">
            <CloseIcon />
          </button>
        )}
      </header>

      {!product && (
        <>
          <div className={`gtin-camera-shell${cameraActive ? ' is-active' : ''}${lookupBusy ? ' is-looking-up' : ''}`}>
            <video ref={videoRef} className="gtin-camera-video" muted autoPlay playsInline />
            <canvas ref={canvasRef} className="gtin-camera-canvas" aria-hidden="true" />
            <div className="gtin-camera-guide" aria-hidden="true">
              {cameraActive && <span className="gtin-camera-scan-beam" />}
            </div>
            {!cameraActive && !cameraError && (
              <div className="gtin-camera-loading">
                <CameraIcon />
                {embedded ? (
                  <button type="button" className="gtin-camera-start" onClick={startCamera}>Abrir câmera</button>
                ) : (
                  <span>Abrindo câmera…</span>
                )}
              </div>
            )}
          </div>

          <div className="gtin-scanner-instructions">
            <strong>Centralize o código de barras dentro do quadro.</strong>
            <span>A leitura é automática. Mantenha o EAN na horizontal e com boa iluminação.</span>
            {decoderMode && cameraActive && <small>Leitor: {decoderMode}</small>}
          </div>

          {cameraError && (
            <div className="gtin-scanner-alert error" role="alert">
              <span>{cameraError}</span>
              <button type="button" onClick={startCamera}>Tentar câmera novamente</button>
            </div>
          )}

          {lookupError && <div className="gtin-scanner-alert error" role="alert">{lookupError}</div>}
          {lookupBusy && (
            <div className="gtin-scanner-alert working" role="status" aria-live="polite">
              <span className="gtin-loading-spinner" aria-hidden="true" />
              <span>Consultando EAN no catálogo…</span>
            </div>
          )}

          <form className="gtin-manual-form" onSubmit={submitManual}>
            <label htmlFor="gtin-manual-input">Leitor físico ou digitação manual</label>
            <div className="gtin-manual-row">
              <input
                id="gtin-manual-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={13}
                value={manualValue}
                onChange={event => setManualValue(event.target.value.replace(/\D/g, '').slice(0, 13))}
                placeholder="7898764980000"
              />
              <button type="submit" disabled={lookupBusy}>
                {lookupBusy && <span className="gtin-button-spinner" aria-hidden="true" />}
                <span>{lookupBusy ? 'Consultando…' : 'Consultar'}</span>
              </button>
            </div>
          </form>
        </>
      )}

      {product && (
        <>
          <ProductSummary gtin={lastGtin} product={product} />
          <div className="gtin-result-actions">
            <button type="button" className="gtin-read-another" onClick={readAnother}>Ler outro EAN</button>
            {!embedded && <button type="button" className="gtin-done" onClick={closeScanner}>Concluir</button>}
          </div>
        </>
      )}

      <GtinHistory history={history} onSelect={reopenHistoryItem} onClear={clearHistory} />
    </div>
  );

  if (embedded) {
    return (
      <section className="gtin-scanner-inline" aria-label="Scanner de código de barras">
        {scannerPanel}
      </section>
    );
  }

  return (
    <>
      <button type="button" className="gtin-scanner-fab" onClick={openScanner} aria-label="Abrir scanner de EAN">
        <BarcodeIcon />
        <span>Scanner EAN</span>
      </button>

      {open && (
        <div className="gtin-scanner-backdrop" role="dialog" aria-modal="true" aria-label="Scanner de código de barras">
          {scannerPanel}
        </div>
      )}
    </>
  );
}













