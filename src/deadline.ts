// Seller response deadline. PayPal often omits seller_response_due_date, so for the INQUIRY
// stage we estimate create_time + 20 days (PayPal docs: buyer and seller have up to 20 days
// to resolve an inquiry before it escalates) and label it clearly as an estimate.

export const INQUIRY_WINDOW_DAYS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Urgency = 'closed' | 'overdue' | 'critical' | 'soon' | 'ok' | 'waiting' | 'unknown';

export interface DeadlineInput {
  status?: string;
  stage?: string;
  createTime?: string;
  sellerResponseDueDate?: string;
}

export interface Deadline {
  dueAt: string | null;
  isEstimate: boolean;
  basis: string;
  msRemaining: number | null;
  urgency: Urgency;
  /** Set when the next move is not the seller's: the date is then informational only. */
  waitingOn: 'paypal' | 'buyer' | null;
}

const validDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function computeDeadline(input: DeadlineInput, now: Date = new Date()): Deadline {
  if (input.status === 'RESOLVED') {
    return { dueAt: null, isEstimate: false, basis: 'Case is resolved; no response is due.', msRemaining: null, urgency: 'closed', waitingOn: null };
  }

  const waitingOn = input.status === 'UNDER_REVIEW' ? 'paypal' : input.status === 'WAITING_FOR_BUYER_RESPONSE' ? 'buyer' : null;
  let due: Date | null = validDate(input.sellerResponseDueDate);
  let isEstimate = false;
  let basis = 'Seller response date supplied by PayPal.';

  if (!due) {
    const created = validDate(input.createTime);
    if (input.stage === 'INQUIRY' && created) {
      due = new Date(created.getTime() + INQUIRY_WINDOW_DAYS * DAY_MS);
      isEstimate = true;
      basis = `Estimate: case opened + ${INQUIRY_WINDOW_DAYS} days (PayPal's inquiry window). PayPal did not supply a response date.`;
    } else {
      return {
        dueAt: null,
        isEstimate: false,
        basis: 'PayPal did not supply a response date for this stage. Check the Resolution Center.',
        msRemaining: null,
        urgency: waitingOn ? 'waiting' : 'unknown',
        waitingOn,
      };
    }
  }

  const msRemaining = due.getTime() - now.getTime();
  if (waitingOn && isEstimate) {
    const who = waitingOn === 'paypal' ? 'PayPal is reviewing the case' : 'PayPal is waiting for the buyer';
    return { dueAt: due.toISOString(), isEstimate, basis: `${who}; no response is required from you right now, though you can still act. The date is an estimate of when the ${INQUIRY_WINDOW_DAYS}-day inquiry window ends.`, msRemaining, urgency: 'waiting', waitingOn };
  }
  const urgency: Urgency = msRemaining < 0 ? 'overdue' : msRemaining <= 3 * DAY_MS ? 'critical' : msRemaining <= 7 * DAY_MS ? 'soon' : 'ok';
  return { dueAt: due.toISOString(), isEstimate, basis, msRemaining, urgency, waitingOn: null };
}

/** Sort key: cases needing the seller first (soonest deadline first), then undated, then waiting on others, then closed. */
export function urgencyRank(d: Deadline): number {
  if (d.urgency === 'closed') return Infinity;
  const time = d.dueAt === null ? 8.64e15 : new Date(d.dueAt).getTime(); // 8.64e15 = max JS date
  return d.urgency === 'waiting' ? 1e16 + time : time;
}
