// Trimmed real shape of GET /v1/customer/disputes/{id} from the sandbox (personal data replaced).
export const sampleDispute = {
  dispute_id: 'PP-R-TST-10000001',
  create_time: '2026-11-11T14:31:11.376Z',
  update_time: '2026-11-11T14:31:43.753Z',
  disputed_transactions: [
    {
      buyer_transaction_id: 'BUYERTXN000000001',
      seller_transaction_id: 'SELLERTXN00000001',
      create_time: '2026-11-11T14:28:26.000Z',
      transaction_status: 'COMPLETED',
      gross_amount: { currency_code: 'USD', value: '10.00' },
      buyer: { email: 'buyer@example.com', payer_id: 'PAYER123', name: 'John Doe' },
      seller: { email: 'seller@example.com', merchant_id: 'MERCHANT123', name: 'Test Store' },
      items: [{ item_name: 'Hackathon spike order', item_quantity: '1', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', item_type: 'SERVICE' }],
      seller_protection_eligible: false,
    },
  ],
  reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  dispute_amount: { currency_code: 'USD', value: '10.00' },
  dispute_state: 'REQUIRED_ACTION',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_channel: 'INTERNAL',
  messages: [{ posted_by: 'BUYER', time_posted: '2026-11-11T14:31:11.376Z', content: 'Service never delivered' }],
  extensions: { merchant_contacted: false },
  evidences: [
    { evidence_type: 'CREATE', notes: 'Service never delivered', source: 'SUBMITTED_BY_BUYER', date: '2026-11-11T14:31:11.376Z', dispute_life_cycle_stage: 'INQUIRY' },
    { evidence_type: 'PROOF_OF_FULFILLMENT', source: 'REQUESTED_FROM_SELLER', date: '2026-11-11T14:34:33.883Z' },
  ],
  seller_response_due_date: '2026-12-01T14:31:11.376Z',
  offer: { buyer_requested_amount: { currency_code: 'USD', value: '10.00' } },
  refund_details: { allowed_refund_amount: { currency_code: 'USD', value: '10.00' } },
  links: [
    { href: 'https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-TST-10000001', rel: 'self', method: 'GET' },
    { href: 'https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-TST-10000001/provide-evidence', rel: 'provide_evidence', method: 'POST' },
    { href: 'https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-R-TST-10000001/send-message', rel: 'send_message', method: 'POST' },
  ],
};

export const validAnalysis = {
  disputeType: 'Item not received',
  whatPayPalNeeds: ['Proof of delivery'],
  strength: { score: 72, label: 'strong', reasoning: 'Delivery log on file.' },
  missingEvidence: [{ item: 'Signed receipt', why: 'Confirms the buyer has it.', priority: 'low' }],
  recommendedAction: { action: 'contest', rationale: 'Evidence is solid.', tradeoffs: 'Takes longer than a refund.' },
  draftResponse: 'Our records show the order was delivered.',
  assumptions: [],
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
