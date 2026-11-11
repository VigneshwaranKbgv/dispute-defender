// Express app: JSON API, webhook receiver, static dashboard. Secrets stay on the server.
import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { AiError, aiStatus } from './ai.js';
import {
  BadRequestError,
  DEMO_CASE_ID,
  NotFoundError,
  addEvidence,
  addSampleEvidence,
  analyzeCase,
  getCaseDetail,
  listCaseSummaries,
  recordCopy,
  removeEvidence,
  saveDraft,
  sendResponse,
  stopTracking,
  upsertCaseFromPayPal,
} from './cases.js';
import { DISPUTE_ID_RE, MAX_MESSAGE_CHARS } from './disputes.js';
import { EVIDENCE_TYPES, EvidenceError, MAX_FILE_BYTES, MAX_NOTE_CHARS, evidenceFilePath, isEvidenceType } from './evidence.js';
import { paypalConfigured } from './paypal.js';
import { getCase, listActivity } from './store.js';
import { handleWebhook } from './webhooks.js';

const SESSION_COOKIE = 'dd_session';

// ---- optional shared-password gate (APP_PASSWORD) ----
const appPassword = () => process.env.APP_PASSWORD || '';
const sessionToken = () => createHmac('sha256', appPassword()).update('dispute-defender-session-v1').digest('hex');
const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
const cookie = (req: Request, name: string): string => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
};
const isAuthed = (req: Request) => !appPassword() || safeEqual(cookie(req, SESSION_COOKIE), sessionToken());

