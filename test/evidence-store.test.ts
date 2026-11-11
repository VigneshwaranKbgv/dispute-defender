import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EvidenceError, MAX_FILE_BYTES, createEvidence, evidenceFilePath, loadEvidenceForAi, loadPayPalAttachments } from '../src/evidence.js';
import { addActivity, getCase, listActivity, resetStoreCache, saveCase } from '../src/store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dd-test-'));
  process.env.DATA_DIR = dir;
  resetStoreCache();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('createEvidence', () => {
  it('stores a text file under a server-generated name and reads it back for the AI', async () => {
    const item = await createEvidence('CASE-1', 'tracking', ' Courier scan ', { name: '../../evil.txt', mimeType: 'text/plain', data: Buffer.from('Delivered') });
    expect(item.note).toBe('Courier scan');
    expect(item.file).toMatchObject({ name: 'evil.txt', storedAs: `${item.id}.txt`, size: 9 });
    const p = evidenceFilePath('CASE-1', item)!;
    expect(p.startsWith(path.join(dir, 'evidence', 'CASE-1'))).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('Delivered');
    expect((await loadEvidenceForAi('CASE-1', [item]))[0]).toMatchObject({ text: 'Delivered' });
  });

  it('accepts a note with no file', async () => {
    expect((await createEvidence('CASE-1', 'other', 'Phone call on 12 Nov')).file).toBeUndefined();
  });

  it('rejects empty items, unsupported types, oversized files and mismatched content', async () => {
    await expect(createEvidence('C', 'other', '  ')).rejects.toBeInstanceOf(EvidenceError);
    await expect(createEvidence('C', 'other', '', { name: 'a.exe', mimeType: 'application/x-msdownload', data: Buffer.from('MZ') })).rejects.toThrow(/Unsupported/);
    await expect(createEvidence('C', 'other', '', { name: 'a.txt', mimeType: 'text/plain', data: Buffer.alloc(MAX_FILE_BYTES + 1, 97) })).rejects.toThrow(/too large/);
    await expect(createEvidence('C', 'other', '', { name: 'a.png', mimeType: 'image/png', data: Buffer.from('<script>') })).rejects.toThrow(/does not match/);
    expect(existsSync(path.join(dir, 'evidence'))).toBe(false);
  });

  it('passes images to the AI as base64 and to PayPal as attachments; text is not attachable', async () => {
    const img = await createEvidence('CASE-1', 'delivery_proof', '', { name: 'proof.png', mimeType: 'image/png', data: PNG });
    const txt = await createEvidence('CASE-1', 'other', '', { name: 'a.txt', mimeType: 'text/plain', data: Buffer.from('hi') });
    expect((await loadEvidenceForAi('CASE-1', [img]))[0]?.image).toEqual({ mimeType: 'image/png', base64: PNG.toString('base64') });
    expect((await loadPayPalAttachments('CASE-1', [img, txt])).map((f) => f.name)).toEqual(['proof.png']);
  });
});

describe('store', () => {
  it('persists atomically and reloads from disk', async () => {
    await saveCase({ id: 'CASE-1', dispute: { dispute_id: 'CASE-1' }, addedAt: 'a', syncedAt: 'b', source: 'manual', evidence: [] });
    await addActivity('CASE-1', 'case_added', 'added');
    await addActivity(null, 'webhook', 'global');
    expect(readdirSync(dir)).toEqual(['db.json']); // no temp file left behind
    resetStoreCache();
    expect(await getCase('CASE-1')).toMatchObject({ id: 'CASE-1', source: 'manual' });
    expect((await listActivity('CASE-1')).map((a) => a.summary)).toEqual(['added']);
    expect(await listActivity()).toHaveLength(2);
  });

  it('starts empty when there is no file (fresh or ephemeral disk)', async () => {
    expect(await getCase('nope')).toBeUndefined();
    expect(await listActivity()).toEqual([]);
  });
});
