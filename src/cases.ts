// Case service: everything the API routes do, in one place (intake, sync, evidence, analysis, send).
import { computeDeadline, urgencyRank, type Deadline } from './deadline.js';
import {
  ACTION_LABELS,
  MAX_MESSAGE_CHARS,
  SELLER_ACTIONS,
  evidenceTypeFor,
  explainPayPalError,
  fetchDispute,
  normalizeDispute,
  performAction,
  type DisputeView,
  type PayPalErrorInfo,
  type SellerAction,
} from './disputes.js';
import { analyzeDispute, type Adapter } from './ai.js';
import {
  createEvidence,
  createSampleEvidence,
  deleteCaseEvidence,
  deleteEvidenceFile,
  isPayPalAttachable,
  loadEvidenceForAi,
  loadPayPalAttachments,
  type UploadInput,
} from './evidence.js';
import { addActivity, getCase, listActivity, listCases, removeCase, saveCase, type Activity, type CaseRecord, type EvidenceType } from './store.js';

export const DEMO_CASE_ID = process.env.DEMO_CASE_ID || 'PP-R-BYM-10198930';
export const RESOLUTION_CENTER_URL = 'https://www.sandbox.paypal.com/resolutioncenter/';

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

const deadlineFor = (d: DisputeView): Deadline =>
  computeDeadline({ status: d.status, stage: d.stage, createTime: d.createdAt ?? undefined, sellerResponseDueDate: d.sellerResponseDueDate ?? undefined });

export interface CaseSummary {
  id: string;
  reasonLabel: string;
  amount: DisputeView['amount'];
  status: string;
  stage: string;
  buyerName: string | null;
  deadline: Deadline;
  evidenceCount: number;
  strength: { score: number; label: string } | null;
  syncedAt: string;
}

function summarize(rec: CaseRecord): CaseSummary {
  const d = normalizeDispute(rec.dispute);
  const strength = (rec.analysis?.result as any)?.strength;
  return {
    id: rec.id,
    reasonLabel: d.reasonLabel,
    amount: d.amount,
    status: d.status,
    stage: d.stage,
    buyerName: d.buyer.name,
    deadline: deadlineFor(d),
    evidenceCount: rec.evidence.length,
    strength: strength ? { score: strength.score, label: strength.label } : null,
    syncedAt: rec.syncedAt,
  };
}

/** Tracked cases, most urgent first. */
export async function listCaseSummaries(): Promise<CaseSummary[]> {
  return (await listCases()).map(summarize).sort((a, b) => urgencyRank(a.deadline) - urgencyRank(b.deadline));
}

export interface CaseDetail {
  id: string;
  dispute: DisputeView;
  deadline: Deadline;
  addedAt: string;
  syncedAt: string;
  source: CaseRecord['source'];
  evidence: (CaseRecord['evidence'][number] & { paypalAttachable: boolean })[];
  analysis: CaseRecord['analysis'] | null;
  draft: string;
  history: Activity[];
  actionLabels: Record<SellerAction, string>;
  resolutionCenterUrl: string;
}

async function requireCase(id: string): Promise<CaseRecord> {
  const rec = await getCase(id);
  if (!rec) throw new NotFoundError('This case is not being tracked.');
  return rec;
}

export async function getCaseDetail(id: string): Promise<CaseDetail> {
  const rec = await requireCase(id);
  const dispute = normalizeDispute(rec.dispute);
  return {
    id: rec.id,
    dispute,
    deadline: deadlineFor(dispute),
    addedAt: rec.addedAt,
    syncedAt: rec.syncedAt,
    source: rec.source,
    evidence: rec.evidence.map((e) => ({ ...e, paypalAttachable: isPayPalAttachable(e) })),
    analysis: rec.analysis ?? null,
    draft: rec.draft ?? '',
    history: await listActivity(rec.id),
    actionLabels: ACTION_LABELS,
    resolutionCenterUrl: RESOLUTION_CENTER_URL,
  };
}

export type UpsertResult = { ok: true; created: boolean } | { ok: false; error: PayPalErrorInfo };

