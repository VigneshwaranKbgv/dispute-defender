// Reproduce a sandbox dispute, step 2: capture the order the buyer approved.
// Usage: npm run sandbox:capture-order -- <ORDER_ID>
// Disputes cannot be created through the API from this app (verified), so step 3 is manual.
import { api } from '../src/paypal.js';

const orderId = process.argv[2];
if (!orderId) {
  console.log('Usage: npm run sandbox:capture-order -- <ORDER_ID>');
  process.exit(1);
}
const cap = await api('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
console.log('capture:', cap.status);
if (!cap.ok) {
  console.log(JSON.stringify(cap.json, null, 2));
  process.exit(1);
}
console.log('capture id (seller transaction):', cap.json.purchase_units[0].payments.captures[0].id);
console.log('\nNext, as the sandbox BUYER, open a dispute for this payment:');
console.log('  https://www.sandbox.paypal.com/resolutioncenter/  ->  Report a problem  ->  pick the payment  ->  "I didn\'t receive my item"');
console.log('Copy the case ID (PP-R-...) and add it in Dispute Defender, or wait for the webhook.');
