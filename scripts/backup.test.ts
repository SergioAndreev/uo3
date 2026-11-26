import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decryptFile,
  encryptFile,
  kindOf,
  pgTime,
  recoveryConf,
  retentionUntil,
  sha256File,
} from './backup.js';

describe('scripts/backup', () => {
  it('политика хранения и вид снимка', () => {
    const d = new Date('2026-11-26T04:00:00Z');
    expect(retentionUntil('daily', d).toISOString()).toBe('2026-12-03T04:00:00.000Z');
    expect(retentionUntil('weekly', d).getTime() - d.getTime()).toBe(28 * 86_400_000);
    expect(retentionUntil('monthly', d).getTime() - d.getTime()).toBe(92 * 86_400_000);
    expect(kindOf(new Date('2026-12-01T04:00:00Z'))).toBe('monthly');
    expect(kindOf(new Date('2026-11-29T04:00:00Z'))).toBe('weekly');
    expect(kindOf(d)).toBe('daily');
  });

  it('шифрование AES-256-GCM: обратимость, контрольная сумма, подмена обнаруживается', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dm-backup-test-'));
    const key = randomBytes(32);
    const plain = randomBytes(100_000);
    writeFileSync(join(dir, 'a'), plain);
    await encryptFile(join(dir, 'a'), join(dir, 'a.enc'), key);
    const enc = readFileSync(join(dir, 'a.enc'));
    expect(enc.subarray(0, 4).toString()).toBe('DMB1');
    expect(enc.includes(plain.subarray(0, 64))).toBe(false);
    await decryptFile(join(dir, 'a.enc'), join(dir, 'b'), key);
    expect(readFileSync(join(dir, 'b')).equals(plain)).toBe(true);
    expect(await sha256File(join(dir, 'a.enc'))).toMatch(/^[0-9a-f]{64}$/);
    enc[100] = (enc[100] as number) ^ 1;
    writeFileSync(join(dir, 'bad.enc'), enc);
    await expect(decryptFile(join(dir, 'bad.enc'), join(dir, 'c'), key)).rejects.toThrow();
    await expect(
      decryptFile(join(dir, 'a.enc'), join(dir, 'd'), randomBytes(32)),
    ).rejects.toThrow();
    writeFileSync(join(dir, 'x'), Buffer.alloc(40));
    await expect(decryptFile(join(dir, 'x'), join(dir, 'e'), key)).rejects.toThrow('не архив');
  });

  it('настройки восстановления и метка времени', () => {
    expect(pgTime('2026-11-26T14:21:55Z')).toBe('2026-11-26 14:21:55.000+00');
    expect(() => pgTime('вчера')).toThrow();
    expect(recoveryConf()).not.toContain('recovery_target_time');
    expect(recoveryConf('2026-11-26T14:21:55Z')).toContain(
      "recovery_target_time = '2026-11-26 14:21:55.000+00'",
    );
    expect(recoveryConf()).toContain("restore_command = 'cp /wal/%f %p'");
  });
});