/** Fetch a dispute from PayPal by ID and create or refresh the tracked case. Used by add, sync and webhooks. */
export async function upsertCaseFromPayPal(id: string, source: CaseRecord['source']): Promise<UpsertResult> {
  const existing = await getCase(id);
  let r;
  try {
    r = await fetchDispute(id);
  } catch (err: any) {
    r = { status: 0, ok: false, json: { name: 'NETWORK_ERROR', message: err?.message ?? String(err) } };
  }
  if (!r.ok || !r.json?.dispute_id) {
    const error = explainPayPalError(r);
    if (r.status === 0) error.plain = `Could not reach PayPal: ${error.message}`;
    await addActivity(existing ? id : null, 'sync_failed', `Fetching ${id} from PayPal failed: ${error.plain}`, error);
    return { ok: false, error };
  }
  const now = new Date().toISOString();
  const canonicalId: string = r.json.dispute_id;
  const current = existing ?? (await getCase(canonicalId));
  const before = current ? normalizeDispute(current.dispute) : null;
  const after = normalizeDispute(r.json);
  await saveCase(
    current
      ? { ...current, dispute: r.json, syncedAt: now }
      : { id: canonicalId, dispute: r.json, addedAt: now, syncedAt: now, source, evidence: [] },
  );
  if (!current) {
    await addActivity(canonicalId, 'case_added', `Case added ${source === 'webhook' ? 'from a PayPal webhook' : source === 'demo' ? 'as the demo case' : 'by ID'}: ${after.reasonLabel}, ${after.status}.`);
  } else {
    const changed = before && (before.status !== after.status || before.state !== after.state || before.stage !== after.stage);
    await addActivity(
      canonicalId,
      'sync',
      changed
        ? `Synced${source === 'webhook' ? ' (webhook)' : ''}: status ${before.status} -> ${after.status}, stage ${before.stage} -> ${after.stage}.`
        : `Synced${source === 'webhook' ? ' (webhook)' : ''}: no status change (${after.status}).`,
    );
  }
  return { ok: true, created: !current };
}

export async function stopTracking(id: string): Promise<void> {
  if (!(await removeCase(id))) throw new NotFoundError('This case is not being tracked.');
  await deleteCaseEvidence(id);
  await addActivity(null, 'case_removed', `Stopped tracking ${id} (local data removed; nothing changed at PayPal).`);
}

export async function addEvidence(id: string, type: EvidenceType, note: string, upload?: UploadInput): Promise<void> {
  const rec = await requireCase(id);
  if (rec.evidence.length >= 30) throw new BadRequestError('Evidence locker is full (30 items).');
  const item = await createEvidence(id, type, note, upload);
  await saveCase({ ...rec, evidence: [...rec.evidence, item] });
  await addActivity(id, 'evidence_added', `Evidence added: ${item.file ? item.file.name : 'note'} (${type.replace(/_/g, ' ')}).`);
}

export async function addSampleEvidence(id: string): Promise<void> {
  const rec = await requireCase(id);
  const items = await createSampleEvidence(id);
  await saveCase({ ...rec, evidence: [...rec.evidence, ...items] });
  await addActivity(id, 'evidence_added', `Sample (fictional) demo evidence added: ${items.map((i) => i.file?.name).join(', ')}.`);
}

export async function removeEvidence(id: string, evidenceId: string): Promise<void> {
  const rec = await requireCase(id);
  const item = rec.evidence.find((e) => e.id === evidenceId);
  if (!item) throw new NotFoundError('Evidence item not found.');
  await deleteEvidenceFile(id, item);
  await saveCase({ ...rec, evidence: rec.evidence.filter((e) => e.id !== evidenceId) });
  await addActivity(id, 'evidence_removed', `Evidence removed: ${item.file ? item.file.name : 'note'}.`);
}

