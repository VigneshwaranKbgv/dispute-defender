// PayPal REST client: sandbox guard, cached OAuth token, one api() helper.
// Ported from the original spike helper. Never logs secrets.

export interface ApiResult<T = any> {
  status: number;
  ok: boolean;
  json: T;
}

type Body = Record<string, unknown> | string | FormData | undefined;

const RETRY_DELAYS_MS = [400, 1200];
const TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function paypalBase(): string {
  const base = (process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com').replace(/\/+$/, '');
  if (!base.includes('sandbox')) {
    throw new Error('Refusing to run: PAYPAL_BASE_URL is not a sandbox URL. This app is sandbox-only.');
  }
  return base;
}

export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cached: { token: string; expiresAt: number } | null = null;

export function clearTokenCache(): void {
  cached = null;
}

/** Fetch with retries for transient failures. Non-GET calls retry only on 429 (never processed). */
async function fetchWithRetry(url: string, init: RequestInit, retry5xx: boolean): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const transient = r.status === 429 || (retry5xx && r.status >= 500);
      if (!transient || delay === undefined) return r;
    } catch (err) {
      if (!retry5xx || delay === undefined) throw err;
    }
    await sleep(delay);
  }
}

export async function token(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('PayPal credentials are not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).');
  const r = await fetchWithRetry(
    `${paypalBase()}/v1/oauth2/token`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    },
    true,
  );
  if (!r.ok) throw new Error(`PayPal sign-in failed (HTTP ${r.status}). Check the sandbox client ID and secret.`);
  const j = (await r.json()) as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 300) * 1000 };
  return cached.token;
}

/**
 * Call the PayPal API. `body` may be an object (sent as JSON), a pre-serialized JSON string
 * (sent verbatim; needed for webhook verification), or FormData (multipart).
 */
export async function api<T = any>(
  method: string,
  path: string,
  body?: Body,
  extraHeaders: Record<string, string> = {},
): Promise<ApiResult<T>> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const send = async () => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await token()}`,
      Prefer: 'return=representation',
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...extraHeaders,
    };
    const payload = body === undefined ? undefined : isForm || typeof body === 'string' ? (body as BodyInit) : JSON.stringify(body);
    return fetchWithRetry(`${paypalBase()}${path}`, { method, headers, body: payload }, method === 'GET');
  };
  let r = await send();
  if (r.status === 401) {
    // Token may have been revoked or expired early: refresh once.
    clearTokenCache();
    r = await send();
  }
  const text = await r.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = text;
  }
  return { status: r.status, ok: r.ok, json };
}
