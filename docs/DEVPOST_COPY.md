# Devpost copy (ready to paste)

Fill in the three links at the bottom before submitting. Everything here matches what the app really does as
of the 11 Nov 2026 sandbox run; if the webhook test changes the picture, update the two marked lines.

---

## Project name

Dispute Defender

## Tagline (short)

Evidence-first PayPal dispute defence for small sellers: AI finds the gaps and drafts the reply, you approve it.

## Elevator pitch (about 200 characters)

Small sellers lose PayPal disputes they should win. Dispute Defender pulls the case, scores your evidence, lists the proof you are missing, tracks the deadline and drafts a response you approve.

---

## Inspiration

Small sellers and freelancers keep telling the same story: a buyer opens a dispute, the seller has the
receipts, and the seller still loses. One PayPal Community thread is titled "We lost a dispute that we had
complete documentation about". UK Financial Ombudsman decisions have found cases where relevant evidence was
not considered. And PayPal's own documentation gives buyer and seller a 20-day window on an inquiry before it
can escalate, a deadline many one-person businesses only discover after it has passed, while the money sits
on hold.

Big merchants have chargeback teams. A freelancer has an inbox. We wanted to give that freelancer a calm,
honest assistant that knows what PayPal needs, sees what is missing and never acts without permission.

## What it does

Dispute Defender is a web dashboard for a seller's PayPal disputes.

- **Pulls the case from PayPal** by dispute ID or by webhook: reason, amount, stage, messages, PayPal's
  evidence trail, refund amounts, and which actions PayPal allows right now.
- **Tracks the deadline** with a countdown and sorts cases by urgency. If PayPal does not supply a response
  date, it shows a clearly labelled estimate.
- **Keeps an evidence locker** per case: delivery proof, tracking, chat transcripts, invoices, with notes and
  file uploads.
- **Runs an AI analysis** of the case plus the evidence: a 0-100 strength score with reasoning, what PayPal
  typically needs for this dispute type, a prioritised list of missing proof, a recommended next step (refund,
  contest, ask the buyer, escalate) with trade-offs, the assumptions it made, and a draft response.
- **Keeps the human in charge.** The draft is editable. "Approve & send" asks for confirmation and only then
  calls the PayPal Disputes API. The AI never sends anything on its own.
- **Tells the truth about the result.** Success is shown only when PayPal returns 2xx. If PayPal refuses, the
  seller sees the exact error code, a plain-English explanation and a one-click fallback: copy the response
  and open the Resolution Center.
- **Logs everything**: syncs, analyses, edits, send attempts and webhook deliveries.

In our sandbox run, a seller message and an evidence submission were both drafted by the AI, approved by a
person, accepted by PayPal (HTTP 200) and then visible on the PayPal case.

## How we built it

- **PayPal:** Disputes API (`GET /v1/customer/disputes/{id}`, `send-message`, `provide-evidence`, `make-offer`,
  `escalate`, `accept-claim`), webhook signature verification
  (`POST /v1/notifications/verify-webhook-signature`), OAuth client credentials, and Orders v2 to create and
  capture the sandbox payment that gets disputed. The actions offered in the UI come from the HATEOAS links
  PayPal returns on each dispute.
- **AI:** one reasoning step behind a provider-agnostic interface with adapters for Google Gemini, Anthropic
  Claude and OpenAI-compatible endpoints. The demo runs on Gemini 2.5 Flash. The model receives the normalised
  dispute and the evidence (text as text, images as images) and must return JSON that we validate with zod and
  retry once if invalid. The system prompt forbids inventing facts, requires missing proof and assumptions to
  be listed, and treats dispute messages and uploads as untrusted data, not instructions.
- **App:** Node.js 22, TypeScript, Express. The dashboard is Preact + htm served as plain ES modules with no
  bundler. Storage is a JSON file with atomic writes. Unit tests with Vitest.
- **Hosting:** Render, from a `render.yaml` blueprint with a health check.
- **Built with Claude Code:** the code, tests and documentation were written with Anthropic's Claude Code
  from a written build brief, with every PayPal behaviour checked against the real sandbox.

## Challenges we ran into

- **The sandbox does not behave like the docs suggest.** Creating a dispute through the API was refused for
  our app, and the list-disputes endpoint returned nothing while a case existed. We redesigned intake around
  dispute IDs and webhooks, and the buyer opens disputes in the sandbox Resolution Center.
- **Allowed actions depend on a state that moves by itself.** The same `send-message` call was refused with
  `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE` in one state and accepted minutes later in another. We now read
  the allowed actions from PayPal's links, show them in the UI, and treat every refusal as a first-class,
  explained outcome with a fallback.
- **Evidence types matter.** Evidence sent as type `OTHER` was refused; the type PayPal had requested
  (`PROOF_OF_FULFILLMENT`) was accepted. The app now submits the type PayPal asks for.
- **Free-tier model reliability.** One Gemini alias hung for over a minute and others returned 503 under load.
  We added timeouts, a fallback model and clear error states.
- **Untrusted text everywhere.** Dispute messages are written by the other party, so both the UI (escaping,
  strict CSP) and the AI step (data fencing, explicit rules) treat them as hostile.

## Accomplishments that we're proud of

- A complete loop that works against the real PayPal sandbox: case in, evidence in, AI analysis, human
  approval, PayPal accepts, case re-synced, all audited.
- Honest failure handling. The app never claims a send succeeded unless PayPal said so.
- A draft that only cites evidence actually on file, and a list of what is missing instead of confident
  guesses.
- A calm, familiar-feeling dashboard that works down to phone width, with no front-end build step.

## What we learned

- For dispute tooling, the hard part is not generating text. It is knowing what evidence a given dispute type
  needs, what state the case is in, and what PayPal will accept right now.
- Human approval is a feature, not a limitation. Sellers are accountable for what they send, so the AI's job
  is to prepare, explain and flag gaps.
- Verify every API assumption against the sandbox early. Three of ours were wrong.

## What's next for Dispute Defender

- Verify file attachments on evidence submissions and the remaining actions (offer, escalate, accept) on
  fresh sandbox cases.
- Confirm webhook delivery end to end and add deadline reminders by email. _(update after the webhook test)_
- Evidence checklists per dispute reason, filled in automatically from shipping carriers and order systems.
- A read-only "hold risk" view from PayPal Transaction Search to warn about patterns that tend to trigger
  reviews.
- Multi-seller accounts with a real database and "Log in with PayPal".

## Built with

`paypal` `paypal-disputes-api` `paypal-orders-api` `paypal-webhooks` `node.js` `typescript` `express`
`preact` `zod` `google-gemini` `claude` `claude-code` `render` `vitest`

## AI tools used and how (required disclosure)

- **Google Gemini 2.5 Flash** (via the Gemini API) performs the in-app case analysis and drafts the seller's
  response. Output is schema-validated and always reviewed and approved by a person before anything is sent.
- **Anthropic Claude** is supported as an alternative in-app provider (adapter included, not used in the demo).
- **Claude Code** (Anthropic) was used to write the application code, tests and documentation.

## Links

- Repository: https://github.com/VigneshwaranKbgv/dispute-defender
- Live demo: _Render URL_
- Video: _YouTube URL_

## Testing instructions for judges

1. Open the live demo (password, if set: _fill in_).
2. Click **Add the demo case**, then **Use sample evidence**, then **Review this case**.
3. Edit the suggested response and click **Approve & send**, then **Send to PayPal**, to see PayPal's real response.
4. To open a new dispute, use the sandbox buyer login in the README and follow "Reproduce a sandbox dispute".