const failedLogins = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, service: 'dispute-defender', time: new Date().toISOString() });
  });

  // ---- PayPal webhooks (not behind the password: PayPal's signature is the authentication) ----
  app.post(
    '/webhooks/paypal',
    express.json({
      limit: '1mb',
      type: () => true,
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf.toString('utf8');
      },
    }),
    async (req, res) => {
      const outcome = await handleWebhook(req.headers, str((req as any).rawBody));
      res.status(outcome.httpStatus).json(outcome.body);
    },
  );

  const api = express.Router();
  api.use(express.json({ limit: '4mb' }));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/session', (req, res) => {
    const ai = aiStatus();
    const authed = isAuthed(req);
    res.json({
      authRequired: Boolean(appPassword()),
      authed,
      // Configuration status only; never keys.
      config: authed
        ? {
            paypalConfigured: paypalConfigured(),
            paypalEnv: 'sandbox',
            ai: { provider: ai.provider, model: ai.model, configured: ai.configured, problem: ai.problem ?? null },
            webhookConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
            demoCaseId: DEMO_CASE_ID,
            evidenceTypes: EVIDENCE_TYPES,
            limits: { maxFileBytes: MAX_FILE_BYTES, maxNoteChars: MAX_NOTE_CHARS, maxMessageChars: MAX_MESSAGE_CHARS },
          }
        : null,
    });
  });

  api.post('/login', (req, res) => {
    if (!appPassword()) return void res.json({ ok: true });
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = failedLogins.get(key);
    if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_FAILS) {
      return void res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
    }
    if (!safeEqual(createHmac('sha256', 'cmp').update(str(req.body?.password)).digest('hex'), createHmac('sha256', 'cmp').update(appPassword()).digest('hex'))) {
      failedLogins.set(key, entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + LOGIN_WINDOW_MS });
      return void res.status(401).json({ error: 'Wrong password.' });
    }
    failedLogins.delete(key);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sessionToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });

  api.use((req, res, next) => {
    if (isAuthed(req)) return next();
    res.status(401).json({ error: 'Password required.' });
  });

  const caseId = (req: Request): string => {
    const id = str(req.params.id).trim();
    if (!DISPUTE_ID_RE.test(id)) throw new BadRequestError('That does not look like a PayPal dispute ID (for example PP-R-ABC-12345678).');
    return id;
  };

  api.get('/cases', async (_req, res) => {
    res.json({ cases: await listCaseSummaries() });
  });

  api.post('/cases', async (req, res) => {
    const id = str(req.body?.disputeId).trim().toUpperCase();
    if (!DISPUTE_ID_RE.test(id)) throw new BadRequestError('That does not look like a PayPal dispute ID (for example PP-R-ABC-12345678).');
    const result = await upsertCaseFromPayPal(id, id === DEMO_CASE_ID && req.body?.demo === true ? 'demo' : 'manual');
    if (!result.ok) return void res.status(502).json({ error: result.error.plain, paypal: result.error });
    res.status(result.created ? 201 : 200).json({ id, created: result.created });
  });

  api.get('/cases/:id', async (req, res) => {
    res.json(await getCaseDetail(caseId(req)));
  });

  api.post('/cases/:id/sync', async (req, res) => {
    const id = caseId(req);
    if (!(await getCase(id))) throw new NotFoundError('This case is not being tracked.');
    const result = await upsertCaseFromPayPal(id, 'manual');
    if (!result.ok) return void res.status(502).json({ error: result.error.plain, paypal: result.error });
    res.json(await getCaseDetail(id));
  });

  api.delete('/cases/:id', async (req, res) => {
    await stopTracking(caseId(req));
    res.json({ ok: true });
  });

  api.post('/cases/:id/evidence', async (req, res) => {
    const id = caseId(req);
    const { type, note, file } = req.body ?? {};
    if (!isEvidenceType(type)) throw new BadRequestError('Choose an evidence type.');
    let upload;
    if (file) {
      const base64 = str(file.base64);
      if (base64.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 8) throw new EvidenceError(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
      upload = { name: str(file.name), mimeType: str(file.mimeType), data: Buffer.from(base64, 'base64') };
    }
    await addEvidence(id, type, str(note), upload);
    res.status(201).json(await getCaseDetail(id));
  });

  api.post('/cases/:id/evidence/samples', async (req, res) => {
    const id = caseId(req);
    await addSampleEvidence(id);
    res.status(201).json(await getCaseDetail(id));
  });

  api.delete('/cases/:id/evidence/:evidenceId', async (req, res) => {
    const id = caseId(req);
    await removeEvidence(id, str(req.params.evidenceId));
    res.json(await getCaseDetail(id));
  });

  api.get('/cases/:id/evidence/:evidenceId/file', async (req, res) => {
    const id = caseId(req);
    const item = (await getCase(id))?.evidence.find((e) => e.id === req.params.evidenceId);
    const filePath = item && evidenceFilePath(id, item);
    if (!item?.file || !filePath) throw new NotFoundError('File not found.');
    // Uploaded content is untrusted: text is always served as plain text and everything is sandboxed.
    const type = item.file.mimeType.startsWith('text/') ? 'text/plain; charset=utf-8' : item.file.mimeType;
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `inline; filename="${item.file.name.replace(/[^\w.\- ]/g, '_')}"`);
    res.type(type).sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'File is no longer on disk.' });
    });
  });

  api.post('/cases/:id/analyze', async (req, res) => {
    const id = caseId(req);
    await analyzeCase(id);
    res.json(await getCaseDetail(id));
  });

  api.put('/cases/:id/draft', async (req, res) => {
    const id = caseId(req);
    await saveDraft(id, str(req.body?.draft));
    res.json({ ok: true });
  });

  api.post('/cases/:id/copied', async (req, res) => {
    await recordCopy(caseId(req));
    res.json({ ok: true });
  });

  api.post('/cases/:id/send', async (req, res) => {
    const id = caseId(req);
    if (req.body?.approved !== true) throw new BadRequestError('The seller must approve before anything is sent.');
    const result = await sendResponse(id, { action: str(req.body?.action), message: str(req.body?.message), offerAmount: str(req.body?.offerAmount) || undefined });
    res.json({ result, case: await getCaseDetail(id) });
  });

  api.get('/activity', async (_req, res) => {
    res.json({ activity: await listActivity(undefined, 200) });
  });

  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use('/api', api);

  // ---- static dashboard (no bundler) ----
  // Preact + htm in one self-contained ES module, served from node_modules (no CDN, no bundler).
  const vendorFile = path.resolve('node_modules', 'htm', 'preact', 'standalone.module.js');
  app.get('/vendor/htm-preact.js', (_req, res) => {
    res.type('text/javascript').sendFile(vendorFile);
  });
  app.use(express.static(path.resolve('public'), { extensions: ['html'] }));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof NotFoundError) return void res.status(404).json({ error: err.message });
    if (err instanceof BadRequestError || err instanceof EvidenceError) return void res.status(400).json({ error: err.message });
    if (err instanceof AiError) return void res.status(502).json({ error: err.message });
    if (err?.type === 'entity.too.large') return void res.status(413).json({ error: 'Upload is too large.' });
    if (err?.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Invalid JSON.' });
    console.error('Unhandled error:', err?.message ?? err);
    res.status(500).json({ error: 'Something went wrong on the server. Nothing was sent to PayPal.' });
  });

  return app;
}
