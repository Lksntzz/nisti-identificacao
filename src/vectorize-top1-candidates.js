import { Buffer } from 'node:buffer';
import { buildVectorizeCandidates } from './vectorize-candidates.js';

const VERIFICATION_COVER_LIMIT = 1;

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
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
    ['sign']
  );
}

function decodeTicketPayload(ticket) {
  const [encoded] = String(ticket || '').split('.', 1);
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function signTicket(env, payload) {
  const secret = String(
    env.TICKET_SECRET || env.ADMIN_PASSWORD || env.GEMINI_API_KEY || ''
  );
  if (!secret) throw new Error('Chave de segurança para tickets não configurada');

  const encoded = base64url(textBytes(JSON.stringify(payload)));
  const key = await ticketKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, textBytes(encoded))
  );
  return `${encoded}.${base64url(signature)}`;
}

export function restrictTicketPayloadToTop1(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const sourceCodes = Array.isArray(payload.codes) ? payload.codes : [];
  const topCode = String(sourceCodes[0] || '').trim().toUpperCase();
  if (!topCode) return null;

  const sourceScores = payload.scores && typeof payload.scores === 'object'
    ? payload.scores
    : {};
  const sourceReferences = Array.isArray(payload.references)
    ? payload.references
    : [];

  return {
    ...payload,
    codes: [topCode].slice(0, VERIFICATION_COVER_LIMIT),
    scores: {
      [topCode]: Number(sourceScores[topCode] ?? 0)
    },
    references: sourceReferences.filter(
      item => String(item?.capa_code || '').trim().toUpperCase() === topCode
    )
  };
}

export async function buildVectorizeTop1Candidates(request, env) {
  const response = await buildVectorizeCandidates(request, env);
  if (!response?.ok) return response;

  const data = await response.clone().json().catch(() => null);
  if (!data?.ticket) return response;

  const sourcePayload = decodeTicketPayload(data.ticket);
  const top1Payload = restrictTicketPayloadToTop1(sourcePayload);
  if (!top1Payload?.codes?.length) return response;

  const topCode = top1Payload.codes[0];
  const ticket = await signTicket(env, top1Payload);
  const candidates = (Array.isArray(data.candidates) ? data.candidates : [])
    .filter(item => String(item?.capa_code || '').trim().toUpperCase() === topCode)
    .slice(0, 1);

  const performance = {
    ...(data.performance || {}),
    verification_strategy: 'vectorize-top1-binary',
    verification_cover_limit: VERIFICATION_COVER_LIMIT,
    verification_candidate_count: candidates.length
  };

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(JSON.stringify({
    ...data,
    ticket,
    candidates,
    performance
  }), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
