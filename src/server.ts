import { createApp } from './app.js';
import { aiStatus } from './ai.js';
import { paypalBase, paypalConfigured } from './paypal.js';

const port = Number(process.env.PORT) || 3000;
const base = paypalBase(); // throws unless this is a sandbox URL
const ai = aiStatus();

createApp().listen(port, () => {
  console.log(`Dispute Defender listening on http://localhost:${port}`);
  console.log(`PayPal: ${base} (${paypalConfigured() ? 'credentials set' : 'CREDENTIALS MISSING'})`);
  console.log(`AI: ${ai.configured ? `${ai.provider} / ${ai.model}` : `not configured (${ai.problem})`}`);
  console.log(`Webhooks: ${process.env.PAYPAL_WEBHOOK_ID ? 'webhook ID set' : 'PAYPAL_WEBHOOK_ID not set (events will be rejected as unverifiable)'}`);
  console.log(`Password gate: ${process.env.APP_PASSWORD ? 'on' : 'off'}`);
});