export async function analyzeCase(id: string, adapter?: Adapter): Promise<void> {
  const rec = await requireCase(id);
  try {
    const evidence = await loadEvidenceForAi(id, rec.evidence);
    const out = await analyzeDispute(normalizeDispute(rec.dispute), evidence, adapter);
    // Re-read: the record may have changed while the model was thinking.
    const latest = await requireCase(id);
    await saveCase({
      ...latest,
      analysis: { result: out.data, provider: out.provider, model: out.model, at: new Date().toISOString(), attempts: out.attempts },
      draft: out.data.draftResponse.slice(0, MAX_MESSAGE_CHARS),
    });
    await addActivity(
      id,
      'analysis',
      `AI analysis by ${out.model}: ${out.data.strength.label} (${Math.round(out.data.strength.score)}/100), recommends "${out.data.recommendedAction.action}"${out.attempts > 1 ? ' (needed one retry for valid output)' : ''}.`,
    );
  } catch (err: any) {
    await addActivity(id, 'analysis_failed', `AI analysis failed: ${err?.message ?? err}`);
    throw err;
  }
}

export async function saveDraft(id: string, draft: string): Promise<void> {
  const rec = await requireCase(id);
  if (draft.length > MAX_MESSAGE_CHARS) throw new BadRequestError(`Response is too long (max ${MAX_MESSAGE_CHARS} characters).`);
  if (draft === (rec.draft ?? '')) return;
  await saveCase({ ...rec, draft });
  await addActivity(id, 'draft_edited', 'Seller edited the draft response.');
}

export async function recordCopy(id: string): Promise<void> {
  await requireCase(id);
  await addActivity(id, 'response_copied', 'Seller copied the response to the clipboard.');
}

export interface SendInput {
  action: string;
  message: string;
  offerAmount?: string;
}

export type SendResult = { ok: true; action: SellerAction; status: number } | { ok: false; action: SellerAction; error: PayPalErrorInfo };

/** The seller approved: attempt the chosen PayPal action. Success is claimed only on a 2xx from PayPal. */
export async function sendResponse(id: string, input: SendInput): Promise<SendResult> {
  const rec = await requireCase(id);
  const action = SELLER_ACTIONS.find((a) => a === input.action);
  if (!action) throw new BadRequestError('Unknown action.');
  const message = input.message.trim();
  if (!message) throw new BadRequestError('The response is empty.');
  if (message.length > MAX_MESSAGE_CHARS) throw new BadRequestError(`Response is too long (max ${MAX_MESSAGE_CHARS} characters).`);

  const dispute = normalizeDispute(rec.dispute);
  let offerAmount;
  if (action === 'make-offer') {
    if (!input.offerAmount || !/^\d{1,7}(\.\d{1,2})?$/.test(input.offerAmount) || Number(input.offerAmount) <= 0) {
      throw new BadRequestError('Enter a valid refund offer amount.');
    }
    offerAmount = { value: Number(input.offerAmount).toFixed(2), currency: dispute.amount?.currency || 'USD' };
  }
  await saveDraft(id, message);

  const files = action === 'provide-evidence' ? await loadPayPalAttachments(id, rec.evidence) : undefined;
  const evidenceType = evidenceTypeFor(dispute);
  const label = ACTION_LABELS[action];
  let r;
  try {
    r = await performAction(id, action, { message, offerAmount, evidenceType, files });
  } catch (err: any) {
    r = { status: 0, ok: false, json: { name: 'NETWORK_ERROR', message: err?.message ?? String(err) } };
  }

  if (r.ok) {
    await addActivity(id, 'send_success', `Seller approved "${label}": PayPal accepted it (HTTP ${r.status}).`, {
      action,
      status: r.status,
      message,
      ...(action === 'provide-evidence' ? { evidenceType, attachments: files?.map((f) => f.name) } : {}),
      ...(offerAmount ? { offerAmount } : {}),
    });
    await upsertCaseFromPayPal(id, 'manual'); // show the new state straight away
    return { ok: true, action, status: r.status };
  }
  const error = explainPayPalError(r);
  if (r.status === 0) error.plain = `Could not reach PayPal: ${error.message}. Nothing was sent.`;
  await addActivity(id, 'send_failed', `Seller approved "${label}" but PayPal refused it: ${error.issue ?? error.name ?? `HTTP ${error.status}`}. ${error.plain}`, { action, error, message });
  return { ok: false, action, error };
}
