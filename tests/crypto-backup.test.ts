import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encryptFile, decryptFile } from '../scripts/crypto-backup.js';

describe('Authenticated Backup Encryption (AES-256-GCM)', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch-test-crypto');
  const sampleData = Buffer.from(
    'PGDMP\x12\x00\x00\x00' + 'Realistic PostgreSQL Custom Dump simulated payload with multiple blocks '.repeat(50)
  );
  const testKey = 'super-secret-test-encryption-key-32chars!';

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('encrypts and decrypts with exact binary byte preservation', async () => {
    const rawPath = path.join(tmpDir, 'test.dump');
    const encPath = path.join(tmpDir, 'test.dump.enc');
    const decPath = path.join(tmpDir, 'test.decrypted.dump');

    fs.writeFileSync(rawPath, sampleData);

    const { sha256Ciphertext, bytesWritten } = await encryptFile(rawPath, encPath, testKey);
    expect(bytesWritten).toBeGreaterThan(sampleData.length);
    expect(sha256Ciphertext).toHaveLength(64);

    await decryptFile(encPath, decPath, testKey);

    const recovered = fs.readFileSync(decPath);
    expect(recovered).toEqual(sampleData);
  });

  it('rejects tampered or corrupted ciphertext and wipes decrypted output', async () => {
    const rawPath = path.join(tmpDir, 'test.dump');
    const encPath = path.join(tmpDir, 'test.dump.enc');
    const decPath = path.join(tmpDir, 'test.decrypted.dump');

    fs.writeFileSync(rawPath, sampleData);
    await encryptFile(rawPath, encPath, testKey);

    // Tamper with a single byte in ciphertext
    const encBuf = fs.readFileSync(encPath);
    encBuf[encBuf.length - 20] ^= 0x5a; // flip bits in ciphertext
    fs.writeFileSync(encPath, encBuf);

    await expect(decryptFile(encPath, decPath, testKey)).rejects.toThrow(/Authentication\/Decryption failed/);
    expect(fs.existsSync(decPath)).toBe(false);
  });

  it('rejects tampered authentication tag', async () => {
    const rawPath = path.join(tmpDir, 'test.dump');
    const encPath = path.join(tmpDir, 'test.dump.enc');
    const decPath = path.join(tmpDir, 'test.decrypted.dump');

    fs.writeFileSync(rawPath, sampleData);
    await encryptFile(rawPath, encPath, testKey);

    // Tamper with auth tag (last 16 bytes)
    const encBuf = fs.readFileSync(encPath);
    encBuf[encBuf.length - 1] ^= 0xff;
    fs.writeFileSync(encPath, encBuf);

    await expect(decryptFile(encPath, decPath, testKey)).rejects.toThrow(/Authentication\/Decryption failed/);
    expect(fs.existsSync(decPath)).toBe(false);
  });

  it('rejects wrong passphrase', async () => {
    const rawPath = path.join(tmpDir, 'test.dump');
    const encPath = path.join(tmpDir, 'test.dump.enc');
    const decPath = path.join(tmpDir, 'test.decrypted.dump');

    fs.writeFileSync(rawPath, sampleData);
    await encryptFile(rawPath, encPath, testKey);

    const wrongKey = 'completely-wrong-passphrase-at-least-16chars';
    await expect(decryptFile(encPath, decPath, wrongKey)).rejects.toThrow(/Authentication\/Decryption failed/);
    expect(fs.existsSync(decPath)).toBe(false);
  });

  it('rejects files without valid magic header', async () => {
    const fakePath = path.join(tmpDir, 'fake.dump.enc');
    const decPath = path.join(tmpDir, 'fake.decrypted.dump');
    fs.writeFileSync(fakePath, crypto.randomBytes(128));

    await expect(decryptFile(fakePath, decPath, testKey)).rejects.toThrow(/Invalid backup header/);
  });
});
