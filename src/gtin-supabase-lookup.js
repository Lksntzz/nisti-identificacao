import { ACCESSORY_COLORS, WIREO_COLORS } from './sku.js';

const SUPABASE_FUNCTION_URL = 'https://yioetdcbgorunwgwuawg.supabase.co/functions/v1/gtin-lookup';
const DEFAULT_TIMEOUT_MS = 2400;

export class DirectGtinLookupError extends Error {
  constructor(message, { status = 0, code = 'direct_gtin_lookup_error' } = {}) {
    super(message);
    this.name = 'DirectGtinLookupError';
    this.status = Number(status || 0);
    this.code = code;
  }
}

function timeoutMs(value) {
  const parsed = Number(value || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(500, Math.min(5000, Math.round(parsed)));
}

export function normalizeGtinProduct(product) {
  if (!product) return product;

  const wireoCode = String(product.wireo_code || '').trim().toUpperCase();
  const tasselCode = String(product.tassel_code || '').trim().toUpperCase();
  const elasticoCode = String(product.elastico_code || '').trim().toUpperCase();

  return {
    ...product,
    wireo: product.wireo || WIREO_COLORS[wireoCode] || wireoCode || '',
    tassel: product.tassel || (
      tasselCode === 'X'
        ? 'Sem tassel'
        : ACCESSORY_COLORS[tasselCode] || tasselCode || ''
    ),
    elastico: product.elastico || ACCESSORY_COLORS[elasticoCode] || elasticoCode || ''
  };
}

export async function lookupGtinDirect(gtin, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const normalized = String(gtin || '').trim();
  if (!/^\d{13}$/.test(normalized)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('gtin-direct-timeout'), timeoutMs(timeout));

  try {
    const response = await fetch(
      `${SUPABASE_FUNCTION_URL}?gtin=${encodeURIComponent(normalized)}`,
      {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { accept: 'application/json' }
      }
    );

    const payload = await response.json().catch(() => null);
    if (response.status === 404) return null;

    if (!response.ok || !payload?.product) {
      throw new DirectGtinLookupError(
        payload?.error || `Consulta direta de EAN falhou (${response.status}).`,
        {
          status: response.status,
          code: payload?.technical_error || `supabase_gtin_${response.status}`
        }
      );
    }

    return {
      gtin: normalized,
      product: normalizeGtinProduct(payload.product)
    };
  } catch (error) {
    if (error instanceof DirectGtinLookupError) throw error;
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new DirectGtinLookupError('Consulta direta de EAN excedeu o tempo limite.', {
        status: 408,
        code: 'supabase_gtin_timeout'
      });
    }
    throw new DirectGtinLookupError('Falha de conexão com a base direta de EAN.', {
      status: 0,
      code: 'supabase_gtin_transport'
    });
  } finally {
    clearTimeout(timer);
  }
}
