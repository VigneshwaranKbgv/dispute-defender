// PayPal Disputes API: fetch by ID, normalize into a view model, seller actions, error explanations.
import { api, type ApiResult } from './paypal.js';

export const DISPUTE_ID_RE = /^[A-Za-z0-9-]{5,40}$/;
export const MAX_MESSAGE_CHARS = 2000; // PayPal's limit for message/note fields

export interface Money {
  value: string;
  currency: string;
}

export interface DisputeView {
  id: string;
  reason: string;
  reasonLabel: string;
  status: string;
  state: string;
  stage: string;
  channel: string;
  amount: Money | null;
  createdAt: string | null;
  updatedAt: string | null;
  sellerResponseDueDate: string | null;
  buyer: { name: string | null; email: string | null };
  seller: { name: string | null; email: string | null; merchantId: string | null };
  transactions: {
    buyerTransactionId: string | null;
    sellerTransactionId: string | null;
    status: string | null;
    amount: Money | null;
    createdAt: string | null;
    sellerProtectionEligible: boolean | null;
    items: { name: string | null; quantity: string | null; type: string | null; reason: string | null }[];
  }[];
  messages: { postedBy: string; at: string | null; content: string }[];
  evidences: { type: string; source: string; notes: string | null; at: string | null; stage: string | null }[];
  requestedEvidenceTypes: string[];
  buyerRequestedAmount: Money | null;
  allowedRefundAmount: Money | null;
  outcome: string | null;
  allowedActions: SellerAction[];
}

export const SELLER_ACTIONS = ['send-message', 'provide-evidence', 'make-offer', 'escalate', 'accept-claim'] as const;
export type SellerAction = (typeof SELLER_ACTIONS)[number];

const REASON_LABELS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 'Item or service not received',
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: 'Item or service not as described',
  UNAUTHORISED: 'Unauthorised payment',
  CREDIT_NOT_PROCESSED: 'Refund or credit not processed',
  DUPLICATE_TRANSACTION: 'Duplicate charge',
  INCORRECT_AMOUNT: 'Charged an incorrect amount',
  PAYMENT_BY_OTHER_MEANS: 'Paid by other means',
  CANCELED_RECURRING_BILLING: 'Charged after cancelling recurring billing',
  PROBLEM_WITH_REMITTANCE: 'Problem with remittance',
  OTHER: 'Other',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const money = (m: any): Money | null => (m && typeof m.value === 'string' ? { value: m.value, currency: str(m.currency_code) ?? '' } : null);
const humanize = (code: string) => code.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const reasonLabel = (reason: string) => REASON_LABELS[reason] ?? humanize(reason || 'Unknown');

/** Turn the raw PayPal dispute JSON (untrusted, loosely shaped) into a stable view model. */
export function normalizeDispute(raw: any): DisputeView {
  const d = raw && typeof raw === 'object' ? raw : {};
  const txns: any[] = Array.isArray(d.disputed_transactions) ? d.disputed_transactions : [];
  const first = txns[0] ?? {};
  const evidences: any[] = Array.isArray(d.evidences) ? d.evidences : [];
  const links: any[] = Array.isArray(d.links) ? d.links : [];
  const linkActions = new Set(links.map((l) => String(l?.rel ?? '').replace(/_/g, '-')));
  const reason = str(d.reason) ?? 'OTHER';

  return {
    id: str(d.dispute_id) ?? '',
    reason,
    reasonLabel: reasonLabel(reason),
    status: str(d.status) ?? 'UNKNOWN',
    state: str(d.dispute_state) ?? 'UNKNOWN',
    stage: str(d.dispute_life_cycle_stage) ?? 'UNKNOWN',
    channel: str(d.dispute_channel) ?? 'UNKNOWN',
    amount: money(d.dispute_amount),
    createdAt: str(d.create_time),
    updatedAt: str(d.update_time),
    sellerResponseDueDate: str(d.seller_response_due_date),
    buyer: { name: str(first.buyer?.name), email: str(first.buyer?.email) },
    seller: { name: str(first.seller?.name), email: str(first.seller?.email), merchantId: str(first.seller?.merchant_id) },
    transactions: txns.map((t) => ({
      buyerTransactionId: str(t?.buyer_transaction_id),
      sellerTransactionId: str(t?.seller_transaction_id),
      status: str(t?.transaction_status),
      amount: money(t?.gross_amount),
      createdAt: str(t?.create_time),
      sellerProtectionEligible: typeof t?.seller_protection_eligible === 'boolean' ? t.seller_protection_eligible : null,
      items: (Array.isArray(t?.items) ? t.items : []).map((i: any) => ({
        name: str(i?.item_name),
        quantity: str(i?.item_quantity),
        type: str(i?.item_type),
        reason: str(i?.reason),
      })),
    })),
    messages: (Array.isArray(d.messages) ? d.messages : []).map((m: any) => ({
      postedBy: str(m?.posted_by) ?? 'UNKNOWN',
      at: str(m?.time_posted),
      content: str(m?.content) ?? '',
    })),
    evidences: evidences.map((e) => ({
      type: str(e?.evidence_type) ?? 'UNKNOWN',
      source: str(e?.source) ?? 'UNKNOWN',
      notes: str(e?.notes),
      at: str(e?.date),
      stage: str(e?.dispute_life_cycle_stage),
    })),
    requestedEvidenceTypes: evidences
      .filter((e) => e?.source === 'REQUESTED_FROM_SELLER' && str(e?.evidence_type))
      .map((e) => e.evidence_type as string),
    buyerRequestedAmount: money(d.offer?.buyer_requested_amount),
    allowedRefundAmount: money(d.refund_details?.allowed_refund_amount),
    outcome: str(d.dispute_outcome?.outcome_code),
    allowedActions: SELLER_ACTIONS.filter((a) => linkActions.has(a)),
  };
}

