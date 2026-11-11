import { html, render, useState, useEffect, useRef, useCallback } from '/vendor/htm-preact.js';
import { call, copyText, fmtAgo, fmtBytes, fmtDate, fmtMoney, fmtRemaining, humanize, Icon, readFileAsBase64, statusPill, urgencyTone, waitingLabel } from '/lib.js';

const RECOMMENDED_TO_ACTION = { refund: 'accept-claim', contest: 'provide-evidence', ask_buyer: 'send-message', escalate: 'escalate' };
const RECOMMENDED_LABEL = { refund: 'Refund the buyer', contest: 'Send your evidence to PayPal', ask_buyer: 'Message the buyer', escalate: 'Ask PayPal to step in' };
const STRENGTH_LABEL = { weak: 'Weak', moderate: 'Moderate', strong: 'Strong' };
const PRIORITY = { high: { label: 'Important', tone: 'danger' }, medium: { label: 'Helpful', tone: 'warn' }, low: { label: 'Optional', tone: '' } };
const ACTIVITY_TONE = { send_success: 'ok', send_failed: 'danger', analysis_failed: 'danger', sync_failed: 'danger', webhook_rejected: 'danger', analysis: 'info', webhook: 'info', case_added: 'info' };

const hashId = () => decodeURIComponent((location.hash.match(/^#\/case\/(.+)$/) || [])[1] || '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- small pieces ----------

function Btn({ busy, children, class: cls = '', ...rest }) {
  return html`<button type="button" class=${`btn ${cls}`} disabled=${busy || rest.disabled} ...${rest}>
    ${busy ? html`<span class="spinner" aria-hidden="true"></span>` : null}${children}
  </button>`;
}

function LinkBtn({ busy, children, class: cls = '', ...rest }) {
  return html`<button type="button" class=${`link-btn ${cls}`} disabled=${busy || rest.disabled} ...${rest}>
    ${busy ? html`<span class="spinner" aria-hidden="true"></span>` : null}${children}
  </button>`;
}

function StatusPill({ status }) {
  const s = statusPill(status);
  return html`<span class=${`pill ${s.tone}`}>${s.label}</span>`;
}

/** One line for the case list: what is due and when. */
function dueText(deadline, now) {
  if (deadline.urgency === 'closed') return 'No response due';
  if (deadline.waitingOn) return 'Nothing due from you';
  if (!deadline.dueAt) return 'No response date from PayPal';
  return `Respond: ${fmtRemaining(deadline.dueAt, now)}${deadline.isEstimate ? ' (estimate)' : ''}`;
}

function Notice({ tone = '', icon = Icon.info, title, children, class: cls = '' }) {
  return html`<div class=${`notice ${tone} ${cls}`}>
    <${icon} />
    <div class="grow">${title ? html`<div class="title">${title}</div>` : null}${children}</div>
  </div>`;
}

function Modal({ title, onClose, wide, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title}>
      <header><h2>${title}</h2><button type="button" class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon.x} /></button></header>
      <div class="body">${children}</div>
      ${footer ? html`<footer>${footer}</footer>` : null}
    </div>
  </div>`;
}

function ActivityList({ items, showCase }) {
  if (!items.length) return html`<p class="muted">Nothing here yet.</p>`;
  return html`<ol class="timeline">
    ${items.map(
      (a) => html`<li key=${a.id} class=${ACTIVITY_TONE[a.type] || ''}>
        <div class="pre">${a.summary}</div>
        <div class="when">${fmtDate(a.at)}${showCase && a.caseId ? html` · <span class="mono">${a.caseId}</span>` : null}</div>
      </li>`,
    )}
  </ol>`;
}

// ---------- left column: add a case + case list ----------

function Sidebar({ cases, selectedId, now, onSelect, onAdd, adding, config, loaded }) {
  const [value, setValue] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    if (await onAdd(value.trim())) setValue('');
  };
  const hasDemo = cases.some((c) => c.id === config.demoCaseId);
  return html`
    <section class="card">
      <h2>Add a case</h2>
      <form class="stack" onSubmit=${submit}>
        <label class="field">Case ID
          <input class="input mono" placeholder="PP-R-XXX-00000000" value=${value} onInput=${(e) => setValue(e.target.value)} autocomplete="off" spellcheck=${false} />
        </label>
        <button class="btn primary block" type="submit" disabled=${adding || !value.trim()}>${adding ? html`<span class="spinner" aria-hidden="true"></span>` : null}Add case</button>
      </form>
      <p class="muted small mt-8">
        You'll find the case ID in your PayPal Resolution Center.
        ${config.webhookConfigured ? ' New cases can also arrive from PayPal automatically, but the sandbox may not send dispute events.' : ''}
      </p>
    </section>

    <section class="card flush">
      <div class="card-head"><h2>Your cases${cases.length ? html`<span class="count">${cases.length}</span>` : null}</h2></div>
      ${!loaded
        ? html`<div class="empty"><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></div>`
        : cases.length === 0
          ? html`<div class="empty">
              <p>You're not tracking any cases yet. Add one by its ID, or start with the sandbox demo case.</p>
              <${Btn} class="sm" busy=${adding} onClick=${() => onAdd(config.demoCaseId, true)}>Add the demo case<//>
            </div>`
          : html`<div>
              ${cases.map(
                (c) => html`<button key=${c.id} type="button" class=${`case-row ${c.id === selectedId ? 'active' : ''}`} aria-current=${c.id === selectedId ? 'true' : undefined} onClick=${() => onSelect(c.id)}>
                  <span class="avatar" aria-hidden="true">${(c.buyerName || '?').trim().charAt(0).toUpperCase()}</span>
                  <span class="grow">
                    <span class="row between top">
                      <span class="title">${c.reasonLabel}</span>
                      <span class="amount">${fmtMoney(c.amount)}</span>
                    </span>
                    <span class="meta">${c.buyerName || 'Unknown buyer'} · <span class="mono">${c.id}</span></span>
                    <span class="tags">
                      <${StatusPill} status=${c.status} />
                      <span class="meta">${dueText(c.deadline, now)}</span>
                    </span>
                  </span>
                </button>`,
              )}
              ${!hasDemo ? html`<div class="list-foot"><${LinkBtn} busy=${adding} onClick=${() => onAdd(config.demoCaseId, true)}>Add the demo case<//></div>` : null}
            </div>`}
    </section>
  `;
}

// ---------- case detail cards ----------

function DeadlineBanner({ deadline: dl, now }) {
  const tone = urgencyTone[dl.urgency];
  let title;
  if (dl.urgency === 'closed') title = 'This case is resolved';
  else if (dl.waitingOn) title = waitingLabel[dl.waitingOn];
  else if (!dl.dueAt) title = 'No response date available';
  else if (dl.urgency === 'overdue') title = `Your response was due ${fmtDate(dl.dueAt)}`;
  else title = `Respond by ${fmtDate(dl.dueAt)}`;
  return html`<${Notice} tone=${tone} icon=${Icon.clock} class="deadline" title=${title}>
    ${dl.dueAt && !dl.waitingOn ? html`<div><strong>${fmtRemaining(dl.dueAt, now)}</strong>${dl.isEstimate ? ' · estimated date' : ''}</div>` : null}
    ${dl.dueAt && dl.waitingOn ? html`<div>Inquiry window ends ${fmtDate(dl.dueAt)} (estimate)</div>` : null}
    <div class="muted small">${dl.basis}</div>
  <//>`;
}

function CaseHeader({ detail, now, run, busy, onRemove }) {
  const d = detail.dispute;
  return html`<section class="card">
    <div class="row between top wrap">
      <div class="grow">
        <div class="muted small">Case <span class="mono">${d.id}</span></div>
        <h1 class="case-title">${d.reasonLabel}</h1>
      </div>
      <div class="case-amount">${fmtMoney(d.amount)}</div>
    </div>
    <div class="row wrap mt-8">
      <${StatusPill} status=${d.status} />
      <span class="muted small">${humanize(d.stage)} stage${d.outcome ? ` · Outcome: ${humanize(d.outcome)}` : ''}</span>
    </div>
    <div class="row between wrap mt-16">
      <a class="btn primary" href="#case-review" onClick=${(e) => { e.preventDefault(); document.getElementById('case-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Respond to dispute</a>
      <div class="row wrap">
        <span class="muted small">Updated ${fmtAgo(detail.syncedAt, now)}</span>
        <${LinkBtn} busy=${busy.sync} onClick=${() => run('sync', () => call('POST', `/cases/${detail.id}/sync`), 'Case is up to date')}>Refresh from PayPal<//>
        <${LinkBtn} class="quiet" onClick=${onRemove}>Stop tracking<//>
      </div>
    </div>
  </section>`;
}

function Fact({ label, children, mono }) {
  return html`<div class="fact"><dt>${label}</dt><dd class=${mono ? 'mono' : ''}>${children}</dd></div>`;
}

function CaseDetails({ detail }) {
  const d = detail.dispute;
  const txn = d.transactions[0];
  const items = d.transactions.flatMap((t) => t.items);
  return html`<section class="card">
    <h2>Case details</h2>
    <dl class="facts">
      <${Fact} label="Buyer">${d.buyer.name || '—'}${d.buyer.email ? html`<div class="small muted">${d.buyer.email}</div>` : null}<//>
      <${Fact} label="Seller">${d.seller.name || '—'}${d.seller.email ? html`<div class="small muted">${d.seller.email}</div>` : null}<//>
      <${Fact} label=${items.length > 1 ? 'Items' : 'Item'}>${items.length ? items.map((i) => html`<div>${i.name || 'Unnamed item'}${i.quantity ? ` × ${i.quantity}` : ''}${i.type ? html` <span class="muted small">(${humanize(i.type)})</span>` : null}</div>`) : '—'}<//>
      <${Fact} label="Transaction ID" mono>${txn?.sellerTransactionId || '—'}<//>
      <${Fact} label="Buyer's transaction ID" mono>${txn?.buyerTransactionId || '—'}<//>
      <${Fact} label="Payment date">${fmtDate(txn?.createdAt)}<//>
      <${Fact} label="Case opened">${fmtDate(d.createdAt)}<//>
      <${Fact} label="Buyer is asking for">${fmtMoney(d.buyerRequestedAmount)}<//>
      <${Fact} label="Maximum refund">${fmtMoney(d.allowedRefundAmount)}<//>
      <${Fact} label="Seller Protection">${!txn || txn.sellerProtectionEligible === null ? '—' : txn.sellerProtectionEligible ? 'Eligible' : 'Not eligible'}<//>
      <${Fact} label="PayPal status">${humanize(d.status)} · ${humanize(d.state)}<//>
      <${Fact} label="What you can do now">${d.allowedActions.length ? html`<div class="tag-list">${d.allowedActions.map((a) => html`<span class="pill">${detail.actionLabels[a]}</span>`)}</div>` : 'No actions are open right now'}<//>
    </dl>
  </section>`;
}

/** Messages and PayPal's evidence trail merged into one timeline, oldest first. */
function Messages({ dispute: d }) {
  const buyer = d.buyer.name || 'The buyer';
  const entries = [
    ...d.messages.map((m) => ({
      at: m.at,
      tone: m.postedBy === 'SELLER' ? 'info' : '',
      who: m.postedBy === 'SELLER' ? 'You wrote' : m.postedBy === 'BUYER' ? `${buyer} wrote` : `${humanize(m.postedBy)} wrote`,
      body: m.content,
    })),
    ...d.evidences.map((e) => ({
      at: e.at,
      tone: e.source === 'REQUESTED_FROM_SELLER' ? 'warn' : e.source === 'SUBMITTED_BY_SELLER' ? 'ok' : '',
      who:
        e.type === 'CREATE'
          ? `${buyer} opened the case`
          : e.source === 'REQUESTED_FROM_SELLER'
            ? `PayPal asked you for: ${humanize(e.type).toLowerCase()}`
            : e.source === 'SUBMITTED_BY_SELLER'
              ? `You sent PayPal: ${humanize(e.type).toLowerCase()}`
              : e.source === 'SUBMITTED_BY_BUYER'
                ? `${buyer} sent PayPal: ${humanize(e.type).toLowerCase()}`
                : `${humanize(e.source)}: ${humanize(e.type).toLowerCase()}`,
      body: e.type === 'CREATE' ? null : e.notes,
    })),
  ].sort((a, b) => (a.at || '9').localeCompare(b.at || '9'));
  return html`<section class="card">
    <h2>Messages</h2>
    ${entries.length === 0
      ? html`<p class="muted">There are no messages on this case yet.</p>`
      : html`<ol class="timeline">
          ${entries.map((e) => html`<li class=${e.tone}>
            <div><span class="who">${e.who}</span> <span class="when">· ${fmtDate(e.at)}</span></div>
            ${e.body ? html`<div class="said pre">${e.body}</div>` : null}
          </li>`)}
        </ol>`}
  </section>`;
}

function Evidence({ detail, config, run, busy }) {
  const [type, setType] = useState('delivery_proof');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const limits = config.limits;

  const add = async (e) => {
    e.preventDefault();
    const ok = await run('evidence', async () => {
      if (file && file.size > limits.maxFileBytes) throw new Error(`That file is too large. The limit is ${fmtBytes(limits.maxFileBytes)}.`);
      const payload = { type, note };
      if (file) payload.file = { name: file.name, mimeType: file.type || (/\.(md|csv|txt)$/i.test(file.name) ? 'text/plain' : ''), base64: await readFileAsBase64(file) };
      return call('POST', `/cases/${detail.id}/evidence`, payload);
    }, 'Evidence added');
    if (ok) {
      setNote('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return html`<section class="card">
    <h2>Your evidence${detail.evidence.length ? html`<span class="count">${detail.evidence.length}</span>` : null}</h2>
    ${detail.evidence.length === 0
      ? html`<p class="muted">Nothing added yet. Upload proof of delivery, tracking, messages with the buyer, or an invoice. Files stay here until you choose to send a response.</p>`
      : html`<div>
          ${detail.evidence.map(
            (ev) => html`<div class="ev-item" key=${ev.id}>
              <span class="ev-icon" aria-hidden="true">${ev.file ? html`<${Icon.file} />` : html`<${Icon.note} />`}</span>
              <div class="grow">
                <div>
                  ${ev.file
                    ? html`<a class="ev-name" href=${`/api/cases/${detail.id}/evidence/${ev.id}/file`} target="_blank" rel="noopener">${ev.file.name}</a>`
                    : html`<span class="ev-name">Note</span>`}
                </div>
                ${ev.note ? html`<div class="pre">${ev.note}</div>` : null}
                <div class="muted small">${config.evidenceTypes[ev.type] || ev.type}${ev.file ? ` · ${fmtBytes(ev.file.size)}` : ''} · Added ${fmtDate(ev.addedAt)}</div>
              </div>
              <button type="button" class="icon-btn" aria-label=${`Remove ${ev.file ? ev.file.name : 'note'}`} title="Remove" disabled=${busy.evidence}
                onClick=${() => run('evidence', () => call('DELETE', `/cases/${detail.id}/evidence/${ev.id}`), 'Evidence removed')}><${Icon.x} /></button>
            </div>`,
          )}
        </div>`}

    <form class="section" onSubmit=${add}>
      <h3>Add evidence</h3>
      <div class="form-grid">
        <label class="field">Type
          <select class="input" value=${type} onChange=${(e) => setType(e.target.value)}>
            ${Object.entries(config.evidenceTypes).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
          </select>
        </label>
        <label class="field">File <span class="hint">Optional. TXT, CSV, PNG, JPG, GIF, WEBP or PDF, up to ${fmtBytes(limits.maxFileBytes)}.</span>
          <input ref=${fileRef} type="file" accept=".txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.pdf" onChange=${(e) => setFile(e.target.files[0] || null)} />
        </label>
        <label class="field full">Description
          <textarea class="input" rows="2" maxlength=${limits.maxNoteChars} placeholder="What does this show? For example: courier scan showing delivery on 12 November." value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
        </label>
        <div class="full actions">
          <button class="btn sm" type="submit" disabled=${busy.evidence || (!note.trim() && !file)}>${busy.evidence ? html`<span class="spinner" aria-hidden="true"></span>` : null}Add evidence</button>
          ${detail.id === config.demoCaseId
            ? html`<${LinkBtn} busy=${busy.evidence} onClick=${() => run('evidence', () => call('POST', `/cases/${detail.id}/evidence/samples`), 'Sample evidence added')}>Use sample evidence<//>`
            : null}
        </div>
      </div>
    </form>
  </section>`;
}

// ---------- case review (analysis) + suggested response ----------

function SendResult({ result, onFallback, labels }) {
  if (!result) return null;
  if (result.ok) {
    return html`<${Notice} tone="ok" icon=${Icon.check} title="Sent to PayPal">
      PayPal accepted "${labels[result.action]}" (HTTP ${result.status}). The case has been refreshed.
    <//>`;
  }
  const e = result.error;
  return html`<div class="stack">
    <${Notice} tone="danger" icon=${Icon.alert} title="Your response wasn't sent">
      <div>PayPal didn't accept "${labels[result.action]}". ${e.plain}</div>
      <div class="small mono mt-8">${[e.status ? `HTTP ${e.status}` : null, e.name, e.issue].filter(Boolean).join(' · ')}</div>
      ${e.message ? html`<div class="small muted">PayPal's message: ${e.message}</div>` : null}
      ${e.debugId ? html`<div class="small muted">Debug ID: <span class="mono">${e.debugId}</span></div>` : null}
    <//>
    <div><${Btn} class="sm" onClick=${onFallback}>Copy response and open Resolution Center<//></div>
  </div>`;
}

function CaseReview({ detail, config, run, busy, toast, refresh }) {
  const a = detail.analysis?.result;
  const d = detail.dispute;
  const [draft, setDraft] = useState(detail.draft);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState('send-message');
  const [offer, setOffer] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const max = config.limits.maxMessageChars;

  // Reset the editor when a different case or a fresh review arrives.
  useEffect(() => {
    setDraft(detail.draft);
    setEditing(false);
    setResult(null);
    setAction(a ? RECOMMENDED_TO_ACTION[a.recommendedAction.action] : 'send-message');
    setOffer(d.allowedRefundAmount?.value || d.amount?.value || '');
  }, [detail.id, detail.analysis?.at]);

  const saveDraft = () => {
    if (draft !== detail.draft && draft.length <= max) call('PUT', `/cases/${detail.id}/draft`, { draft }).then(refresh).catch((e) => toast(e.message, true));
  };
  const doneEditing = () => {
    saveDraft();
    setEditing(false);
  };
  const copy = async () => {
    if (await copyText(draft)) {
      toast('Response copied');
      call('POST', `/cases/${detail.id}/copied`).then(refresh).catch(() => {});
      return true;
    }
    toast("Couldn't copy. Select the text and copy it yourself.", true);
    return false;
  };
  const send = async () => {
    setConfirming(false);
    setEditing(false);
    setResult(null);
    await run('send', async () => {
      const out = await call('POST', `/cases/${detail.id}/send`, { approved: true, action, message: draft, offerAmount: action === 'make-offer' ? offer : undefined });
      setResult(out.result);
      return out.case;
    });
  };
  const fallback = async () => {
    await copy();
    window.open(detail.resolutionCenterUrl, '_blank', 'noopener');
  };
  const review = () => run('analyze', () => call('POST', `/cases/${detail.id}/analyze`), 'Case review is ready');

  const stale = a && (detail.evidence.some((e) => e.addedAt > detail.analysis.at) || detail.history.some((h) => h.type === 'evidence_removed' && h.at > detail.analysis.at));
  const attachable = detail.evidence.filter((e) => e.paypalAttachable);
  const allowed = d.allowedActions.includes(action);
  const pct = a ? Math.max(0, Math.min(100, Math.round(a.strength.score))) : 0;

  return html`
    <section class="card" id="case-review">
      <div class="row between top wrap">
        <h2>Case review</h2>
        ${a && !busy.analyze ? html`<${LinkBtn} disabled=${!config.ai.configured} onClick=${review}>Review again<//>` : null}
      </div>

      ${!config.ai.configured ? html`<${Notice} tone="warn" icon=${Icon.alert} title="Case review isn't set up" class="mt-8">${config.ai.problem}<//>` : null}

      ${busy.analyze
        ? html`<div aria-busy="true" class="mt-16">
            <p class="muted">Reviewing the case and ${plural(detail.evidence.length, 'evidence item')}. This usually takes 10 to 20 seconds.</p>
            <div class="mt-16">${[100, 92, 78, 96, 60].map((w) => html`<div class="skeleton sk-line" style=${`width:${w}%`}></div>`)}</div>
          </div>`
        : !a
          ? html`<div class="mt-8 stack">
              <p class="muted">Get a second opinion before you respond. We'll compare the case with your evidence, tell you how strong your position looks, list any proof that's missing and suggest a response. You decide what gets sent.</p>
              ${detail.evidence.length === 0 ? html`<p class="muted small">You haven't added any evidence. The review will be more useful if you add it first.</p>` : null}
              <div><${Btn} class="primary" disabled=${!config.ai.configured} onClick=${review}>Review this case<//></div>
            </div>`
          : html`
              ${stale ? html`<${Notice} tone="warn" title="Your evidence has changed" class="mt-8">Review the case again to update the assessment and the suggested response.<//>` : null}

              <div class="mt-16">
                <h3>How strong your case looks</h3>
                <div class="meter-head mt-8">
                  <span class="meter-score">${pct}</span><span class="muted">out of 100</span>
                  <span class=${`pill ${{ weak: 'danger', moderate: 'warn', strong: 'ok' }[a.strength.label]}`}>${STRENGTH_LABEL[a.strength.label]}</span>
                </div>
                <div class="meter" role="img" aria-label=${`Case strength ${pct} out of 100, ${a.strength.label}`}><span class=${a.strength.label} style=${`width:${pct}%`}></span></div>
                <p>${a.strength.reasoning}</p>
                <p class="muted small mt-4">Dispute type: ${a.disputeType}</p>
              </div>

              <div class="section">
                <h3>Recommended next step</h3>
                <p><strong>${RECOMMENDED_LABEL[a.recommendedAction.action]}.</strong> ${a.recommendedAction.rationale}</p>
                <p class="muted mt-8">Keep in mind: ${a.recommendedAction.tradeoffs}</p>
              </div>

              <div class="section">
                <h3>Missing evidence${a.missingEvidence.length ? ` (${a.missingEvidence.length})` : ''}</h3>
                ${a.missingEvidence.length === 0
                  ? html`<p class="muted">Nothing important appears to be missing, based on what you've added.</p>`
                  : html`<ul class="checklist">${a.missingEvidence.map((m) => html`<li>
                      <span class="box" aria-hidden="true"></span>
                      <div class="grow">
                        <div class="row between top"><span class="item">${m.item}</span><span class=${`pill ${PRIORITY[m.priority].tone}`}>${PRIORITY[m.priority].label}</span></div>
                        <div class="muted">${m.why}</div>
                      </div>
                    </li>`)}</ul>`}
              </div>

              <div class="section">
                <h3>What PayPal usually needs for this kind of dispute</h3>
                <ul class="bullets">${a.whatPayPalNeeds.map((w) => html`<li>${w}</li>`)}</ul>
              </div>

              ${a.assumptions.length
                ? html`<div class="section"><h3>Assumptions made in this review</h3><ul class="bullets muted">${a.assumptions.map((w) => html`<li>${w}</li>`)}</ul></div>`
                : null}

              <p class="muted small mt-16">Reviewed ${fmtDate(detail.analysis.at)} · Automated review by ${detail.analysis.model} (${detail.analysis.provider}). It can be wrong, so check it against your records.</p>
            `}
    </section>

    ${a && !busy.analyze
      ? html`<section class="card">
          <div class="row between top wrap">
            <h2>Suggested response</h2>
            ${editing ? html`<${LinkBtn} onClick=${doneEditing}>Done editing<//>` : html`<${LinkBtn} onClick=${() => setEditing(true)}>Edit<//>`}
          </div>
          <div class="stack mt-8">
            ${editing
              ? html`<label class="field">Your response
                  <textarea class="input" rows="12" value=${draft} onInput=${(e) => setDraft(e.target.value)} onBlur=${saveDraft}></textarea>
                </label>`
              : html`<div class="draft-read pre">${draft || html`<span class="muted">The response is empty. Choose Edit to write one.</span>`}</div>`}
            <div class="row between">
              <span class="muted small">Review your response and check every fact before you send it.</span>
              <span class=${`counter ${draft.length > max ? 'over' : ''}`}>${draft.length} / ${max}</span>
            </div>

            <div class="respond-fields">
              <label class="field">How to respond
                <select class="input" value=${action} onChange=${(e) => { setAction(e.target.value); setResult(null); }}>
                  ${Object.entries(detail.actionLabels).map(([k, label]) => html`<option value=${k}>${label}${d.allowedActions.includes(k) ? '' : ' (not available now)'}</option>`)}
                </select>
              </label>
              ${action === 'make-offer'
                ? html`<label class="field">Refund amount (${d.amount?.currency || 'USD'})
                    <input class="input" inputmode="decimal" value=${offer} onInput=${(e) => setOffer(e.target.value)} />
                  </label>`
                : null}
            </div>
            ${action === 'provide-evidence'
              ? html`<p class="muted small">Your response is sent to PayPal as the evidence note${attachable.length ? html`, with ${plural(attachable.length, 'attachment')} (${attachable.map((e) => e.file.name).join(', ')})` : ''}. PayPal accepts JPG, PNG, GIF and PDF attachments. Text files stay here.</p>`
              : null}
            ${!allowed && !result ? html`<${Notice} tone="warn">PayPal doesn't list this option as available for the case right now. You can still try. If PayPal declines, you'll see why.<//>` : null}

            <div class="actions">
              <${Btn} class="primary" busy=${busy.send} disabled=${!draft.trim() || draft.length > max} onClick=${() => setConfirming(true)}>Approve & send<//>
              <${Btn} disabled=${!draft.trim()} onClick=${copy}>Copy<//>
            </div>
            <${SendResult} result=${result} onFallback=${fallback} labels=${detail.actionLabels} />
            <p class="muted small">Nothing is sent to PayPal until you approve it.</p>
          </div>
        </section>`
      : null}

    ${confirming
      ? html`<${Modal} title="Review your response" onClose=${() => setConfirming(false)}
          footer=${html`<${Btn} onClick=${() => setConfirming(false)}>Go back<//><${Btn} class=${action === 'accept-claim' ? 'danger' : 'primary'} onClick=${send}>Send to PayPal<//>`}>
          <div class="stack">
            <dl class="facts">
              <${Fact} label="Action">${detail.actionLabels[action]}<//>
              <${Fact} label="Case" mono>${detail.id}<//>
              ${action === 'make-offer' ? html`<${Fact} label="Refund offer">${offer} ${d.amount?.currency || 'USD'}<//>` : null}
            </dl>
            ${action === 'accept-claim' ? html`<${Notice} tone="danger" icon=${Icon.alert} title="This refunds the buyer in full">The case will be closed and this can't be undone.<//>` : null}
            ${action === 'escalate' ? html`<${Notice} tone="warn" icon=${Icon.alert} title="This escalates the case to a claim">PayPal will review the case and decide the outcome.<//>` : null}
            <div class="draft-read pre">${draft}</div>
            <p class="muted small">This is sent to PayPal exactly as written.</p>
          </div>
        <//>`
      : null}
  `;
}

function CaseDetail({ detail, config, now, run, busy, toast, refresh, onRemove, onBack }) {
  return html`
    <${LinkBtn} class="back-link" onClick=${onBack}><${Icon.back} />All cases<//>
    <${DeadlineBanner} deadline=${detail.deadline} now=${now} />
    <${CaseHeader} detail=${detail} now=${now} run=${run} busy=${busy} onRemove=${onRemove} />
    <${CaseDetails} detail=${detail} />
    <${Messages} dispute=${detail.dispute} />
    <${Evidence} detail=${detail} config=${config} run=${run} busy=${busy} />
    <${CaseReview} detail=${detail} config=${config} run=${run} busy=${busy} toast=${toast} refresh=${refresh} />
    <section class="card">
      <h2>Case history</h2>
      <${ActivityList} items=${detail.history} />
    </section>
  `;
}

// ---------- app ----------

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await call('POST', '/login', { password });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="login">
    <form class="card stack" onSubmit=${submit}>
      <div class="brand"><${Icon.shield} /> Dispute Defender</div>
      <p class="muted">Enter the password to open this demo.</p>
      <label class="field">Password
        <input class="input" type="password" autofocus value=${password} onInput=${(e) => setPassword(e.target.value)} />
      </label>
      ${error ? html`<${Notice} tone="danger" icon=${Icon.alert}>${error}<//>` : null}
      <button class="btn primary block" type="submit" disabled=${busy || !password}>${busy ? html`<span class="spinner" aria-hidden="true"></span>` : null}Continue</button>
    </form>
  </div>`;
}

function App() {
  const [session, setSession] = useState(null);
  const [bootError, setBootError] = useState('');
  const [cases, setCases] = useState([]);
  const [casesLoaded, setCasesLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(hashId());
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState('');
  const [busy, setBusy] = useState({});
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const [feed, setFeed] = useState(null);
  const [removing, setRemoving] = useState(false);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const toast = useCallback((text, error = false) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 2600);
  }, []);

  const loadSession = useCallback(() => call('GET', '/session').then(setSession).catch((e) => setBootError(e.message)), []);
  const loadCases = useCallback(async () => {
    try {
      setCases((await call('GET', '/cases')).cases);
    } catch (e) {
      if (e.status === 401) loadSession();
      else toast(e.message, true);
    } finally {
      setCasesLoaded(true);
    }
  }, []);
  const loadDetail = useCallback(async (id) => {
    if (!id) return setDetail(null);
    try {
      const d = await call('GET', `/cases/${id}`);
      if (selectedRef.current === id) {
        setDetail(d);
        setDetailError('');
      }
    } catch (e) {
      if (selectedRef.current === id) {
        setDetail(null);
        setDetailError(e.message);
      }
    }
  }, []);

  useEffect(() => { loadSession(); }, []);
  useEffect(() => {
    const onHash = () => setSelectedId(hashId());
    window.addEventListener('hashchange', onHash);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { window.removeEventListener('hashchange', onHash); clearInterval(tick); };
  }, []);
  const ready = session && session.authed;
  useEffect(() => { if (ready) loadCases(); }, [ready]);
  useEffect(() => {
    setDetail(null);
    setDetailError('');
    window.scrollTo(0, 0);
    if (ready) loadDetail(selectedId);
  }, [selectedId, ready]);
  // Pick up webhook-driven changes without a manual reload.
  useEffect(() => {
    if (!ready) return undefined;
    const poll = setInterval(() => { if (!document.hidden) loadCases(); }, 20000);
    return () => clearInterval(poll);
  }, [ready]);

  const select = (id) => { location.hash = id ? `#/case/${encodeURIComponent(id)}` : ''; };

  /** Run an action for the selected case: busy flag, refresh on success, toast on failure. */
  const run = async (key, fn, okMessage) => {
    const id = selectedRef.current;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      const out = await fn();
      if (out && out.dispute && selectedRef.current === id) setDetail(out);
      else await loadDetail(id);
      loadCases();
      if (okMessage) toast(okMessage);
      return true;
    } catch (e) {
      toast(e.message, true);
      loadDetail(id);
      return false;
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const addCase = async (id, demo = false) => {
    setBusy((b) => ({ ...b, add: true }));
    try {
      const out = await call('POST', '/cases', { disputeId: id, demo });
      await loadCases();
      select(out.id);
      toast(out.created ? 'Case added' : 'You already track this case. It has been refreshed.');
      return true;
    } catch (e) {
      toast(e.paypal?.issue || e.paypal?.name ? `${e.message} (${e.paypal.issue || e.paypal.name})` : e.message, true);
      return false;
    } finally {
      setBusy((b) => ({ ...b, add: false }));
    }
  };

  const removeCase = async () => {
    setRemoving(false);
    try {
      await call('DELETE', `/cases/${selectedId}`);
      select('');
      await loadCases();
      toast('Case removed');
    } catch (e) {
      toast(e.message, true);
    }
  };

  const openFeed = async () => {
    setFeed([]);
    try {
      setFeed((await call('GET', '/activity')).activity);
    } catch (e) {
      toast(e.message, true);
    }
  };

  if (bootError) return html`<div class="login"><div class="card empty-page"><h2>We can't reach the server</h2><p>${bootError}</p><${Btn} class="primary" onClick=${() => location.reload()}>Try again<//></div></div>`;
  if (!session) return html`<div class="boot">Loading…</div>`;
  if (!session.authed) return html`<${Login} onDone=${loadSession} />`;
  const config = session.config;

  return html`
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#" onClick=${(e) => { e.preventDefault(); select(''); }}><${Icon.shield} /> Dispute Defender</a>
        <div class="grow"></div>
        ${config.webhookConfigured ? html`<span class="pill hide-sm" title="A PayPal webhook ID is set, so incoming events can be verified. The sandbox may not send dispute events.">Webhook endpoint configured</span>` : null}
        <span class="pill warn" title="All PayPal calls go to the sandbox. No real money moves.">Sandbox</span>
        <${LinkBtn} onClick=${openFeed}>Activity<//>
      </div>
    </header>

    ${!config.paypalConfigured ? html`<div class="banner-strip" role="alert"><strong>PayPal isn't connected.</strong> Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.</div>` : null}

    <div class=${`page ${selectedId ? 'has-selection' : ''}`}>
      <aside class="sidebar">
        <${Sidebar} cases=${cases} selectedId=${selectedId} now=${now} onSelect=${select} onAdd=${addCase} adding=${busy.add} config=${config} loaded=${casesLoaded} />
      </aside>
      <main class="detail">
        ${detail
          ? html`<${CaseDetail} detail=${detail} config=${config} now=${now} run=${run} busy=${busy} toast=${toast}
              refresh=${() => loadDetail(selectedRef.current)} onRemove=${() => setRemoving(true)} onBack=${() => select('')} />`
          : detailError
            ? html`<section class="card empty-page"><h2>We couldn't open this case</h2><p>${detailError}</p><${Btn} onClick=${() => select('')}>Back to your cases<//></section>`
            : selectedId
              ? html`<div class="skeleton sk-card"></div><div class="skeleton sk-card"></div><div class="skeleton sk-card"></div>`
              : html`<section class="card empty-page">
                  <h2>${cases.length ? 'Select a case' : 'Respond to PayPal disputes with confidence'}</h2>
                  <p>${cases.length
                    ? 'Choose a case to see its details, add your evidence and prepare a response.'
                    : "Add a case to see its details and deadline, keep your evidence in one place, and prepare a response. Nothing is sent to PayPal until you approve it."}</p>
                </section>`}
      </main>
    </div>

    ${feed ? html`<${Modal} title="Activity" wide onClose=${() => setFeed(null)}>
      <p class="muted small">Everything that has happened across your cases, newest first.</p>
      <div class="mt-16"><${ActivityList} items=${feed} showCase /></div>
    <//>` : null}

    ${removing ? html`<${Modal} title="Stop tracking this case?" onClose=${() => setRemoving(false)}
      footer=${html`<${Btn} onClick=${() => setRemoving(false)}>Keep case<//><${Btn} class="danger" onClick=${removeCase}>Stop tracking<//>`}>
      <p>Case <span class="mono">${selectedId}</span> will be removed from Dispute Defender, along with the evidence and review you saved here. Nothing changes at PayPal, and you can add the case again later.</p>
    <//>` : null}

    <div class="toasts" role="status" aria-live="polite">${toasts.map((t) => html`<div key=${t.id} class=${`toast ${t.error ? 'error' : ''}`}>${t.text}</div>`)}</div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
