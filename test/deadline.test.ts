import { describe, expect, it } from 'vitest';
import { computeDeadline, urgencyRank } from '../src/deadline.js';

const now = new Date('2026-11-11T12:00:00.000Z');
const open = { status: 'WAITING_FOR_SELLER_RESPONSE', stage: 'INQUIRY', createTime: '2026-11-10T12:00:00.000Z' };

describe('computeDeadline', () => {
  it('uses the PayPal-supplied seller response date when present', () => {
    const d = computeDeadline({ ...open, sellerResponseDueDate: '2026-11-20T12:00:00.000Z' }, now);
    expect(d.dueAt).toBe('2026-11-20T12:00:00.000Z');
    expect(d.isEstimate).toBe(false);
    expect(d.urgency).toBe('ok');
  });

  it('estimates create_time + 20 days for an inquiry with no supplied date', () => {
    const d = computeDeadline(open, now);
    expect(d.dueAt).toBe('2026-11-30T12:00:00.000Z');
    expect(d.isEstimate).toBe(true);
    expect(d.basis).toMatch(/estimate/i);
    expect(d.msRemaining).toBe(19 * 24 * 3600 * 1000);
  });

  it('grades urgency by time left', () => {
    const at = (iso: string) => computeDeadline({ ...open, sellerResponseDueDate: iso }, now).urgency;
    expect(at('2026-11-10T12:00:00.000Z')).toBe('overdue');
    expect(at('2026-11-13T12:00:00.000Z')).toBe('critical');
    expect(at('2026-11-17T12:00:00.000Z')).toBe('soon');
    expect(at('2026-11-25T12:00:00.000Z')).toBe('ok');
  });

  it('does not invent a date outside the inquiry stage', () => {
    const d = computeDeadline({ ...open, stage: 'CHARGEBACK' }, now);
    expect(d.dueAt).toBeNull();
    expect(d.urgency).toBe('unknown');
  });

  it('reports resolved cases as closed', () => {
    const d = computeDeadline({ ...open, status: 'RESOLVED', sellerResponseDueDate: '2026-11-20T12:00:00.000Z' }, now);
    expect(d).toMatchObject({ dueAt: null, urgency: 'closed' });
  });

  it('marks cases that are waiting on PayPal or the buyer', () => {
    expect(computeDeadline({ ...open, status: 'UNDER_REVIEW' }, now)).toMatchObject({ urgency: 'waiting', waitingOn: 'paypal', isEstimate: true });
    expect(computeDeadline({ ...open, status: 'WAITING_FOR_BUYER_RESPONSE' }, now)).toMatchObject({ urgency: 'waiting', waitingOn: 'buyer' });
  });

  it('ignores an invalid date string', () => {
    expect(computeDeadline({ ...open, sellerResponseDueDate: 'not-a-date' }, now).isEstimate).toBe(true);
  });

  it('ranks seller-action cases by soonest deadline, then waiting, then closed', () => {
    const soon = computeDeadline({ ...open, sellerResponseDueDate: '2026-11-12T12:00:00.000Z' }, now);
    const later = computeDeadline({ ...open, sellerResponseDueDate: '2026-11-25T12:00:00.000Z' }, now);
    const undated = computeDeadline({ ...open, stage: 'CHARGEBACK' }, now);
    const waiting = computeDeadline({ ...open, status: 'UNDER_REVIEW' }, now);
    const closed = computeDeadline({ ...open, status: 'RESOLVED' }, now);
    const sorted = [closed, waiting, undated, later, soon].sort((a, b) => urgencyRank(a) - urgencyRank(b));
    expect(sorted).toEqual([soon, later, undated, waiting, closed]);
  });
});
