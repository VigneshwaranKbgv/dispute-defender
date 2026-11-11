import { describe, expect, it } from 'vitest';
import { DISPUTE_ID_RE, evidenceTypeFor, explainPayPalError, normalizeDispute } from '../src/disputes.js';
import { sampleDispute } from './fixtures.js';

describe('normalizeDispute', () => {
  it('maps the PayPal dispute into the view model', () => {
    const d = normalizeDispute(sampleDispute);
    expect(d).toMatchObject({
      id: 'PP-R-TST-10000001',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      reasonLabel: 'Item or service not received',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      state: 'REQUIRED_ACTION',
      stage: 'INQUIRY',
      amount: { value: '10.00', currency: 'USD' },
      sellerResponseDueDate: '2026-12-01T14:31:11.376Z',
      buyer: { name: 'John Doe', email: 'buyer@example.com' },
      seller: { name: 'Test Store', merchantId: 'MERCHANT123' },
      buyerRequestedAmount: { value: '10.00', currency: 'USD' },
      allowedRefundAmount: { value: '10.00', currency: 'USD' },
      requestedEvidenceTypes: ['PROOF_OF_FULFILLMENT'],
    });
    expect(d.transactions[0]).toMatchObject({ sellerTransactionId: 'SELLERTXN00000001', sellerProtectionEligible: false });
    expect(d.transactions[0]?.items[0]).toMatchObject({ name: 'Hackathon spike order', type: 'SERVICE' });
    expect(d.messages).toEqual([{ postedBy: 'BUYER', at: '2026-11-11T14:31:11.376Z', content: 'Service never delivered' }]);
    expect(d.evidences).toHaveLength(2);
  });

  it('reads the actions PayPal allows from HATEOAS links', () => {
    expect(normalizeDispute(sampleDispute).allowedActions).toEqual(['send-message', 'provide-evidence']);
  });

  it('survives missing and malformed fields', () => {
    for (const raw of [undefined, null, 'text', {}, { disputed_transactions: 'x', messages: [null], evidences: [{}], links: [{}] }]) {
      const d = normalizeDispute(raw);
      expect(d.status).toBe('UNKNOWN');
      expect(d.amount).toBeNull();
      expect(d.allowedActions).toEqual([]);
    }
  });

  it('humanizes unknown reason codes', () => {
    expect(normalizeDispute({ reason: 'SOME_NEW_REASON' }).reasonLabel).toBe('Some new reason');
  });
});

describe('evidenceTypeFor', () => {
  it('prefers the evidence type PayPal requested', () => {
    expect(evidenceTypeFor({ reason: 'OTHER', requestedEvidenceTypes: ['PROOF_OF_REFUND'] })).toBe('PROOF_OF_REFUND');
  });
  it('falls back by dispute reason', () => {
    expect(evidenceTypeFor({ reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', requestedEvidenceTypes: [] })).toBe('PROOF_OF_FULFILLMENT');
    expect(evidenceTypeFor({ reason: 'UNAUTHORISED', requestedEvidenceTypes: [] })).toBe('OTHER');
  });
});

describe('explainPayPalError', () => {
  it('explains a known issue code in plain English and keeps the exact codes', () => {
    const e = explainPayPalError({
      status: 422,
      ok: false,
      json: { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: 'abc123', details: [{ issue: 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE', description: 'Action not allowed.' }] },
    });
    expect(e).toMatchObject({ status: 422, name: 'UNPROCESSABLE_ENTITY', issue: 'ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE', debugId: 'abc123', message: 'Action not allowed.' });
    expect(e.plain).toMatch(/current state/);
  });

  it('falls back sensibly for unknown and non-JSON errors', () => {
    expect(explainPayPalError({ status: 418, ok: false, json: { name: 'TEAPOT' } }).plain).toBe('PayPal refused the request (HTTP 418).');
    expect(explainPayPalError({ status: 503, ok: false, json: '<html>down</html>' }).plain).toMatch(/internal error/);
  });
});

describe('DISPUTE_ID_RE', () => {
  it('accepts PayPal dispute IDs and rejects path tricks', () => {
    expect(DISPUTE_ID_RE.test('PP-R-BYM-10198930')).toBe(true);
    expect(DISPUTE_ID_RE.test('../v1/oauth2/token')).toBe(false);
    expect(DISPUTE_ID_RE.test('PP D 1')).toBe(false);
  });
});
