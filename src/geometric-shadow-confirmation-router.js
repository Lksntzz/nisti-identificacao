import { Buffer } from 'node:buffer';
import { normalizePlatform } from './platform-scope.js';

const SHADOW_PURPOSE = 'geometric-shadow-evidence-v818';
const CONFIRMATION_VERSION = 'v8.19';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ''));
}

async function ticketKey(secret) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    textBytes(`nisti-local-vision:${secret}`)
  );
  return crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function verifyShadowTicket(env, token) {
  const secret = String(env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || '');
  if (!secret) return null;

  const [encoded, signature] = String(token || '').split('.', 2);
  if (!encoded || !signature) return null;

  try {
    const key = await ticketKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      new Uint8Array(Buffer.from(signature, 'base64url')),
      textBytes(encoded)
    );
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload?.purpose !== SHADOW_PURPOSE) return null;
    if (Number(payload?.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    if (!payload?.nonce || !normalizePlatform(payload?.platform)) return null;
    return payload;
  } catch {
    return null;
  }
}

function productionCodeFromEvidence(row) {
  try {
    return normalizeCode(JSON.parse(String(row?.evidence_json || '{}'))?.production?.capa_code);
  } catch {
    return '';
  }
}

export function validateOperatorCorrectConfirmation({ signedPayload, evidenceRow, capaCode } = {}) {
  const requestedCode = normalizeCode(capaCode);
  const signedPlatform = normalizePlatform(signedPayload?.platform);
  const storedPlatform = normalizePlatform(evidenceRow?.platform);
  const productionCode = productionCodeFromEvidence(evidenceRow);
  const existingCode = normalizeCode(evidenceRow?.confirmed_capa_code);

  if (!requestedCode) return { ok: false, status: 400, error: 'capa_code é obrigatório.' };
  if (!signedPayload?.nonce || !signedPlatform) {
    return { ok: false, status: 401, error: 'Shadow evidence ticket inválido.' };
  }
  if (!evidenceRow) return { ok: false, status: 404, error: 'Evidência shadow ainda não foi persistida.' };
  if (String(evidenceRow.evidence_token || '') !== String(signedPayload.nonce)) {
    return { ok: false, status: 401, error: 'Token de evidência não corresponde ao ticket.' };
  }
  if (!storedPlatform || storedPlatform !== signedPlatform) {
    return { ok: false, status: 409, error: 'Plataforma da evidência não corresponde ao ticket.' };
  }
  if (!productionCode || productionCode !== requestedCode) {
    return {
      ok: false,
      status: 409,
      error: 'A confirmação deve corresponder exatamente à capa exibida pela produção.'
    };
  }
  if (existingCode && existingCode !== requestedCode) {
    return {
      ok: false,
      status: 409,
      error: `A evidência já possui confirmação diferente (${existingCode}).`
    };
  }

  return {
    ok: true,
    requested_code: requestedCode,
    already_confirmed: existingCode === requestedCode
  };
}

export async function handleGeometricShadowConfirmationRequest(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/operator/geometric-shadow-evidence/confirm') {
    return null;
  }
  if (!env?.DB) return json({ error: 'D1 não configurado.' }, 503);

  const body = await request.json().catch(() => null);
  const signedPayload = await verifyShadowTicket(env, body?.shadow_ticket);
  if (!signedPayload) {
    return json({ error: 'Shadow evidence ticket inválido ou expirado.' }, 401);
  }

  const evidenceRow = await env.DB.prepare(`
    SELECT evidence_token, platform, evidence_json, confirmed_capa_code
    FROM geometric_shadow_evidence
    WHERE evidence_token=?
    LIMIT 1
  `).bind(String(signedPayload.nonce)).first();

  const validation = validateOperatorCorrectConfirmation({
    signedPayload,
    evidenceRow,
    capaCode: body?.capa_code
  });
  if (!validation.ok) return json({ ok: false, error: validation.error }, validation.status);

  if (!validation.already_confirmed) {
    await env.DB.prepare(`
      UPDATE geometric_shadow_evidence
      SET confirmed_capa_code=?,
          confirmation_source='operator_confirmed_production_result',
          confirmed_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE evidence_token=?
    `).bind(validation.requested_code, String(signedPayload.nonce)).run();
  }

  return json({
    ok: true,
    confirmed: true,
    already_confirmed: validation.already_confirmed,
    capa_code: validation.requested_code,
    confirmation_version: CONFIRMATION_VERSION,
    shadow_only: true,
    trained: false,
    production_changed: false
  });
}
