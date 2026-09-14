import { BrowserMultiFormatReader } from '@zxing/browser';
import { isValidGtin13, normalizeGtin } from './gtin.js';

function acceptedGtin(value) {
  const normalized = normalizeGtin(value);
  return isValidGtin13(normalized) ? normalized : null;
}

async function nativeEan13Supported() {
  const Detector = globalThis?.BarcodeDetector;
  if (typeof Detector !== 'function') return false;

  if (typeof Detector.getSupportedFormats !== 'function') return true;
  try {
    const formats = await Detector.getSupportedFormats();
    return Array.isArray(formats) && formats.includes('ean_13');
  } catch {
    return false;
  }
}

async function imageElementFromFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
      });
    }
    return { image, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function detectWithNativeImage(file) {
  if (!(await nativeEan13Supported())) return null;

  const Detector = globalThis.BarcodeDetector;
  const detector = new Detector({ formats: ['ean_13'] });
  let bitmap = null;
  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    const detected = await detector.detect(bitmap);
    for (const barcode of detected || []) {
      const gtin = acceptedGtin(barcode?.rawValue);
      if (gtin) return gtin;
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close?.();
  }
}

async function detectWithZxingImage(file) {
  let prepared = null;
  try {
    prepared = await imageElementFromFile(file);
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageElement(prepared.image);
    return acceptedGtin(result?.getText?.());
  } catch {
    return null;
  } finally {
    if (prepared?.url) URL.revokeObjectURL(prepared.url);
  }
}

export async function detectGtinInImage(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return null;

  const native = await detectWithNativeImage(file);
  if (native) return native;
  return detectWithZxingImage(file);
}

async function startNativeVideoScanner(videoElement, onDetected) {
  if (!(await nativeEan13Supported())) return null;
  if (!navigator?.mediaDevices?.getUserMedia) return null;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } }
  });
  const detector = new globalThis.BarcodeDetector({ formats: ['ean_13'] });
  let stopped = false;
  let animationFrame = 0;
  let detecting = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    for (const track of stream.getTracks()) track.stop();
    if (videoElement.srcObject === stream) videoElement.srcObject = null;
  };

  videoElement.srcObject = stream;
  videoElement.muted = true;
  videoElement.playsInline = true;
  await videoElement.play();

  const tick = async () => {
    if (stopped) return;
    if (!detecting && videoElement.readyState >= 2) {
      detecting = true;
      try {
        const detected = await detector.detect(videoElement);
        for (const barcode of detected || []) {
          const gtin = acceptedGtin(barcode?.rawValue);
          if (gtin) {
            stop();
            onDetected(gtin);
            return;
          }
        }
      } catch {
        // Native detection can transiently fail while camera frames settle.
        // Keep scanning; hard camera failures are handled during setup.
      } finally {
        detecting = false;
      }
    }
    if (!stopped) animationFrame = requestAnimationFrame(tick);
  };

  animationFrame = requestAnimationFrame(tick);
  return { stop, engine: 'barcode-detector' };
}

async function startZxingVideoScanner(videoElement, onDetected) {
  const reader = new BrowserMultiFormatReader();
  let controls = null;
  controls = await reader.decodeFromConstraints(
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    videoElement,
    result => {
      const gtin = acceptedGtin(result?.getText?.());
      if (!gtin) return;
      controls?.stop?.();
      onDetected(gtin);
    }
  );
  return { stop: () => controls?.stop?.(), engine: 'zxing' };
}

export async function startGtinVideoScanner(videoElement, onDetected) {
  if (!videoElement) throw new Error('Elemento de vídeo ausente.');
  if (typeof onDetected !== 'function') throw new Error('Callback de GTIN ausente.');

  try {
    const native = await startNativeVideoScanner(videoElement, onDetected);
    if (native) return native;
  } catch {
    // Permission/device errors are retried through ZXing, which owns its own
    // getUserMedia lifecycle and remains the cross-browser fallback.
  }

  return startZxingVideoScanner(videoElement, onDetected);
}
