// Reproduce a sandbox dispute, step 1: create a $10 order and print the buyer approval link.
// Usage: npm run sandbox:create-order
import { api } from '../src/paypal.js';

const r = await api('POST', '/v2/checkout/orders', {
  intent: 'CAPTURE',
  purchase_units: [{ description: 'Dispute Defender demo order', amount: { currency_code: 'USD', value: '10.00' } }],
  payment_source: {
    paypal: {
      experience_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        brand_name: 'Test Store',
        return_url: 'https://example.com/return',
        cancel_url: 'https://example.com/cancel',
      },
    },
  },
});
console.log('create order:', r.status);
if (!r.ok) {
  console.log(JSON.stringify(r.json, null, 2));
  process.exit(1);
}
const approve = r.json.links.find((l: { rel: string; href: string }) => ['payer-action', 'approve'].includes(l.rel))?.href;
console.log('ORDER_ID =', r.json.id);
console.log('\nOpen this in a private window, log in as the US SANDBOX BUYER, and approve the payment:\n' + approve);
console.log('\nThen run: npm run sandbox:capture-order -- ' + r.json.id);
