# Sample evidence (fictional)

These files are **made-up demo data** so the Dispute Defender demo is reproducible. "Test Store", "Maya" and
"John Doe" (the default PayPal sandbox buyer name) are not real businesses or people, and none of the
events described here happened.

They are written to match the sandbox demo case `PP-R-BYM-10198930` (item not received, USD 10.00,
seller transaction `6K933125FW277434X`):

| File | Evidence type | What it shows |
| --- | --- | --- |
| `delivery-confirmation.txt` | Delivery proof | Delivery email and download access log |
| `chat-transcript.txt` | Chat transcript | Buyer confirms in chat that the files arrived |
| `invoice.txt` | Invoice / contract | Scope, delivery terms and refund policy |

In the app, open the demo case and click **Add sample evidence** to load all three into the evidence
locker, or upload them one by one with **Add evidence**.

If you reproduce the demo with a fresh sandbox dispute, the transaction ID and timestamps in these
files will not match your new case, and the AI will (correctly) point that out.
