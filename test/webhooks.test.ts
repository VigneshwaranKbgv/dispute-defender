import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clearTokenCache } from '../src/paypal.js';
import { getCase, listActivity, resetStoreCache } from '../src/store.js';
import { handleWebhook, verifyWebhookSignature } from '../src/webhooks.js';
import { jsonResponse, sampleDispute } from './fixtures.js';

const headers = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  'paypal-transmission-id': 'tx-1',
  'paypal-transmission-sig': 'sig==',
  'paypal-transmission-time': '2026-11-11T15:00:00Z',
};
// Deliberately odd spacing: verification must embed these exact bytes.
const rawEvent = `{"id":"WH-1",  "event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"dispute_id":"${sampleDispute.dispute_id}"}}`;

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

/** Mock PayPal: token, verify-webhook-signature and dispute fetch. */
function mockPayPal(verificationStatus: string, verifyHttpStatus = 200) {
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/v1/oauth2/token')) return jsonResponse({ access_token: 'test-token', expires_in: 3600 });
    if (url.endsWith('/v1/notifications/verify-webhook-signature')) return jsonResponse({ verification_status: verificationStatus }, verifyHttpStatus);
    if (url.includes('/v1/customer/disputes/')) return jsonResponse(sampleDispute);
    return jsonResponse({ name: 'RESOURCE_NOT_FOUND' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const verifyCall = () => fetchMock.mock.calls.find(([url]) => String(url).endsWith('/verify-webhook-signature'));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dd-test-'));
  process.env.DATA_DIR = dir;
  process.env.PAYPAL_CLIENT_ID = 'id';
  process.env.PAYPAL_CLIENT_SECRET = 'secret';
  process.env.PAYPAL_BASE_URL = 'https://api-m.sandbox.paypal.com';
  process.env.PAYPAL_WEBHOOK_ID = 'WEBHOOK-ID-1';
  resetStoreCache();
  clearTokenCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe('verifyWebhookSignature', () => {
  it('posts the headers, webhook ID and the raw event bytes to PayPal', async () => {
    mockPayPal('SUCCESS');
    expect(await verifyWebhookSignature(headers, rawEvent)).toEqual({ verified: true });
    const [url, init] = verifyCall()!;
    expect(url).toBe('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.body).toContain(`"webhook_event":${rawEvent}}`); // verbatim, not re-serialized
    expect(JSON.parse(init.body)).toMatchObject({
      auth_algo: 'SHA256withRSA',
      cert_url: headers['paypal-cert-url'],
      transmission_id: 'tx-1',
      transmission_sig: 'sig==',
      transmission_time: '2026-11-11T15:00:00Z',
      webhook_id: 'WEBHOOK-ID-1',
      webhook_event: { id: 'WH-1', event_type: 'CUSTOMER.DISPUTE.CREATED' },
    });
  });

  it('rejects when PayPal says FAILURE or the call errors', async () => {
    mockPayPal('FAILURE');
    expect((await verifyWebhookSignature(headers, rawEvent)).verified).toBe(false);
    mockPayPal('SUCCESS', 500);
    expect((await verifyWebhookSignature(headers, rawEvent)).verified).toBe(false);
  });

  it('rejects without calling PayPal when the webhook ID, headers or JSON are missing', async () => {
    mockPayPal('SUCCESS');
    expect((await verifyWebhookSignature(headers, rawEvent, '')).verified).toBe(false);
    expect((await verifyWebhookSignature({}, rawEvent)).verified).toBe(false);
    expect((await verifyWebhookSignature(headers, 'not json')).verified).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleWebhook', () => {
  it('on a verified dispute event, fetches the case by ID, upserts it and logs activity', async () => {
    mockPayPal('SUCCESS');
    const out = await handleWebhook(headers, rawEvent);
    expect(out).toEqual({ httpStatus: 200, body: { received: true, note: 'case synced' } });
    const rec = await getCase(sampleDispute.dispute_id);
    expect(rec).toMatchObject({ id: sampleDispute.dispute_id, source: 'webhook' });
    expect(rec?.dispute.status).toBe('WAITING_FOR_SELLER_RESPONSE'); // from the re-fetch, not the webhook payload
    const types = (await listActivity()).map((a) => a.type);
    expect(types).toContain('webhook');
    expect(types).toContain('case_added');
  });

  it('rejects an unverified event, stores nothing and logs the rejection', async () => {
    mockPayPal('FAILURE');
    const out = await handleWebhook(headers, rawEvent);
    expect(out.httpStatus).toBe(400);
    expect(await getCase(sampleDispute.dispute_id)).toBeUndefined();
    expect((await listActivity())[0]).toMatchObject({ type: 'webhook_rejected' });
  });

  it('acknowledges verified events it does not handle', async () => {
    mockPayPal('SUCCESS');
    const out = await handleWebhook(headers, '{"event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"1"}}');
    expect(out).toEqual({ httpStatus: 200, body: { received: true, note: 'ignored' } });
    expect(await getCase(sampleDispute.dispute_id)).toBeUndefined();
  });
});
