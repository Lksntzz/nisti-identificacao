// GA-019 — identificação de pedidos para contar PEDIDOS ÚNICOS entre arquivos (sem guardar o número real).
//
// O navegador envia o número do pedido (por dia) ao Worker por HTTPS; o Worker calcula
//   chave = HMAC-SHA256(segredo, "nisti-order-v2|PLATAFORMA|número")  (primeiros 32 hex = 128 bits)
// e só a chave segue para o banco. O número real não é gravado, devolvido nem escrito em log.
// O segredo (COMMERCE_ORDER_KEY_SECRET) existe só como "secret" do Worker na Cloudflare: nunca no navegador nem no repositório.
// Sem o segredo, quem vazar o banco não consegue conferir se um número de pedido está lá (um hash simples permitiria).
// Usa o HMAC síncrono do Node (nodejs_compat): ~3 µs por pedido, cabe no limite de CPU do plano gratuito.
import { createHmac } from 'node:crypto';

export const ORDER_KEY_VERSION = 'nisti-order-v2';
export const ORDER_REF_MAX_BATCH = 500;
const PLATFORMS = new Set(['SHOPEE', 'ML_NOVO', 'ML_ANTIGO']);

export class OrderKeySecretError extends Error {
  constructor(message = 'Chave de identificação de pedidos não configurada no servidor.') {
    super(message);
    this.name = 'OrderKeySecretError';
    this.technicalCode = 'order_key_secret_missing';
  }
}

export function orderKeySecret(env) {
  const secret = String(env?.COMMERCE_ORDER_KEY_SECRET || '');
  if (secret.length < 32) throw new OrderKeySecretError();
  return secret;
}

export function orderKeyHex(secret, platformCode, orderId) {
  return createHmac('sha256', secret)
    .update(`${ORDER_KEY_VERSION}|${platformCode}|${String(orderId).trim()}`)
    .digest('hex')
    .slice(0, 32);
}

/** refs: [{ d: 'YYYY-MM-DD', o: número do pedido }] -> [{ d, k }] sem repetição por dia, em ordem. */
export function hashOrderRefs(secret, platformCode, refs) {
  if (!PLATFORMS.has(platformCode)) throw new Error('Plataforma inválida para identificar pedidos.');
  if (!Array.isArray(refs)) throw new Error('Referências de pedidos inválidas.');
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const day = String(ref?.d ?? '');
    const order = String(ref?.o ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !order || order.length > 64) {
      throw new Error('Referência de pedido inválida (data ou número).');
    }
    const key = orderKeyHex(secret, platformCode, order);
    const id = `${day}|${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ d: day, k: key });
  }
  return out.sort((a, b) => a.d.localeCompare(b.d) || a.k.localeCompare(b.k));
}
