# Demo video script

Target length **2:45** (hard limit 3:00). Public on YouTube. Screen recording with voice-over, 1080p.

Narration is about 370 words, which is roughly 2:35 at a calm pace. Rehearse once with a timer.

## Before you record: set up a fresh case

The demo case `PP-R-BYM-10198930` already has a seller message and evidence on it from testing, so record with
a **new dispute**. Do this 10 minutes before recording (the sandbox takes a few minutes to request evidence
from the seller).

1. `npm run sandbox:create-order`, open the approval link in a private window, pay as the sandbox buyer.
2. `npm run sandbox:capture-order -- <ORDER_ID>`.
3. Stay logged in as the buyer at <https://www.sandbox.paypal.com/resolutioncenter/>. Do **not** open the
   dispute yet; you will do that on camera.
4. Start Dispute Defender with a clean store: stop the server, delete the `data` folder, start again
   (`npm run dev`), or use the Render URL.
5. Have two evidence files ready that match the new order. Easiest: copy
   `docs/sample-evidence/delivery-confirmation.txt` and `chat-transcript.txt`, and replace the transaction ID
   and times with the new order's. (The "Add sample evidence" button only appears on the original demo case.)

## Shot list

| Time | On screen | Voice-over |
| --- | --- | --- |
| **0:00-0:20** Hook | Title card: "Dispute Defender". Then a slow scroll of the README problem section, or plain text slides. | "Small sellers lose PayPal disputes they should win. On PayPal's own community forum, one seller writes that they lost a dispute they had complete documentation for. Sellers don't know what proof counts, and an inquiry gives them twenty days before it can escalate, while their money is on hold. Dispute Defender fixes that." |
| **0:20-0:40** Buyer opens a dispute | Sandbox Resolution Center as the buyer: Report a problem, pick the payment, "I didn't receive my item", type "Service never delivered", submit. Show the case ID. | "Here's a buyer in the PayPal sandbox reporting that an order never arrived. For a freelancer, this is where the clock starts." |
| **0:40-1:00** Case appears | Dispute Defender. If webhooks work: the case appears on its own (wait for the list refresh). Otherwise paste the case ID into "Add a case" and click Add. Point at the deadline banner, amount, stage, "PayPal allows now". | "The case lands in Dispute Defender, pulled live from the PayPal Disputes API: the reason, the amount, the buyer's message, the deadline with a countdown, and the actions PayPal allows right now." |
| **1:00-1:20** Evidence | Evidence locker: choose "Delivery proof", attach the delivery file, add a one-line note, Add evidence. Repeat with the chat transcript. | "The seller drops their proof into the evidence locker: a delivery log and a chat where the buyer confirms they got the files." |
| **1:20-1:50** AI analysis | Click "Analyze case". Let the skeleton show for a second (cut the wait in editing). Then pause on: the score gauge, "Recommended next step", "Missing evidence", "What PayPal needs". | "One click, and the AI reads the case and the evidence. It scores the seller's position, explains why, recommends what to do, and lists any proof that's missing. It's told never to invent facts, and to treat everything the buyer wrote as data, not instructions." |
| **1:50-2:20** Approve and send | Scroll to "Your response". Edit one sentence by hand. Show "Send via PayPal as: Submit evidence to PayPal". Click "Approve & send", show the confirmation dialog, click "Yes, send it". Show the result banner. Then scroll the centre column to "PayPal evidence trail" and "Case history". | "It also drafts the response, but the seller is in charge. I can edit it, and nothing goes anywhere until I approve. PayPal accepts it, and the case updates. If PayPal refuses, the app says so, shows PayPal's exact error in plain English, and gives me a fallback. Every step is in the audit log." |
| **2:20-2:45** Close | Dashboard with the case list. Then the architecture diagram from the README. End card: project name, GitHub URL. | "Dispute Defender is built on the PayPal Disputes API, webhooks and Orders API, with an AI step that's validated and always human-approved. It gives a one-person business what big merchants already have: someone who knows what evidence wins, and never misses the deadline. Next up: reminders, carrier integrations, and hold-risk warnings." |

### If PayPal refuses the send on camera

That is fine, and honest. Say: "PayPal isn't accepting that action in this state, and the app tells me exactly
why." Click **Copy response + open Resolution Center**, or press **Sync**, pick the action PayPal lists as
open and send again. Do not cut the refusal out and imply a success.

### What to say about the AI model

The demo runs on Google Gemini 2.5 Flash (shown at the bottom of the analysis panel). Do not say it is Claude
in the voice-over unless you switch `AI_PROVIDER` to `anthropic` and record with that.

## Recording checklist

- [ ] Clean browser profile or private window: no bookmarks bar, no extensions, no other tabs.
- [ ] 1920x1080, browser zoom 100-110%, app in one theme throughout (light reads best on video).
- [ ] Notifications off (Windows Focus Assist / Do Not Disturb). Close chat and mail apps.
- [ ] **No secrets on screen:** never show `.env`, the Render environment page, the PayPal app credentials
      page or a terminal that printed keys. Sandbox emails on screen are fine.
- [ ] Terminal, if shown, uses a large font and a cleared scrollback.
- [ ] No copyrighted music. Silence or music you have a licence for (YouTube Audio Library is fine).
- [ ] No third-party logos or trademarks beyond what PayPal's own sandbox pages show while you use them.
- [ ] Everything in English.
- [ ] Final length under 3:00. Check the exported file, not the timeline.
- [ ] Upload to YouTube as **Public** (not Unlisted), then open the link in a private window to confirm it
      plays.
- [ ] Paste the link into the README and the Devpost form.
