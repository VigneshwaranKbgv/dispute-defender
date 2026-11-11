// Evidence locker files: validated, size-limited uploads stored under data/evidence/<caseId>/.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, type EvidenceItem, type EvidenceType } from './store.js';

export const EVIDENCE_TYPES: Record<EvidenceType, string> = {
  delivery_proof: 'Delivery proof',
  tracking: 'Tracking',
  chat_transcript: 'Chat transcript',
  invoice_contract: 'Invoice / contract',
  other: 'Other',
};

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_NOTE_CHARS = 2000;
const MAX_TEXT_FOR_AI = 20_000;

// Allowlist: stored extension is derived from the declared type, never from the uploaded name.
const ALLOWED: Record<string, { ext: string; kind: 'text' | 'image' | 'pdf' }> = {
  'text/plain': { ext: '.txt', kind: 'text' },
  'text/markdown': { ext: '.md', kind: 'text' },
  'text/csv': { ext: '.csv', kind: 'text' },
  'image/png': { ext: '.png', kind: 'image' },
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/webp': { ext: '.webp', kind: 'image' },
  'image/gif': { ext: '.gif', kind: 'image' },
  'application/pdf': { ext: '.pdf', kind: 'pdf' },
};
/** Types PayPal's provide-evidence endpoint accepts as attachments. */
const PAYPAL_ATTACHABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'application/pdf']);

export class EvidenceError extends Error {}

const startsWith = (buf: Buffer, bytes: number[]) => bytes.every((b, i) => buf[i] === b);

function contentMatchesType(buf: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString('ascii') === 'WEBP';
    case 'application/pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    default:
      return !buf.includes(0); // text: no NUL bytes
  }
}

const caseDir = (caseId: string) => path.join(dataDir(), 'evidence', caseId);
const safeName = (name: string) => path.basename(String(name)).replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';

export interface UploadInput {
  name: string;
  mimeType: string;
  data: Buffer;
}

export function isEvidenceType(v: unknown): v is EvidenceType {
  return typeof v === 'string' && v in EVIDENCE_TYPES;
}

/** Validate and store one evidence item (file optional). Throws EvidenceError with a user-facing message. */
export async function createEvidence(caseId: string, type: EvidenceType, note: string, upload?: UploadInput): Promise<EvidenceItem> {
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_CHARS) throw new EvidenceError(`Note is too long (max ${MAX_NOTE_CHARS} characters).`);
  if (!trimmed && !upload) throw new EvidenceError('Add a note or attach a file.');
  const item: EvidenceItem = { id: randomUUID(), type, note: trimmed, addedAt: new Date().toISOString() };

  if (upload) {
    const spec = ALLOWED[upload.mimeType];
    if (!spec) throw new EvidenceError('Unsupported file type. Use TXT, MD, CSV, PNG, JPG, WEBP, GIF or PDF.');
    if (upload.data.length === 0) throw new EvidenceError('The file is empty.');
    if (upload.data.length > MAX_FILE_BYTES) throw new EvidenceError(`File is too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    if (!contentMatchesType(upload.data, upload.mimeType)) throw new EvidenceError('The file content does not match its type.');
    const storedAs = `${item.id}${spec.ext}`;
    await fs.mkdir(caseDir(caseId), { recursive: true });
    await fs.writeFile(path.join(caseDir(caseId), storedAs), upload.data);
    item.file = { name: safeName(upload.name), mimeType: upload.mimeType, size: upload.data.length, storedAs };
  }
  return item;
}

export function evidenceFilePath(caseId: string, item: EvidenceItem): string | null {
  // storedAs is server-generated (uuid + allowlisted extension); basename() is defence in depth.
  return item.file ? path.join(caseDir(caseId), path.basename(item.file.storedAs)) : null;
}

export async function deleteEvidenceFile(caseId: string, item: EvidenceItem): Promise<void> {
  const p = evidenceFilePath(caseId, item);
  if (p) await fs.rm(p, { force: true });
}

export async function deleteCaseEvidence(caseId: string): Promise<void> {
  await fs.rm(caseDir(caseId), { recursive: true, force: true });
}

export interface LoadedEvidence {
  item: EvidenceItem;
  text?: string; // text file content (truncated)
  image?: { mimeType: string; base64: string };
  textTruncated?: boolean;
}

/** Read evidence content for the AI step: text files as text, images as base64, others by name only. */
export async function loadEvidenceForAi(caseId: string, items: EvidenceItem[]): Promise<LoadedEvidence[]> {
  return Promise.all(
    items.map(async (item): Promise<LoadedEvidence> => {
      const p = evidenceFilePath(caseId, item);
      const kind = item.file && ALLOWED[item.file.mimeType]?.kind;
      if (!p || !kind || kind === 'pdf') return { item };
      try {
        const buf = await fs.readFile(p);
        if (kind === 'text') {
          const text = buf.toString('utf8');
          return { item, text: text.slice(0, MAX_TEXT_FOR_AI), textTruncated: text.length > MAX_TEXT_FOR_AI };
        }
        return { item, image: { mimeType: item.file!.mimeType, base64: buf.toString('base64') } };
      } catch {
        return { item }; // file missing (e.g. ephemeral disk reset): fall back to name + note
      }
    }),
  );
}

/** Files that can be attached to PayPal's provide-evidence call. */
export async function loadPayPalAttachments(caseId: string, items: EvidenceItem[]): Promise<{ name: string; mimeType: string; data: Buffer }[]> {
  const out: { name: string; mimeType: string; data: Buffer }[] = [];
  for (const item of items) {
    const p = evidenceFilePath(caseId, item);
    if (!p || !item.file || !PAYPAL_ATTACHABLE.has(item.file.mimeType)) continue;
    try {
      out.push({ name: item.file.name, mimeType: item.file.mimeType, data: await fs.readFile(p) });
    } catch {
      /* missing on disk: skip */
    }
  }
  return out;
}

export const isPayPalAttachable = (item: EvidenceItem) => Boolean(item.file && PAYPAL_ATTACHABLE.has(item.file.mimeType));

// ---- Demo seed: fictional sample evidence shipped in docs/sample-evidence/ ----
const SAMPLES: { file: string; type: EvidenceType; note: string }[] = [
  { file: 'delivery-confirmation.txt', type: 'delivery_proof', note: 'Sample (fictional): delivery confirmation and download access log for the order.' },
  { file: 'chat-transcript.txt', type: 'chat_transcript', note: 'Sample (fictional): support chat with the buyer after delivery.' },
  { file: 'invoice.txt', type: 'invoice_contract', note: 'Sample (fictional): invoice with the agreed scope and delivery terms.' },
];

export async function createSampleEvidence(caseId: string): Promise<EvidenceItem[]> {
  const dir = path.resolve('docs', 'sample-evidence');
  const items: EvidenceItem[] = [];
  for (const s of SAMPLES) {
    const data = await fs.readFile(path.join(dir, s.file));
    items.push(await createEvidence(caseId, s.type, s.note, { name: s.file, mimeType: 'text/plain', data }));
  }
  return items;
}
