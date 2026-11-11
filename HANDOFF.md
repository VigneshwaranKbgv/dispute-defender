# Handoff: what is done and what is left for you

Deadline: **Thu 12 Nov 2026, 12:00 pm PT = Fri 13 Nov, 1:30 am IST.** Aim to submit on the evening of 12 Nov IST.

## State of the project (11 Nov, evening IST)

Working and verified in a real browser against the PayPal sandbox:

- Add case by ID, sync, urgency list, case detail, deadline (PayPal date or labelled estimate).
- Evidence locker with text and image uploads, plus one-click sample evidence on the demo case.
- AI analysis on Gemini (`gemini-2.5-flash`), schema-validated, including an image.
- Approve & send: **`send-message` returned HTTP 200** and **`provide-evidence` returned HTTP 200**; a refused
  attempt (400 `EVIDENCE_TYPE_IS_NOT_ALLOWED`) showed the plain-English error and the fallback.
- Activity feed, audit log, password gate, production build (`npm run build && npm start`).
- `npm test` (48 tests), `npm run typecheck`, `npm run lint`: all clean.

Not verified yet (stated in the README's Known limitations):

- **Webhooks end to end** (need the Render URL and webhook ID; steps 4-5 below).
- File attachments on `provide-evidence`; `make-offer`, `escalate`, `accept-claim` (not run because they are
  irreversible and there was one case).
- Anthropic and OpenAI-compatible adapters (no keys to test with).

Heads-up: the demo case `PP-R-BYM-10198930` now carries a real seller message and a real evidence submission
from testing. It still loads and analyses fine, but record the video on a **fresh dispute**.

## Your steps, in order

### 1. Review and clean up (5 min)

- `LICENSE`: I removed the angle brackets around your name ("Vigneshwaran K"). Change it if you want a
  different form.
- Delete the old `spike/` folder. Its scripts were ported to `scripts/` and it is git-ignored, but I was not
  permitted to delete it:

  ```bash
  rm -r spike
  ```

- `LICENSE.bak` and `.env.bak` are git-ignored. Delete them if you no longer need them.

### 2. Commit and push (needs your go-ahead)

Nothing has been committed. The folder is not a git repo yet. When you are ready, tell Claude "commit and
push", or run:

```bash
git init -b main
```

```bash
git add -A
```

```bash
git status
```

Check that `.env`, `data/`, `spike/` and `node_modules/` are **not** listed, then:

```bash
git commit -m "Dispute Defender: PayPal AI Hackathon entry"
```

```bash
git remote add origin https://github.com/VigneshwaranKbgv/dispute-defender.git
```

```bash
git push -u origin main
```

Then on GitHub: confirm the repo is **public** and that the **About** sidebar shows "MIT license". GitHub
detects it from the `LICENSE` file after the push.

### 3. Deploy on Render (10 min)

1. <https://dashboard.render.com> > **New > Blueprint** > pick the repo. It reads `render.yaml`.
2. Enter the secrets when prompted: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `GEMINI_API_KEY`, and an
   `APP_PASSWORD` of your choice (recommended, since the URL is public and can send sandbox actions). Leave
   `PAYPAL_WEBHOOK_ID` empty for now.
3. When it is live, open `https://<service>.onrender.com/healthz` (expect `{"ok":true,...}`), then the app.
   Click **Add the demo case** to confirm PayPal and the AI work there.

Free tier notes: the service sleeps after about 15 minutes idle (first request takes up to a minute), and the
disk resets on every deploy or restart, so cases need re-adding.

### 4. Register the webhook (5 min)

1. <https://developer.paypal.com/dashboard/applications/sandbox> > your app > **Webhooks > Add webhook**.
2. URL: `https://<service>.onrender.com/webhooks/paypal`.
3. Events: **Customer dispute created**, **Customer dispute updated**, **Customer dispute resolved**.
4. Copy the **Webhook ID** into Render's `PAYPAL_WEBHOOK_ID` (and into your local `.env` if you like). Render
   redeploys. The header then shows a "Webhook endpoint configured" badge (it is hidden when no webhook ID is set).

### 5. Test webhooks with a fresh dispute (10 min)

Open the Render app first so it is awake.

```bash
npm run sandbox:create-order
```

Open the printed link in a private window, pay as the sandbox buyer, then:

```bash
npm run sandbox:capture-order -- <ORDER_ID>
```

As the buyer, open <https://www.sandbox.paypal.com/resolutioncenter/> > Report a problem > that payment >
"I didn't receive my item".

Then watch the app for up to two minutes (the case list refreshes every 20 seconds) and open **Activity**:

- A "Webhook CUSTOMER.DISPUTE.CREATED received (verified)" entry and the case appearing = webhooks work.
- A "rejected" entry = the event arrived but verification failed; check `PAYPAL_WEBHOOK_ID`.
- Nothing = PayPal did not send it. Add the case by ID instead.

**Tell Claude the result** (or edit it yourself): the README "Known limitations" webhook bullet and the two
marked lines in `docs/DEVPOST_COPY.md` must say what really happened.

### 6. Fill in the judge details

In `README.md`: the live demo URL, the video URL, the sandbox buyer email and password (sandbox only), and the
demo password if you set one. Same links at the bottom of `docs/DEVPOST_COPY.md`.

### 7. Record the video (under 3:00)

Follow `docs/VIDEO_SCRIPT.md` (shot list, exact clicks, voice-over, recording checklist). Upload to YouTube as
**Public**.

Tip: to get the **Add the demo case** and **Use sample evidence** buttons for your fresh dispute, set
`DEMO_CASE_ID=<new case id>` in `.env` or on Render. The sample files mention the old transaction ID, and the
AI will notice, so for the video it is better to upload two files edited to match the new order.

To start the video with an empty app locally, stop the server and delete the `data` folder.

### 8. Submit on Devpost

Paste from `docs/DEVPOST_COPY.md`. Add the repo URL, demo URL, video URL and a few screenshots. Click
**Submit**, not just save draft. `SUBMISSION_CHECKLIST.md` has the final checks.

## Commands

| Command | Use |
| --- | --- |
| `npm run dev` | Local app on <http://localhost:3000> |
| `npm test` | Unit tests |
| `npm run typecheck` and `npm run lint` | Static checks |
| `npm run build` then `npm start` | Production build, as Render runs it |
| `npm run sandbox:create-order` | Step 1 of making a new sandbox dispute |
| `npm run sandbox:capture-order -- <ORDER_ID>` | Step 2 |
| `npm run sandbox:read-dispute -- <DISPUTE_ID>` | Print a dispute's state from the terminal |

## If something goes wrong

- **"The AI provider did not answer..." or a 503 message:** Gemini's free tier is busy. Click **Review this case** (or **Review again**) once more.
  To pin another model set `AI_MODEL` (for example `gemini-2.5-flash-lite`). Avoid `gemini-flash-latest`; it
  timed out in testing.
- **PayPal refuses an action:** click **Refresh from PayPal**. The sandbox changes a case's state by itself for a few
  minutes after it is opened or acted on. Use an action listed under "PayPal allows now".
- **Demo case will not load on your own sandbox app:** it belongs to the original seller account. Create a new
  dispute (step 5).
