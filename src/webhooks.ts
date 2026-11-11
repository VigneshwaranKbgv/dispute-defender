// PayPal webhook receiver logic: verify the signature with PayPal, then upsert the case by ID.
import { api } from './paypal.js';
import { DISPUTE_ID_RE } from './disputes.js';
import { addActivity } from './store.js';
import { upsertCaseFromPayPal } from './cases.js';

export const HANDLED_EVENTS = ['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED'];

type Headers = Record<string, string | string[] | undefined>;
const header = (h: Headers, name: string): string => {
  const v = h[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

export interface VerifyResult {
  verified: boolean;
  reason?: string;
}

/**
 * Ask PayPal whether this webhook is genuine (POST /v1/notifications/verify-webhook-signature).
 * The raw request body is embedded verbatim: re-serializing the event can change bytes and fail verification.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string, webhookId = process.env.PAYPAL_WEBHOOK_ID): Promise<VerifyResult> {
  if (!webhookId) return { verified: false, reason: 'PAYPAL_WEBHOOK_ID is not configured, so the event cannot be verified.' };
  const fields = {
    auth_algo: header(headers, 'paypal-auth-algo'),
    cert_url: header(headers, 'paypal-cert-url'),
    transmission_id: header(headers, 'paypal-transmission-id'),
    transmission_sig: header(headers, 'paypal-transmission-sig'),
    transmission_time: header(headers, 'paypal-transmission-time'),
    webhook_id: webhookId,
  };
  if (!fields.transmission_id || !fields.transmission_sig) return { verified: false, reason: 'PayPal signature headers are missing.' };
  try {
    JSON.parse(rawBody);
  } catch {
    return { verified: false, reason: 'Body is not valid JSON.' };
  }
  const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
  const r = await api('POST', '/v1/notifications/verify-webhook-signature', body);
  if (!r.ok) return { verified: false, reason: `PayPal verification call failed (HTTP ${r.status}).` };
  return r.json?.verification_status === 'SUCCESS' ? { verified: true } : { verified: false, reason: `PayPal verification status: ${r.json?.verification_status ?? 'unknown'}.` };
}

export interface WebhookOutcome {
  httpStatus: number;
  body: { received: boolean; note?: string };
}

/** Handle one webhook delivery. Every delivery is logged to the activity feed. */
export async function handleWebhook(headers: Headers, rawBody: string): Promise<WebhookOutcome> {
  let event: any = null;
  try {
    event = JSON.parse(rawBody);
  } catch {
    /* handled by verification below */
  }
  const eventType = typeof event?.event_type === 'string' ? event.event_type.slice(0, 80) : 'unknown';
  const rawId = event?.resource?.dispute_id;
  const disputeId = typeof rawId === 'string' && DISPUTE_ID_RE.test(rawId) ? rawId : null;

  let check: VerifyResult;
  try {
    check = await verifyWebhookSignature(headers, rawBody);
  } catch (err: any) {
    check = { verified: false, reason: `Verification error: ${err?.message ?? err}` };
  }
  if (!check.verified) {
    await addActivity(null, 'webhook_rejected', `Webhook ${eventType} rejected: ${check.reason}`, { eventType, disputeId });
    return { httpStatus: 400, body: { received: false, note: 'signature not verified' } };
  }

  if (!HANDLED_EVENTS.includes(eventType) || !disputeId) {
    await addActivity(null, 'webhook', `Webhook ${eventType} received (verified); nothing to do.`, { eventType });
    return { httpStatus: 200, body: { received: true, note: 'ignored' } };
  }

  await addActivity(disputeId, 'webhook', `Webhook ${eventType} received (verified) for ${disputeId}.`, { eventType, eventId: event?.id });
  // Never trust the webhook payload for case data: re-fetch the case from PayPal by ID.
  const result = await upsertCaseFromPayPal(disputeId, 'webhook');
  return { httpStatus: 200, body: { received: true, note: result.ok ? 'case synced' : 'case fetch failed' } };
}
