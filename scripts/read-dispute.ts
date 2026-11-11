// Read one dispute by ID and print a summary (the list endpoint returned 0 items in our sandbox testing).
// Usage: npm run sandbox:read-dispute -- <DISPUTE_ID>
import { fetchDispute, normalizeDispute } from '../src/disputes.js';

const id = process.argv[2];
if (!id) {
  console.log('Usage: npm run sandbox:read-dispute -- <DISPUTE_ID>');
  process.exit(1);
}
const r = await fetchDispute(id);
console.log('get dispute:', r.status);
if (!r.ok) {
  console.log(JSON.stringify(r.json, null, 2));
  process.exit(1);
}
const d = normalizeDispute(r.json);
console.log(
  JSON.stringify(
    {
      id: d.id,
      reason: d.reason,
      status: d.status,
      state: d.state,
      stage: d.stage,
      amount: d.amount,
      sellerResponseDueDate: d.sellerResponseDueDate,
      allowedActions: d.allowedActions,
      requestedEvidenceTypes: d.requestedEvidenceTypes,
      messages: d.messages.length,
      evidences: d.evidences.length,
    },
    null,
    2,
  ),
);
