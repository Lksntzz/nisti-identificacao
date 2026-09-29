import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isValidGtin13 } from './gtin.js';
import { decodeEan13LumaRow, imageDataToLumaRow } from './gtin-camera-decoder.js';
import './gtin-scanner.css';

const CAMERA_SCAN_INTERVAL_MS = 90;
const SAME_EAN_RELEASE_MS = 1800;
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

function normalizeProductTypeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function productTypeLabel(product) {
  const source = normalizeProductTypeText([
    product?.nome,
    product?.sku,
    product?.miolo_code
  ].filter(Boolean).join(' '));

  const types = [
    [/\bplanner\b/, 'Planner'],
    [/\bagenda\b/, 'Agenda'],
    [/\bcaderno\b|\bnotebook\b/, 'Caderno'],
    [/\bcaderneta\b/, 'Caderneta'],
    [/\bfichario\b/, 'Fichário'],
    [/\bbloco\b/, 'Bloco'],
    [/\bcalendario\b/, 'Calendário'],
    [/\bdiario\b/, 'Diário'],
    [/\bsketchbook\b/, 'Sketchbook'],
    [/\bbullet\s*journal\b/, 'Bullet Journal'],
    [/\balbum\b/, 'Álbum'],
    [/\blivro\b/, 'Livro'],
    [/\brefil\b/, 'Refil'],
    [/\borganizador\b/, 'Organizador'],
    [/\bpasta\b/, 'Pasta'],
    [/\bkit\b/, 'Kit']
  ];

  const match = types.find(([pattern]) => pattern.test(source));
  if (match) return match[1];

  const fallback = String(product?.nome || '').trim()
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')[0];

  return fallback
    ? fallback.charAt(0).toUpperCase() + fallback.slice(1).toLowerCase()
    : 'Produto';
}

function ProductDetailIcon({ type }) {
  const props = {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  };

  if (type === 'cover') {
    return <svg {...props}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 3v18" /><path d="m11 15 2.2-2.4 2 1.8 1.8-2.1" /></svg>;
  }
  if (type === 'variation') {
    return <svg {...props}><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></svg>;
  }
  if (type === 'wireo') {
    return <svg {...props}><path d="M8 4c-2 0-2 3 0 3s2 3 0 3-2 3 0 3 2 3 0 3-2 3 0 4" /><path d="M11 4h8v16h-8" /><path d="M11 8h5M11 12h5M11 16h5" /></svg>;
  }
  if (type === 'tassel') {
    return <svg {...props}><path d="M12 3v5" /><path d="M9 8h6l2 4H7l2-4Z" /><path d="M8 12v7M11 12v8M14 12v8M17 12v7" /></svg>;
  }
  return <svg {...props}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M15 3v18" /><path d="M15 8h4" /></svg>;
}

