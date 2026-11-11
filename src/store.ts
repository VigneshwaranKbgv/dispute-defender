// Tiny JSON-file repository. One file (data/db.json), in-memory cache, serialized atomic writes
// (write temp file, then rename). No native dependencies.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type EvidenceType = 'delivery_proof' | 'tracking' | 'chat_transcript' | 'invoice_contract' | 'other';

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  note: string;
  addedAt: string;
  file?: { name: string; mimeType: string; size: number; storedAs: string };
}

export interface StoredAnalysis {
  result: unknown;
  provider: string;
  model: string;
  at: string;
  attempts: number;
}

export interface CaseRecord {
  id: string;
  dispute: any; // raw PayPal dispute JSON, normalized on read
  addedAt: string;
  syncedAt: string;
  source: 'manual' | 'webhook' | 'demo';
  evidence: EvidenceItem[];
  analysis?: StoredAnalysis;
  draft?: string;
}

export type ActivityType =
  | 'case_added'
  | 'sync'
  | 'sync_failed'
  | 'evidence_added'
  | 'evidence_removed'
  | 'analysis'
  | 'analysis_failed'
  | 'draft_edited'
  | 'response_copied'
  | 'send_success'
  | 'send_failed'
  | 'webhook'
  | 'webhook_rejected'
  | 'case_removed';

export interface Activity {
  id: string;
  at: string;
  caseId: string | null;
  type: ActivityType;
  summary: string;
  detail?: unknown;
}

interface Db {
  cases: Record<string, CaseRecord>;
  activity: Activity[];
}

const MAX_ACTIVITY = 1000;

export const dataDir = () => path.resolve(process.env.DATA_DIR || 'data');
const dbFile = () => path.join(dataDir(), 'db.json');

let db: Db | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Db> {
  if (db) return db;
  try {
    const parsed = JSON.parse(await fs.readFile(dbFile(), 'utf8'));
    db = { cases: parsed.cases ?? {}, activity: parsed.activity ?? [] };
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.error('Store: could not read db.json, starting empty:', err?.message);
    db = { cases: {}, activity: [] };
  }
  return db;
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (err: any) {
      // Windows can briefly lock the target (antivirus/indexer).
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) throw err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

function persist(): Promise<void> {
  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      if (!db) return;
      await fs.mkdir(dataDir(), { recursive: true });
      const tmp = `${dbFile()}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
      await renameWithRetry(tmp, dbFile());
    });
  return writeChain;
}

export async function listCases(): Promise<CaseRecord[]> {
  return Object.values((await load()).cases);
}

export async function getCase(id: string): Promise<CaseRecord | undefined> {
  return (await load()).cases[id];
}

export async function saveCase(record: CaseRecord): Promise<void> {
  (await load()).cases[record.id] = record;
  await persist();
}

export async function removeCase(id: string): Promise<boolean> {
  const d = await load();
  if (!d.cases[id]) return false;
  delete d.cases[id];
  await persist();
  return true;
}

export async function addActivity(caseId: string | null, type: ActivityType, summary: string, detail?: unknown): Promise<Activity> {
  const d = await load();
  const entry: Activity = { id: randomUUID(), at: new Date().toISOString(), caseId, type, summary, ...(detail === undefined ? {} : { detail }) };
  d.activity.unshift(entry);
  if (d.activity.length > MAX_ACTIVITY) d.activity.length = MAX_ACTIVITY;
  await persist();
  return entry;
}

/** Newest first. Pass a case id for that case's audit log, or nothing for the global feed. */
export async function listActivity(caseId?: string, limit = 200): Promise<Activity[]> {
  const all = (await load()).activity;
  return (caseId ? all.filter((a) => a.caseId === caseId) : all).slice(0, limit);
}

/** Test helper: drop the in-memory cache so the next call re-reads from DATA_DIR. */
export function resetStoreCache(): void {
  db = null;
  writeChain = Promise.resolve();
}