/** PayPal evidence type to submit: what PayPal asked for, else the natural type for the dispute reason. */
export function evidenceTypeFor(d: Pick<DisputeView, 'reason' | 'requestedEvidenceTypes'>): string {
  return d.requestedEvidenceTypes[0] ?? (d.reason === 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' ? 'PROOF_OF_FULFILLMENT' : 'OTHER');
}

export function fetchDispute(id: string): Promise<ApiResult> {
  return api('GET', `/v1/customer/disputes/${encodeURIComponent(id)}`);
}

export interface ActionInput {
  message: string;
  offerAmount?: Money;
  /** provide-evidence only: PayPal evidence type and optional attachments (JPG/PNG/GIF/PDF). */
  evidenceType?: string;
  files?: { name: string; mimeType: string; data: Buffer }[];
}

/** Perform one seller action on a dispute. Returns the raw PayPal result; never throws on 4xx. */
export function performAction(id: string, action: SellerAction, input: ActionInput): Promise<ApiResult> {
  const path = `/v1/customer/disputes/${encodeURIComponent(id)}/${action}`;
  switch (action) {
    case 'send-message':
      return api('POST', path, { message: input.message });
    case 'escalate':
    case 'accept-claim':
      return api('POST', path, { note: input.message });
    case 'make-offer':
      return api('POST', path, {
        note: input.message,
        offer_type: 'REFUND',
        offer_amount: input.offerAmount ? { currency_code: input.offerAmount.currency, value: input.offerAmount.value } : undefined,
      });
    case 'provide-evidence': {
      const form = new FormData();
      const payload = { evidences: [{ evidence_type: input.evidenceType || 'OTHER', notes: input.message }] };
      form.append('input', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      (input.files ?? []).forEach((f, i) => form.append(`file${i + 1}`, new Blob([new Uint8Array(f.data)], { type: f.mimeType }), f.name));
      return api('POST', path, form);
    }
  }
}

export const ACTION_LABELS: Record<SellerAction, string> = {
  'send-message': 'Message the buyer',
  'provide-evidence': 'Submit evidence to PayPal',
  'make-offer': 'Offer a refund',
  escalate: 'Escalate to a PayPal claim',
  'accept-claim': 'Accept the claim (full refund)',
};

const PLAIN_ERRORS: Record<string, string> = {
  EVIDENCE_TYPE_IS_NOT_ALLOWED:
    'PayPal is not accepting this kind of evidence for the case right now. It normally accepts evidence only while it is waiting for the seller and only of the type it asked for. Sync the case and try again, or respond in the Resolution Center.',
  ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE:
    'PayPal does not allow this action while the case is in its current state. Sync the case to see which actions are open right now, or respond in the Resolution Center.',
  INVALID_BUYER_TRANSACTION_ID: 'PayPal did not recognise the buyer transaction for this request.',
  PERMISSION_DENIED: 'This PayPal app is not permitted to do that for this case.',
  NOT_AUTHORIZED: 'This PayPal app is not authorised to do that for this case.',
  AUTHENTICATION_FAILURE: 'PayPal rejected the app credentials. Check the sandbox client ID and secret.',
  RESOURCE_NOT_FOUND: 'PayPal could not find a dispute with that ID for this seller account.',
  INVALID_RESOURCE_ID: 'PayPal could not find a dispute with that ID for this seller account.',
  INVALID_DISPUTE_ID: 'PayPal could not find a dispute with that ID for this seller account.',
  VALIDATION_ERROR: 'PayPal rejected the request because a field was missing or invalid.',
  INVALID_REQUEST: 'PayPal rejected the request because it was not formed the way it expects.',
  MALFORMED_REQUEST: 'PayPal rejected the request because it was not formed the way it expects.',
  UNPROCESSABLE_ENTITY: 'PayPal understood the request but refused to carry it out for this case.',
  RATE_LIMIT_REACHED: 'PayPal is rate-limiting this app. Wait a minute and try again.',
  INTERNAL_SERVER_ERROR: 'PayPal had an internal error. Nothing was sent; try again shortly.',
  SERVICE_UNAVAILABLE: 'PayPal is temporarily unavailable. Nothing was sent; try again shortly.',
};

export interface PayPalErrorInfo {
  status: number;
  name: string | null;
  issue: string | null;
  message: string | null;
  debugId: string | null;
  plain: string;
}

/** Explain a failed PayPal response in plain English while keeping PayPal's exact codes. */
export function explainPayPalError(r: ApiResult): PayPalErrorInfo {
  const j = r.json && typeof r.json === 'object' ? r.json : {};
  const detail = Array.isArray(j.details) ? j.details[0] : undefined;
  const name = str(j.name) ?? str(j.error);
  const issue = str(detail?.issue);
  const message = str(detail?.description) ?? str(j.message) ?? str(j.error_description) ?? (typeof r.json === 'string' ? r.json.slice(0, 300) : null);
  const plain =
    (issue && PLAIN_ERRORS[issue]) ||
    (name && PLAIN_ERRORS[name]) ||
    (r.status >= 500 ? PLAIN_ERRORS.INTERNAL_SERVER_ERROR! : `PayPal refused the request (HTTP ${r.status}).`);
  return { status: r.status, name, issue, message, debugId: str(j.debug_id), plain };
}
