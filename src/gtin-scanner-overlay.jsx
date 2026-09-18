import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isValidGtin13 } from './gtin.js';
import { decodeEan13LumaRow, imageDataToLumaRow } from './gtin-camera-decoder.js';
import './gtin-scanner.css';

const CAMERA_SCAN_INTERVAL_MS = 120;
const NOT_FOUND_COOLDOWN_MS = 1200;

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

function ProductSummary({ gtin, product }) {
  if (!product) return null;

  const productDetails = [
    ['Capa', product.capa_code],
    ['Variação', product.variacao]
  ].filter(([, value]) => value);

  const finishDetails = [
    ['Wire-o', product.wireo || product.wireo_code],
    ['Tassel', product.tassel || product.tassel_code],
    ['Elástico', product.elastico || product.elastico_code]
  ].filter(([, value]) => value);

  return (
    <div className="gtin-scanner-result">
      <div className="gtin-result-status">
        <div className="gtin-result-check" aria-hidden="true">✓</div>
        <div>
          <span className="gtin-result-label">Produto identificado</span>
          <strong className="gtin-result-code">EAN {gtin}</strong>
        </div>
      </div>

      <div className="gtin-result-content">
        {product.image_url && (
          <div className="gtin-result-image-frame">
            <img className="gtin-result-image" src={product.image_url} alt={product.sku || gtin} />
          </div>
        )}

        <div className="gtin-result-copy">
          <h3>{product.nome || product.sku}</h3>
          {product.nome && <p className="gtin-result-sku">SKU {product.sku}</p>}

          <dl className="gtin-result-details">
            {productDetails.map(([label, value]) => (
              <div className="gtin-result-detail" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="gtin-result-finishes-block">
            <span className="gtin-result-section-label">Acabamentos</span>
            <dl className="gtin-result-finishes">
              {finishDetails.map(([label, value]) => (
                <div className="gtin-result-finish" key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
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

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const activeRef = useRef(false);
  const lookupBusyRef = useRef(false);
  const lastFrameRef = useRef(0);
  const animationRef = useRef(0);
  const lastRejectedRef = useRef({ value: '', at: 0 });

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

  const lookup = useCallback(async rawValue => {
    const gtin = String(rawValue || '').replace(/\D/g, '');
    if (!isValidGtin13(gtin) || lookupBusyRef.current) return false;

    const rejected = lastRejectedRef.current;
    if (rejected.value === gtin && Date.now() - rejected.at < NOT_FOUND_COOLDOWN_MS) return false;

    lookupBusyRef.current = true;
    setLookupBusy(true);
    setLookupError('');
    setManualValue(gtin);

    try {
      const response = await fetch(`/api/gtin/${encodeURIComponent(gtin)}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' }
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
  }, [onProductResolved, stopCamera]);

  const fallbackDetect = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

    const targetWidth = Math.min(720, video.videoWidth);
    const targetHeight = Math.max(1, Math.round(targetWidth * video.videoHeight / video.videoWidth));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, 0, 0, targetWidth, targetHeight);

    const rowRatios = [0.50, 0.46, 0.54, 0.42, 0.58];
    for (const ratio of rowRatios) {
      const y = Math.max(0, Math.min(targetHeight - 1, Math.round(targetHeight * ratio)));
      const row = context.getImageData(0, y, targetWidth, 1);
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
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      streamRef.current = stream;

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
                <div className="gtin-camera-shell">
                  <video ref={videoRef} className="gtin-camera-video" muted autoPlay playsInline />
                  <canvas ref={canvasRef} className="gtin-camera-canvas" aria-hidden="true" />
                  <div className="gtin-camera-guide" aria-hidden="true" />
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
                  <div className="gtin-scanner-alert error">
                    <span>{cameraError}</span>
                    <button type="button" onClick={startCamera}>Tentar câmera novamente</button>
                  </div>
                )}

                {lookupError && <div className="gtin-scanner-alert error">{lookupError}</div>}
                {lookupBusy && <div className="gtin-scanner-alert working">Consultando EAN no catálogo…</div>}

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
                    <button type="submit" disabled={lookupBusy}>Consultar</button>
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
