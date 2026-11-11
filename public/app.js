import { html, render, useState, useEffect, useRef, useCallback } from '/vendor/htm-preact.js';
import { call, copyText, fmtAgo, fmtBytes, fmtDate, fmtMoney, fmtRemaining, humanize, Icon, readFileAsBase64, urgencyTone, waitingLabel } from '/lib.js';

const RECOMMENDED_TO_ACTION = { refund: 'accept-claim', contest: 'provide-evidence', ask_buyer: 'send-message', escalate: 'escalate' };
const RECOMMENDED_LABEL = { refund: 'Refund the buyer', contest: 'Contest with evidence', ask_buyer: 'Message the buyer', escalate: 'Escalate to PayPal' };
const ACTIVITY_TONE = { send_success: 'ok', send_failed: 'danger', analysis_failed: 'danger', sync_failed: 'danger', webhook_rejected: 'danger', analysis: 'accent', webhook: 'accent', case_added: 'accent' };

const hashId = () => decodeURIComponent((location.hash.match(/^#\/case\/(.+)$/) || [])[1] || '');

// ---------- small pieces ----------

function Btn({ busy, icon, children, class: cls = '', ...rest }) {
  return html`<button type="button" class=${`btn ${cls}`} disabled=${busy || rest.disabled} ...${rest}>
    ${busy ? html`<span class="spinner"></span>` : icon ? icon() : null}${children}
  </button>`;
}

function DeadlineChip({ deadline, now }) {
  if (deadline.urgency === 'closed') return html`<span class="chip">Resolved</span>`;
  if (deadline.waitingOn) return html`<span class="chip"><${Icon.clock} />${waitingLabel[deadline.waitingOn]}</span>`;
  if (!deadline.dueAt) return html`<span class="chip">No date from PayPal</span>`;
  return html`<span class=${`chip ${urgencyTone[deadline.urgency]}`}><${Icon.clock} />${fmtRemaining(deadline.dueAt, now)}${deadline.isEstimate ? ' (est.)' : ''}</span>`;
}

function StrengthChip({ strength }) {
  if (!strength) return null;
  const tone = { weak: 'danger', moderate: 'warn', strong: 'ok' }[strength.label] || '';
  return html`<span class=${`chip ${tone}`}>${Math.round(strength.score)} · ${strength.label}</span>`;
}

function Modal({ title, onClose, wide, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
    <div class=${`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label=${title}>
      <header><h2>${title}</h2><${Btn} class="ghost sm" icon=${Icon.x} onClick=${onClose} aria-label="Close" /></header>
      <div class="body">${children}</div>
      ${footer ? html`<footer>${footer}</footer>` : null}
    </div>
  </div>`;
}

function ActivityList({ items, showCase }) {
  if (!items.length) return html`<p class="muted small">Nothing yet.</p>`;
  return html`<ul class="timeline">
    ${items.map(
      (a) => html`<li key=${a.id} class=${ACTIVITY_TONE[a.type] || ''}>
        <div class="pre">${a.summary}</div>
        <div class="when">${fmtDate(a.at)}${showCase && a.caseId ? html` · <span class="mono">${a.caseId}</span>` : null}</div>
      </li>`,
    )}
  </ul>`;
}

// ---------- left column ----------

function CaseList({ cases, selectedId, now, onSelect, onAdd, adding, demoCaseId, loaded }) {
  const [value, setValue] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    if (await onAdd(value.trim())) setValue('');
  };
  const hasDemo = cases.some((c) => c.id === demoCaseId);
  return html`
    <div class="section-label">Add a case</div>
    <form class="add-form" onSubmit=${submit}>
      <input class="input mono" placeholder="PP-R-XXX-00000000" aria-label="PayPal dispute ID" value=${value} onInput=${(e) => setValue(e.target.value)} />
      <button class="btn primary" type="submit" disabled=${adding || !value.trim()}>${adding ? html`<span class="spinner"></span>` : 'Add'}</button>
    </form>
    <p class="faint small">Paste a dispute ID from PayPal. New disputes also arrive here by webhook.</p>

    <div class="row between" style="margin-top:18px">
      <div class="section-label">Cases by urgency</div>
      ${cases.length ? html`<span class="faint small">${cases.length}</span>` : null}
    </div>
    ${!loaded
      ? html`<div class="case-list"><div class="skeleton sk-block"></div><div class="skeleton sk-block"></div></div>`
      : cases.length === 0
        ? html`<div class="empty">
            <${Icon.shieldOutline} />
            <h3>No cases yet</h3>
            <p>Add a dispute by its ID, or load the sandbox demo case to see how it works.</p>
            <${Btn} class="primary" busy=${adding} onClick=${() => onAdd(demoCaseId, true)}>Add the demo case<//>
          </div>`
        : html`<div class="case-list">
            ${cases.map(
              (c) => html`<button key=${c.id} type="button" class=${`case-card ${c.id === selectedId ? 'active' : ''}`} onClick=${() => onSelect(c.id)}>
                <div class="row between">
                  <span class="title grow">${c.reasonLabel}</span>
                  <span class="amount">${fmtMoney(c.amount)}</span>
                </div>
                <div class="meta"><span class="mono">${c.id}</span>${c.buyerName ? ` · ${c.buyerName}` : ''}</div>
                <div class="chips">
                  <${DeadlineChip} deadline=${c.deadline} now=${now} />
                  <span class="chip outline">${humanize(c.stage)}</span>
                  <${StrengthChip} strength=${c.strength} />
                </div>
              </button>`,
            )}
          </div>
          ${!hasDemo ? html`<${Btn} class="ghost sm block" style="margin-top:10px" busy=${adding} onClick=${() => onAdd(demoCaseId, true)}>Add the demo case<//>` : null}`}
  `;
}

// ---------- center column ----------

function Fact({ k, children, mono }) {
  return html`<div class="fact"><div class="k">${k}</div><div class=${`v ${mono ? 'mono' : ''}`}>${children}</div></div>`;
}

function EvidenceLocker({ detail, config, run, busy }) {
  const [type, setType] = useState('delivery_proof');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const limits = config.limits;

  const add = async (e) => {
    e.preventDefault();
    const ok = await run('evidence', async () => {
      if (file && file.size > limits.maxFileBytes) throw new Error(`File is too large (max ${fmtBytes(limits.maxFileBytes)}).`);
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
    <h3>Evidence locker <span class="count">${detail.evidence.length}</span></h3>
    ${detail.evidence.length === 0
      ? html`<p class="muted small">Nothing here yet. Add delivery proof, tracking, chat transcripts or invoices. The AI reads text files and images; everything stays on this server until you approve a response.</p>`
      : detail.evidence.map(
          (ev) => html`<div class="ev-item" key=${ev.id}>
            <span class="chip accent">${config.evidenceTypes[ev.type] || ev.type}</span>
            <div class="grow">
              ${ev.file
                ? html`<a href=${`/api/cases/${detail.id}/evidence/${ev.id}/file`} target="_blank" rel="noopener">${ev.file.name}</a>
                    <span class="faint small"> · ${fmtBytes(ev.file.size)}</span>`
                : null}
              ${ev.note ? html`<div class="pre small">${ev.note}</div>` : null}
              <div class="faint small">Added ${fmtDate(ev.addedAt)}</div>
            </div>
            <${Btn} class="ghost sm" icon=${Icon.x} aria-label="Remove evidence" title="Remove" disabled=${busy.evidence}
              onClick=${() => run('evidence', () => call('DELETE', `/cases/${detail.id}/evidence/${ev.id}`), 'Evidence removed')} />
          </div>`,
        )}

    <form class="ev-form" onSubmit=${add}>
      <label class="field">Type
        <select class="input" value=${type} onChange=${(e) => setType(e.target.value)}>
          ${Object.entries(config.evidenceTypes).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
        </select>
      </label>
      <label class="field">File (optional, max ${fmtBytes(limits.maxFileBytes)})
        <input ref=${fileRef} type="file" accept=".txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.pdf" onChange=${(e) => setFile(e.target.files[0] || null)} />
      </label>
      <label class="field full">Note
        <textarea class="input" rows="2" maxlength=${limits.maxNoteChars} placeholder="What does this prove? e.g. Courier scan shows delivery on 12 Nov." value=${note} onInput=${(e) => setNote(e.target.value)}></textarea>
      </label>
      <div class="full row between wrap">
        <span class="faint small">TXT, MD, CSV, PNG, JPG, WEBP, GIF or PDF.</span>
        <div class="row">
          ${detail.id === config.demoCaseId
            ? html`<${Btn} class="sm" busy=${busy.evidence} onClick=${() => run('evidence', () => call('POST', `/cases/${detail.id}/evidence/samples`), 'Sample evidence added')}>Add sample evidence<//>`
            : null}
          <button class="btn primary sm" type="submit" disabled=${busy.evidence || (!note.trim() && !file)}>${busy.evidence ? html`<span class="spinner"></span>` : html`<${Icon.plus} />`}Add evidence</button>
        </div>
      </div>
    </form>
  </section>`;
}

function CaseDetail({ detail, config, now, run, busy, onRemove }) {
  const d = detail.dispute;
  const dl = detail.deadline;
  const txn = d.transactions[0];
  const items = d.transactions.flatMap((t) => t.items);
  return html`<div class="detail">
    <section class="card case-head">
      <div class="row between wrap">
        <div class="grow">
          <div class="faint small mono">${d.id}</div>
          <h1>${d.reasonLabel}</h1>
        </div>
        <div class="amount">${fmtMoney(d.amount)}</div>
      </div>
      <div class="row between wrap" style="margin-top:2px">
        <div class="chips">
          <span class=${`chip ${d.status === 'RESOLVED' ? '' : d.status === 'WAITING_FOR_SELLER_RESPONSE' ? 'warn' : 'accent'}`}>${humanize(d.status)}</span>
          <span class="chip outline">Stage: ${humanize(d.stage)}</span>
          <span class="chip outline">State: ${humanize(d.state)}</span>
          ${d.outcome ? html`<span class="chip">Outcome: ${humanize(d.outcome)}</span>` : null}
        </div>
        <div class="row" style="margin-top:10px">
          <span class="faint small">Synced ${fmtAgo(detail.syncedAt, now)}</span>
          <${Btn} class="sm" icon=${Icon.sync} busy=${busy.sync} onClick=${() => run('sync', () => call('POST', `/cases/${detail.id}/sync`), 'Synced with PayPal')}>Sync<//>
          <${Btn} class="ghost sm" onClick=${onRemove} title="Remove this case from Dispute Defender only">Stop tracking<//>
        </div>
      </div>

      <div class=${`deadline ${dl.urgency}`}>
        <${Icon.clock} />
        <div class="grow">
          ${dl.waitingOn
            ? html`<div class="big">${waitingLabel[dl.waitingOn]}${dl.dueAt ? html` · inquiry window ends ${fmtDate(dl.dueAt)} <span class="chip">Estimate</span>` : null}</div>`
            : dl.dueAt
            ? html`<div class="big">Respond by ${fmtDate(dl.dueAt)} · ${fmtRemaining(dl.dueAt, now)}${dl.isEstimate ? html` <span class="chip warn">Estimate</span>` : null}</div>`
            : html`<div class="big">${dl.urgency === 'closed' ? 'No response due' : 'No response date available'}</div>`}
          <div class="small muted">${dl.basis}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <h3>Case facts</h3>
      <div class="facts">
        <${Fact} k="Buyer">${d.buyer.name || '—'}${d.buyer.email ? html`<div class="small muted">${d.buyer.email}</div>` : null}<//>
        <${Fact} k="Seller">${d.seller.name || '—'}${d.seller.email ? html`<div class="small muted">${d.seller.email}</div>` : null}<//>
        <${Fact} k="Seller transaction" mono>${txn?.sellerTransactionId || '—'}<//>
        <${Fact} k="Buyer transaction" mono>${txn?.buyerTransactionId || '—'}<//>
        <${Fact} k="Paid">${fmtDate(txn?.createdAt)}<//>
        <${Fact} k="Dispute opened">${fmtDate(d.createdAt)}<//>
        <${Fact} k="Buyer asks for">${fmtMoney(d.buyerRequestedAmount)}<//>
        <${Fact} k="Refund allowed up to">${fmtMoney(d.allowedRefundAmount)}<//>
        <${Fact} k="Seller protection">${txn?.sellerProtectionEligible === null || !txn ? '—' : txn.sellerProtectionEligible ? 'Eligible' : 'Not eligible'}<//>
        <${Fact} k="Channel">${humanize(d.channel)}<//>
        <${Fact} k=${items.length > 1 ? 'Items' : 'Item'}>${items.length ? items.map((i) => html`<div>${i.name || 'Unnamed item'}${i.quantity ? ` × ${i.quantity}` : ''}${i.type ? html` <span class="faint small">(${humanize(i.type)})</span>` : null}</div>`) : '—'}<//>
        <${Fact} k="PayPal allows now">${d.allowedActions.length ? html`<div class="row wrap" style="gap:5px;margin-top:3px">${d.allowedActions.map((a) => html`<span class="chip">${detail.actionLabels[a]}</span>`)}</div>` : 'No seller actions open'}<//>
      </div>
    </section>

    <section class="card">
      <h3>Messages <span class="count">${d.messages.length}</span></h3>
      ${d.messages.length === 0
        ? html`<p class="muted small">No messages on this case.</p>`
        : html`<div class="thread">
            ${d.messages.map((m) => html`<div class=${`bubble ${m.postedBy === 'SELLER' ? 'seller' : ''}`}>
              <div class="who">${m.postedBy} · ${fmtDate(m.at)}</div>
              <div class="pre">${m.content}</div>
            </div>`)}
          </div>`}
    </section>

    <section class="card">
      <h3>PayPal evidence trail <span class="count">${d.evidences.length}</span></h3>
      ${d.evidences.length === 0
        ? html`<p class="muted small">PayPal has not recorded any evidence on this case.</p>`
        : html`<ul class="timeline">
            ${d.evidences.map((e) => html`<li class=${e.source === 'REQUESTED_FROM_SELLER' ? 'danger' : ''}>
              <div><strong>${humanize(e.type)}</strong> <span class="muted">· ${humanize(e.source)}</span></div>
              ${e.notes ? html`<div class="pre small">${e.notes}</div>` : null}
              <div class="when">${fmtDate(e.at)}${e.stage ? ` · ${humanize(e.stage)}` : ''}</div>
            </li>`)}
          </ul>`}
    </section>

    <${EvidenceLocker} detail=${detail} config=${config} run=${run} busy=${busy} />

    <section class="card">
      <h3>Case history <span class="count">${detail.history.length}</span></h3>
      <${ActivityList} items=${detail.history} />
    </section>
  </div>`;
}

// ---------- right column: AI analysis + approval ----------

function Gauge({ score, label }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  return html`<div class="gauge">
    <svg viewBox="0 0 92 92"><circle class="track" cx="46" cy="46" r=${r} /><circle class=${`bar tone-${label}`} cx="46" cy="46" r=${r} stroke-dasharray=${c} stroke-dashoffset=${c * (1 - pct / 100)} /></svg>
    <div class=${`num tone-${label}`}>${Math.round(pct)}<small>of 100</small></div>
  </div>`;
}

function SendResult({ result, onFallback, labels }) {
  if (!result) return null;
  if (result.ok) {
    return html`<div class="notice ok"><${Icon.check} /><div><strong>PayPal accepted it.</strong> "${labels[result.action]}" returned HTTP ${result.status}. The case has been re-synced.</div></div>`;
  }
  const e = result.error;
  return html`<div class="stack">
    <div class="notice danger"><${Icon.alert} />
      <div>
        <strong>Not sent. PayPal refused "${labels[result.action]}".</strong>
        <div>${e.plain}</div>
        <div class="small mono" style="margin-top:6px">${[e.status ? `HTTP ${e.status}` : null, e.name, e.issue].filter(Boolean).join(' · ')}</div>
        ${e.message ? html`<div class="small muted">PayPal said: ${e.message}</div>` : null}
        ${e.debugId ? html`<div class="small faint">Debug ID: <span class="mono">${e.debugId}</span></div>` : null}
      </div>
    </div>
    <${Btn} class="block" icon=${Icon.external} onClick=${onFallback}>Copy response + open Resolution Center<//>
  </div>`;
}

function AnalysisPanel({ detail, config, run, busy, toast, refresh }) {
  const a = detail.analysis?.result;
  const d = detail.dispute;
  const [draft, setDraft] = useState(detail.draft);
  const [action, setAction] = useState('send-message');
  const [offer, setOffer] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const max = config.limits.maxMessageChars;

  // Reset the editor when a different case or a fresh analysis arrives.
  useEffect(() => {
    setDraft(detail.draft);
    setResult(null);
    const rec = a ? RECOMMENDED_TO_ACTION[a.recommendedAction.action] : 'send-message';
    setAction(rec);
    setOffer(d.allowedRefundAmount?.value || d.amount?.value || '');
  }, [detail.id, detail.analysis?.at]);

  const saveDraft = () => {
    if (draft !== detail.draft && draft.length <= max) call('PUT', `/cases/${detail.id}/draft`, { draft }).then(refresh).catch((e) => toast(e.message, true));
  };
  const copy = async () => {
    if (await copyText(draft)) {
      toast('Response copied');
      call('POST', `/cases/${detail.id}/copied`).then(refresh).catch(() => {});
      return true;
    }
    toast('Could not copy. Select the text and copy it manually.', true);
    return false;
  };
  const send = async () => {
    setConfirming(false);
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

  const stale = a && (detail.evidence.some((e) => e.addedAt > detail.analysis.at) || detail.history.some((h) => h.type === 'evidence_removed' && h.at > detail.analysis.at));
  const attachable = detail.evidence.filter((e) => e.paypalAttachable);
  const allowed = d.allowedActions.includes(action);
  const analyzeBtn = (label, cls = 'primary') =>
    html`<${Btn} class=${cls} icon=${Icon.spark} busy=${busy.analyze} disabled=${!config.ai.configured}
      onClick=${() => run('analyze', () => call('POST', `/cases/${detail.id}/analyze`), 'Analysis ready')}>${label}<//>`;

  return html`
    <div class="panel-head">
      <h2><${Icon.spark} /> AI case analysis</h2>
      ${a && !busy.analyze ? analyzeBtn('Re-analyze', 'sm') : null}
    </div>

    ${!config.ai.configured ? html`<div class="notice warn" style="margin-bottom:14px"><${Icon.alert} /><div><strong>AI is not configured.</strong> ${config.ai.problem}</div></div>` : null}

    ${busy.analyze
      ? html`<div aria-busy="true">
          <p class="muted small" style="margin-bottom:14px">Reading the case and ${detail.evidence.length} evidence item${detail.evidence.length === 1 ? '' : 's'}…</p>
          <div class="skeleton sk-block"></div>
          ${[92, 100, 78, 96, 64, 88].map((w) => html`<div class="skeleton sk-line" style=${`width:${w}%`}></div>`)}
        </div>`
      : !a
        ? html`<div class="empty">
            <${Icon.spark} />
            <h3>Not analysed yet</h3>
            <p>The AI reads the PayPal case and your evidence locker, scores how strong your position is, lists the proof you are missing and drafts a response for you to review.</p>
            ${analyzeBtn(detail.evidence.length ? 'Analyze case' : 'Analyze without evidence')}
            ${detail.evidence.length === 0 ? html`<p class="small" style="margin-top:12px">Tip: add evidence first for a stronger, more specific draft.</p>` : null}
          </div>`
        : html`
            ${stale ? html`<div class="notice warn" style="margin-bottom:14px"><${Icon.info} /><div><strong>Evidence changed since this analysis.</strong> Re-analyze to update the score and draft.</div></div>` : null}
            <div class="strength">
              <${Gauge} score=${a.strength.score} label=${a.strength.label} />
              <div>
                <div class="faint small">${a.disputeType}</div>
                <div class=${`label tone-${a.strength.label}`}>${a.strength.label} case</div>
                <div class="small">${a.strength.reasoning}</div>
              </div>
            </div>

            <div class="panel-block">
              <h3>Recommended next step</h3>
              <div class="action-card">
                <div class="a">${RECOMMENDED_LABEL[a.recommendedAction.action]}</div>
                <div class="small" style="margin-top:4px">${a.recommendedAction.rationale}</div>
                <div class="small muted" style="margin-top:6px"><strong>Trade-offs:</strong> ${a.recommendedAction.tradeoffs}</div>
              </div>
            </div>

            <div class="panel-block">
              <h3>Missing evidence <span class="count">${a.missingEvidence.length}</span></h3>
              ${a.missingEvidence.length === 0
                ? html`<p class="small muted">Nothing important is missing, based on what is on file.</p>`
                : html`<div class="missing">${a.missingEvidence.map((m) => html`<div class="m">
                    <div class="t"><span>${m.item}</span><span class=${`chip ${{ high: 'danger', medium: 'warn', low: '' }[m.priority]}`}>${m.priority}</span></div>
                    <div class="small muted">${m.why}</div>
                  </div>`)}</div>`}
            </div>

            <div class="panel-block">
              <h3>What PayPal needs for this dispute</h3>
              <ul class="small">${a.whatPayPalNeeds.map((w) => html`<li>${w}</li>`)}</ul>
            </div>

            ${a.assumptions.length
              ? html`<div class="panel-block"><h3>Assumptions the AI made</h3><ul class="small muted">${a.assumptions.map((w) => html`<li>${w}</li>`)}</ul></div>`
              : null}

            <div class="panel-block">
              <h3>Your response <span class="count">draft, edit freely</span></h3>
              <div class="stack">
                <textarea class="input draft" value=${draft} onInput=${(e) => setDraft(e.target.value)} onBlur=${saveDraft} aria-label="Response draft"></textarea>
                <div class="row between">
                  <span class="faint small">Check every fact before you approve.</span>
                  <span class=${`counter ${draft.length > max ? 'over' : ''}`}>${draft.length} / ${max}</span>
                </div>
                <label class="field">Send via PayPal as
                  <select class="input" value=${action} onChange=${(e) => { setAction(e.target.value); setResult(null); }}>
                    ${Object.entries(detail.actionLabels).map(([k, label]) => html`<option value=${k}>${label}${d.allowedActions.includes(k) ? '' : ' (not open now)'}</option>`)}
                  </select>
                </label>
                ${action === 'make-offer'
                  ? html`<label class="field">Refund offer (${d.amount?.currency || 'USD'})
                      <input class="input" inputmode="decimal" value=${offer} onInput=${(e) => setOffer(e.target.value)} />
                    </label>`
                  : null}
                ${action === 'provide-evidence'
                  ? html`<p class="small muted">Sends the text above as the evidence note${attachable.length ? html`, with ${attachable.length} attachment${attachable.length === 1 ? '' : 's'} (${attachable.map((e) => e.file.name).join(', ')})` : ''}. PayPal accepts JPG, PNG, GIF and PDF attachments; text files stay in the locker.</p>`
                  : null}
                ${!allowed && !result ? html`<div class="notice warn"><${Icon.info} /><div>PayPal does not list this action as open for the case right now. You can still try; any refusal is shown here.</div></div>` : null}
                <div class="row">
                  <${Btn} class="primary grow" icon=${Icon.send} busy=${busy.send} disabled=${!draft.trim() || draft.length > max} onClick=${() => setConfirming(true)}>Approve & send<//>
                  <${Btn} icon=${Icon.copy} disabled=${!draft.trim()} onClick=${copy}>Copy response<//>
                </div>
                <${SendResult} result=${result} onFallback=${fallback} labels=${detail.actionLabels} />
              </div>
            </div>

            <p class="human-note">Analysed ${fmtDate(detail.analysis.at)} by ${detail.analysis.model} (${detail.analysis.provider}). The AI drafts; you decide. Nothing is sent without your approval.</p>
          `}

    ${confirming
      ? html`<${Modal} title="Approve and send to PayPal?" onClose=${() => setConfirming(false)}
          footer=${html`<${Btn} onClick=${() => setConfirming(false)}>Cancel<//><${Btn} class=${action === 'accept-claim' ? 'danger' : 'primary'} icon=${Icon.send} onClick=${send}>Yes, send it<//>`}>
          <div class="stack">
            <div>Action: <strong>${detail.actionLabels[action]}</strong> on case <span class="mono">${detail.id}</span></div>
            ${action === 'accept-claim' ? html`<div class="notice danger"><${Icon.alert} /><div><strong>This refunds the buyer in full and closes the case.</strong> It cannot be undone.</div></div>` : null}
            ${action === 'escalate' ? html`<div class="notice warn"><${Icon.alert} /><div><strong>This turns the inquiry into a claim.</strong> PayPal will decide the outcome.</div></div>` : null}
            ${action === 'make-offer' ? html`<div>Refund offer: <strong>${offer} ${d.amount?.currency || 'USD'}</strong></div>` : null}
            <div class="quote pre">${draft}</div>
            <p class="small muted">This goes to PayPal exactly as written. You are responsible for its accuracy.</p>
          </div>
        <//>`
      : null}
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
  return html`<form class="card login stack" onSubmit=${submit}>
    <div class="brand"><${Icon.shield} /> Dispute Defender</div>
    <p class="muted small">This demo is protected by a shared password.</p>
    <input class="input" type="password" placeholder="Password" aria-label="Password" autofocus value=${password} onInput=${(e) => setPassword(e.target.value)} />
    ${error ? html`<div class="notice danger"><${Icon.alert} /><div>${error}</div></div>` : null}
    <button class="btn primary" type="submit" disabled=${busy || !password}>${busy ? html`<span class="spinner"></span>` : null}Enter</button>
  </form>`;
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
      toast(out.created ? 'Case added' : 'Case already tracked; synced');
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
      toast('Case removed from Dispute Defender');
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

  if (bootError) return html`<div class="empty big"><${Icon.alert} /><h3>Cannot reach the server</h3><p>${bootError}</p><${Btn} class="primary" onClick=${() => location.reload()}>Retry<//></div>`;
  if (!session) return html`<div class="boot">Loading Dispute Defender…</div>`;
  if (!session.authed) return html`<${Login} onDone=${loadSession} />`;
  const config = session.config;

  return html`<div class="shell">
    <header class="topbar">
      <div class="brand"><${Icon.shield} /> Dispute Defender</div>
      <span class="tagline">Evidence-first dispute defence for small sellers</span>
      <div class="grow"></div>
      <span class="chip warn" title="All PayPal calls go to the sandbox">PayPal sandbox</span>
      <span class=${`chip ${config.webhookConfigured ? 'ok' : ''}`} title=${config.webhookConfigured ? 'Webhook signature verification is configured' : 'PAYPAL_WEBHOOK_ID is not set; add cases by ID'}>Webhooks ${config.webhookConfigured ? 'on' : 'off'}</span>
      <${Btn} class="sm" icon=${Icon.list} onClick=${openFeed}>Activity<//>
    </header>

    ${!config.paypalConfigured ? html`<div class="notice danger" style="border-radius:0"><${Icon.alert} /><div><strong>PayPal credentials are missing.</strong> Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET on the server.</div></div>` : null}

    <div class="columns">
      <aside class="col col-left">
        <${CaseList} cases=${cases} selectedId=${selectedId} now=${now} onSelect=${select} onAdd=${addCase} adding=${busy.add} demoCaseId=${config.demoCaseId} loaded=${casesLoaded} />
      </aside>
      <main class="col">
        ${detail
          ? html`<${CaseDetail} detail=${detail} config=${config} now=${now} run=${run} busy=${busy} onRemove=${() => setRemoving(true)} />`
          : detailError
            ? html`<div class="empty big"><${Icon.alert} /><h3>Could not open this case</h3><p>${detailError}</p><${Btn} onClick=${() => select('')}>Back to cases<//></div>`
            : selectedId
              ? html`<div class="detail"><div class="skeleton sk-block" style="height:170px"></div><div class="skeleton sk-block" style="height:150px"></div><div class="skeleton sk-block"></div></div>`
              : html`<div class="empty big">
                  <${Icon.shieldOutline} />
                  <h3>${cases.length ? 'Select a case' : 'Defend your first dispute'}</h3>
                  <p>${cases.length
                    ? 'Pick a case on the left to see the PayPal details, your evidence locker and the AI analysis.'
                    : 'Dispute Defender pulls a PayPal dispute, checks your evidence, tells you what proof is missing and drafts a response. You approve everything before it is sent.'}</p>
                </div>`}
      </main>
      <aside class="col col-right">
        ${detail
          ? html`<${AnalysisPanel} detail=${detail} config=${config} run=${run} busy=${busy} toast=${toast} refresh=${() => loadDetail(selectedRef.current)} />`
          : html`<div class="panel-head"><h2><${Icon.spark} /> AI case analysis</h2></div>
              <p class="muted small">Select a case to see its strength score, missing evidence, recommended next step and a draft response.</p>
              <p class="faint small" style="margin-top:10px">Model: ${config.ai.configured ? `${config.ai.model} (${config.ai.provider})` : 'not configured'}</p>`}
      </aside>
    </div>

    ${feed ? html`<${Modal} title="Activity feed" wide onClose=${() => setFeed(null)}>
      <p class="muted small" style="margin-bottom:14px">Every sync, analysis, send attempt and PayPal webhook delivery, newest first.</p>
      <${ActivityList} items=${feed} showCase />
    <//>` : null}

    ${removing ? html`<${Modal} title="Stop tracking this case?" onClose=${() => setRemoving(false)}
      footer=${html`<${Btn} onClick=${() => setRemoving(false)}>Cancel<//><${Btn} class="danger" onClick=${removeCase}>Stop tracking<//>`}>
      <p>This removes <span class="mono">${selectedId}</span>, its evidence locker and analysis from Dispute Defender. Nothing changes at PayPal, and you can add the case again by ID.</p>
    <//>` : null}

    <div class="toasts" role="status" aria-live="polite">${toasts.map((t) => html`<div key=${t.id} class=${`toast ${t.error ? 'error' : ''}`}>${t.text}</div>`)}</div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