function ProductSummary({ gtin, product, continuous = false }) {
  if (!product) return null;

  const details = [
    { label: 'Wire-o', value: product.wireo || product.wireo_code, icon: 'wireo', priority: 'primary' },
    { label: 'Tassel', value: product.tassel || product.tassel_code, icon: 'tassel', priority: 'primary' },
    { label: 'Elástico', value: product.elastico || product.elastico_code, icon: 'elastic', priority: 'primary' },
    { label: 'Capa', value: product.capa_code, icon: 'cover', priority: 'secondary' },
    { label: 'Variação', value: product.variacao, icon: 'variation', priority: 'secondary' }
  ].filter(item => item.value);

  const productType = productTypeLabel(product);

  return (
    <article className={`gtin-scanner-result${continuous ? ' is-continuous' : ''}`} aria-live="polite">
      <div className="gtin-result-status">
        <div className="gtin-result-status-left">
          <div className="gtin-result-check" aria-hidden="true">✓</div>
          <span className="gtin-result-label">Produto identificado</span>
        </div>
        <strong className="gtin-result-status-ean">EAN: {gtin}</strong>
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
            <span className="gtin-result-type-label">Tipo do produto</span>
            <h3>{productType}</h3>
            <p className="gtin-result-sku">SKU {product.sku || '—'}</p>
          </div>

          <dl className="gtin-result-details">
            {details.map(item => (
              <div className={`gtin-result-detail ${item.priority === 'primary' ? 'is-priority' : 'is-secondary'}`} key={item.label}>
                <dt>
                  <span className="gtin-result-detail-icon"><ProductDetailIcon type={item.icon} /></span>
                  <span>{item.label}</span>
                </dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </article>
  );
}

function HistoryChevron({ up = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

function hasTasselLabel(product) {
  const value = String(product?.tassel || product?.tassel_code || '').trim().toUpperCase();
  return !value || value === 'X' || value.includes('SEM TASSEL') ? 'Não' : 'Sim';
}

function GtinHistory({ history, onOpen }) {
  return (
    <section className="gtin-history" aria-label="Histórico de resultados">
      <button
        type="button"
        className="gtin-history-trigger"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label="Abrir histórico de resultados"
      >
        <span className="gtin-history-title">
          <span className="gtin-history-icon"><HistoryIcon /></span>
          <span>
            <strong>Histórico de resultados</strong>
            <small>
              {history.length
                ? `${history.length} leitura${history.length === 1 ? '' : 's'} neste aparelho`
                : 'Nenhuma leitura neste aparelho'}
            </small>
          </span>
        </span>
        <span className="gtin-history-trigger-arrow"><HistoryChevron /></span>
      </button>
    </section>
  );
}

function GtinHistoryModal({ history, onClear, onClose }) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="gtin-history-modal-backdrop"
      role="presentation"
      onClick={event => event.target === event.currentTarget && onClose()}
    >
      <section
        className="gtin-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gtin-history-modal-title"
      >
        <header className="gtin-history-modal-header">
          <div className="gtin-history-modal-heading">
            <span className="gtin-history-modal-icon"><HistoryIcon /></span>
            <div>
              <h3 id="gtin-history-modal-title">Histórico de resultados</h3>
              <p>
                {history.length
                  ? `${history.length} leitura${history.length === 1 ? '' : 's'} neste aparelho`
                  : 'Nenhuma leitura neste aparelho'}
              </p>
            </div>
          </div>
          <div className="gtin-history-modal-actions">
            {history.length > 0 && (
              <button type="button" className="gtin-history-modal-clear" onClick={onClear}>Limpar</button>
            )}
            <button type="button" className="gtin-history-modal-close" onClick={onClose} aria-label="Fechar histórico">
              <CloseIcon />
            </button>
          </div>
        </header>

        {history.length === 0 ? (
          <div className="gtin-history-modal-empty">
            <BarcodeIcon size={24} />
            <span>Nenhum produto identificado ainda.</span>
          </div>
        ) : (
          <div className="gtin-history-modal-list">
            {history.map(item => (
              <article className="gtin-history-modal-item" key={item.id}>
                <div className="gtin-history-modal-thumb">
                  {item.product.image_url
                    ? <img src={item.product.image_url} alt="" />
                    : <BarcodeIcon size={22} />}
                </div>

                <div className="gtin-history-modal-product">
                  <span className="gtin-history-modal-label">SKU</span>
                  <strong>{item.product.sku || 'Sem SKU'}</strong>

                  <div className="gtin-history-modal-attributes">
                    <div>
                      <span>Tassel</span>
                      <strong>{hasTasselLabel(item.product)}</strong>
                    </div>
                    <div>
                      <span>Elástico</span>
                      <strong>{item.product.elastico || item.product.elastico_code || '—'}</strong>
                    </div>
                    <div>
                      <span>Wire-o</span>
                      <strong>{item.product.wireo || item.product.wireo_code || '—'}</strong>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>,
    document.body
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
  const [scannerPaused, setScannerPaused] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState('idle');
  const [history, setHistory] = useState(() => loadGtinHistory());
  const [historyOpen, setHistoryOpen] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const activeRef = useRef(false);
  const lookupBusyRef = useRef(false);
  const lastFrameRef = useRef(0);
  const animationRef = useRef(0);
  const feedbackTimeoutRef = useRef(null);
  const lastRejectedRef = useRef({ value: '', at: 0 });
  const acceptedGtinRef = useRef({ value: '', lastSeenAt: 0 });
  const autoStartAttemptedRef = useRef(false);
  const historyAutoPausedRef = useRef(false);

  const triggerHaptic = useCallback((pattern = [40, 30, 80]) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch {}
    }
  }, []);

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
    setScannerPaused(false);
    setCaptureFeedback('idle');
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
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
    setCaptureFeedback('captured');
    triggerHaptic([40, 30, 80]);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);

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
        setCaptureFeedback('error');
        feedbackTimeoutRef.current = setTimeout(() => setCaptureFeedback('idle'), 900);
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
      acceptedGtinRef.current = { value: gtin, lastSeenAt: Date.now() };
      if (options.recordHistory !== false) addToHistory(gtin, data.product);
      onProductResolved?.(data.product, gtin);
      setLookupError('');
      setCaptureFeedback('captured');
      triggerHaptic(80);
      feedbackTimeoutRef.current = setTimeout(() => setCaptureFeedback('idle'), 1100);
      return true;
    } catch {
      setCaptureFeedback('error');
      feedbackTimeoutRef.current = setTimeout(() => setCaptureFeedback('idle'), 900);
      setLookupError('Falha de conexão ao consultar o EAN.');
      return false;
    } finally {
      lookupBusyRef.current = false;
      setLookupBusy(false);
    }
  }, [addToHistory, onProductResolved, triggerHaptic]);

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
      if (value && isValidGtin13(value)) {
        const accepted = acceptedGtinRef.current;
        if (accepted.value === value) {
          accepted.lastSeenAt = Date.now();
        } else {
          await lookup(value);
        }
      } else {
        const accepted = acceptedGtinRef.current;
        if (accepted.value && Date.now() - accepted.lastSeenAt >= SAME_EAN_RELEASE_MS) {
          acceptedGtinRef.current = { value: '', lastSeenAt: 0 };
        }
      }
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
    setScannerPaused(false);
    acceptedGtinRef.current = { value: '', lastSeenAt: 0 };

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
        if (streamRef.current !== stream) return;
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
    setHistoryOpen(false);
    historyAutoPausedRef.current = false;
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

  const toggleScannerPaused = () => {
    if (scannerPaused) {
      activeRef.current = true;
      lastFrameRef.current = 0;
      animationRef.current = requestAnimationFrame(scanFrame);
      setScannerPaused(false);
      return;
    }

    activeRef.current = false;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    setScannerPaused(true);
  };

  const openHistory = () => {
    historyAutoPausedRef.current = Boolean(cameraActive && !scannerPaused);
    if (historyAutoPausedRef.current) {
      activeRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
      setScannerPaused(true);
    }
    setHistoryOpen(true);
  };

  const closeHistory = () => {
    setHistoryOpen(false);
    if (historyAutoPausedRef.current && cameraActive) {
      activeRef.current = true;
      lastFrameRef.current = 0;
      animationRef.current = requestAnimationFrame(scanFrame);
      setScannerPaused(false);
    }
    historyAutoPausedRef.current = false;
  };

  useEffect(() => {
    if (!embedded || typeof document === 'undefined') return undefined;

    const preventPinch = event => {
      if (event.touches && event.touches.length > 1) event.preventDefault();
    };
    const preventGesture = event => event.preventDefault();

    document.documentElement.classList.add('gtin-fixed-viewport');
    document.body.classList.add('gtin-fixed-viewport');
    document.addEventListener('touchmove', preventPinch, { passive: false });
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });

    return () => {
      document.documentElement.classList.remove('gtin-fixed-viewport');
      document.body.classList.remove('gtin-fixed-viewport');
      document.removeEventListener('touchmove', preventPinch);
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
    };
  }, [embedded]);

  useEffect(() => {
    if (!historyOpen || typeof document === 'undefined') return undefined;
    document.body.classList.add('gtin-history-modal-open');
    return () => document.body.classList.remove('gtin-history-modal-open');
  }, [historyOpen]);

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

      <div className={`gtin-camera-shell${lookupBusy ? ' is-looking-up' : ''}${scannerPaused ? ' is-paused' : ''}${captureFeedback === 'captured' ? ' is-captured' : ''}${captureFeedback === 'error' ? ' is-capture-error' : ''}`}>
        <video ref={videoRef} className="gtin-camera-video" muted autoPlay playsInline />
        <canvas ref={canvasRef} className="gtin-camera-canvas" aria-hidden="true" />
        <div className="gtin-camera-guide" aria-hidden="true">
          <span className="gtin-laser-corner top-left" />
          <span className="gtin-laser-corner top-right" />
          <span className="gtin-laser-corner bottom-left" />
          <span className="gtin-laser-corner bottom-right" />
        </div>
        {cameraActive && (
          <button type="button" className="gtin-camera-pause" onClick={toggleScannerPaused}>
            {scannerPaused ? 'Continuar leitura' : 'Pausar leitura'}
          </button>
        )}
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

        <div className="gtin-scanner-instructions">
          <span className="gtin-scanner-instructions-icon" aria-hidden="true">i</span>
          <strong>{product ? 'Produto identificado. Aponte para o próximo EAN.' : 'Centralize o código de barras dentro do quadro.'}</strong>
          <span>{scannerPaused ? 'A leitura está pausada.' : 'A leitura é automática.'}</span>
          {decoderMode && cameraActive && <small>Leitor: {decoderMode}</small>}
        </div>
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

      {product && (
        <>
          <ProductSummary gtin={lastGtin} product={product} continuous />
          {!embedded && (
            <div className="gtin-result-actions">
              <button type="button" className="gtin-done" onClick={closeScanner}>Concluir</button>
            </div>
          )}
        </>
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

      <GtinHistory history={history} onOpen={openHistory} />
      {historyOpen && <GtinHistoryModal history={history} onClear={clearHistory} onClose={closeHistory} />}
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








