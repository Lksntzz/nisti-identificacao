import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperatorCorrectConfirmation } from '../src/geometric-shadow-confirmation-router.js';

function signedPayload(overrides = {}) {
  return {
    purpose: 'geometric-shadow-evidence-v818',
    nonce: 'evidence-1',
    platform: 'SHOPEE',
    ...overrides
  };
}

function evidenceRow(overrides = {}) {
  return {
    evidence_token: 'evidence-1',
    platform: 'SHOPEE',
    evidence_json: JSON.stringify({
      production: {
        capa_code: 'LTE1'
      }
    }),
    confirmed_capa_code: null,
    ...overrides
  };
}

test('v8.19 confirmation accepts only the exact production CAPA_CODE', () => {
  const result = validateOperatorCorrectConfirmation({
    signedPayload: signedPayload(),
    evidenceRow: evidenceRow(),
    capaCode: 'lte1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.requested_code, 'LTE1');
  assert.equal(result.already_confirmed, false);
});

test('v8.19 confirmation rejects a different CAPA_CODE', () => {
  const result = validateOperatorCorrectConfirmation({
    signedPayload: signedPayload(),
    evidenceRow: evidenceRow(),
    capaCode: 'LTE2'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('v8.19 confirmation rejects platform or token mismatch', () => {
  const platformMismatch = validateOperatorCorrectConfirmation({
    signedPayload: signedPayload({ platform: 'MERCADO LIVRE' }),
    evidenceRow: evidenceRow(),
    capaCode: 'LTE1'
  });
  assert.equal(platformMismatch.ok, false);
  assert.equal(platformMismatch.status, 409);

  const tokenMismatch = validateOperatorCorrectConfirmation({
    signedPayload: signedPayload({ nonce: 'other-token' }),
    evidenceRow: evidenceRow(),
    capaCode: 'LTE1'
  });
  assert.equal(tokenMismatch.ok, false);
  assert.equal(tokenMismatch.status, 401);
});

test('v8.19 confirmation is idempotent for the same confirmed CAPA_CODE', () => {
  const result = validateOperatorCorrectConfirmation({
    signedPayload: signedPayload(),
    evidenceRow: evidenceRow({ confirmed_capa_code: 'LTE1' }),
    capaCode: 'LTE1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.already_confirmed, true);
});
