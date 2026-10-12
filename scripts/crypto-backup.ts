#!/usr/bin/env node
/**
 * Stream-based AES-256-GCM / HMAC-SHA256 Authenticated Encryption & Decryption Utility.
 *
 * Provides authenticated encryption for PostgreSQL database dumps without external dependencies.
 * - Format:
 *   [16 bytes Magic: "OJAS_BACKUP_V1\0\0"]
 *   [16 bytes Salt (for PBKDF2 key derivation)]
 *   [12 bytes Nonce/IV]
 *   [Variable bytes: Ciphertext (AES-256-GCM)]
 *   [16 bytes: GCM Authentication Tag]
 *
 * Security guarantees:
 * - Confidentiality: AES-256-GCM.
 * - Cryptographic Authenticity / Integrity: 16-byte authentication tag guarantees
 *   any corruption or byte tampering causes immediate rejection BEFORE restoration.
 * - Key derivation: PBKDF2-HMAC-SHA256 with 250,000 iterations and unique random 16-byte salt.
 * - Constant-time verification prevents timing side-channels.
 * - Streams large backups without loading entire dumps into memory.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const MAGIC_HEADER = Buffer.from('OJAS_BACKUP_V1\0\0'); // exactly 16 bytes
const SALT_LEN = 16;
const IV_LEN = 12; // Standard 96-bit GCM IV
const TAG_LEN = 16; // Standard 128-bit authentication tag
const PBKDF2_ITERATIONS = 250_000;
const KEY_LEN = 32; // 256 bits

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, 'sha256');
}

export async function encryptFile(inputFile: string, outputFile: string, passphrase: string): Promise<{
  sha256Ciphertext: string;
  bytesWritten: number;
}> {
  if (!passphrase || passphrase.length < 16) {
    throw new Error('Encryption passphrase must be at least 16 characters long.');
  }

  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const inStream = fs.createReadStream(inputFile);
  const outStream = fs.createWriteStream(outputFile, { mode: 0o600 });
  const hash = crypto.createHash('sha256');

  // Write header: Magic + Salt + IV
  const header = Buffer.concat([MAGIC_HEADER, salt, iv]);
  outStream.write(header);
  hash.update(header);

  // Pipe input through cipher to output
  for await (const chunk of inStream) {
    const encChunk = cipher.update(chunk);
    if (encChunk.length > 0) {
      outStream.write(encChunk);
      hash.update(encChunk);
    }
  }

  const finalChunk = cipher.final();
  if (finalChunk.length > 0) {
    outStream.write(finalChunk);
    hash.update(finalChunk);
  }

  // Write GCM Auth Tag
  const authTag = cipher.getAuthTag();
  outStream.write(authTag);
  hash.update(authTag);

  await new Promise<void>((resolve, reject) => {
    outStream.end(() => resolve());
    outStream.on('error', reject);
  });

  const stat = fs.statSync(outputFile);
  return {
    sha256Ciphertext: hash.digest('hex'),
    bytesWritten: stat.size,
  };
}

export async function decryptFile(inputFile: string, outputFile: string, passphrase: string): Promise<void> {
  if (!passphrase || passphrase.length < 16) {
    throw new Error('Encryption passphrase must be at least 16 characters long.');
  }

  const fileStat = fs.statSync(inputFile);
  const minSize = MAGIC_HEADER.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (fileStat.size < minSize) {
    throw new Error(`Encrypted file is too small or corrupt (${fileStat.size} bytes; minimum is ${minSize} bytes).`);
  }

  const fd = fs.openSync(inputFile, 'r');
  try {
    // 1. Read header
    const headerBuf = Buffer.alloc(MAGIC_HEADER.length + SALT_LEN + IV_LEN);
    fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);

    const magic = headerBuf.subarray(0, MAGIC_HEADER.length);
    if (!magic.equals(MAGIC_HEADER)) {
      throw new Error('Invalid backup header. File is not an authentic Ojas encrypted backup.');
    }

    const salt = headerBuf.subarray(MAGIC_HEADER.length, MAGIC_HEADER.length + SALT_LEN);
    const iv = headerBuf.subarray(MAGIC_HEADER.length + SALT_LEN, MAGIC_HEADER.length + SALT_LEN + IV_LEN);

    // 2. Read Auth Tag from end of file
    const authTag = Buffer.alloc(TAG_LEN);
    fs.readSync(fd, authTag, 0, TAG_LEN, fileStat.size - TAG_LEN);

    // 3. Derive key and setup GCM decipher
    const key = deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    // 4. Stream ciphertext (from after header to before auth tag)
    const ciphertextStart = headerBuf.length;
    const ciphertextEnd = fileStat.size - TAG_LEN - 1; // inclusive

    const inStream = fs.createReadStream(inputFile, {
      start: ciphertextStart,
      end: ciphertextEnd,
    });
    const outStream = fs.createWriteStream(outputFile, { mode: 0o600 });

    for await (const chunk of inStream) {
      const decChunk = decipher.update(chunk);
      if (decChunk.length > 0) {
        outStream.write(decChunk);
      }
    }

    // Verify authentication tag
    const finalChunk = decipher.final();
    if (finalChunk.length > 0) {
      outStream.write(finalChunk);
    }

    await new Promise<void>((resolve, reject) => {
      outStream.end(() => resolve());
      outStream.on('error', reject);
    });
  } catch (err: any) {
    // Clean up partial decrypted file on failure
    if (fs.existsSync(outputFile)) {
      try {
        fs.unlinkSync(outputFile);
      } catch {}
    }
    throw new Error(`Authentication/Decryption failed: ${err.message}. (Backup corrupted, tampered, or wrong key)`);
  } finally {
    fs.closeSync(fd);
  }
}

// CLI runner
async function main() {
  const scriptName = 'crypto-backup.ts';
  if (!process.argv[1] || !process.argv[1].endsWith(scriptName)) {
    return;
  }

  const mode = process.argv[2]; // 'encrypt' | 'decrypt'
  const inPath = process.argv[3];
  const outPath = process.argv[4];
  const pass = process.env.BACKUP_ENCRYPTION_KEY;

  if (!mode || !inPath || !outPath) {
    console.error('Usage: tsx scripts/crypto-backup.ts <encrypt|decrypt> <input-file> <output-file>');
    process.exit(1);
  }

  if (!pass) {
    console.error('Error: BACKUP_ENCRYPTION_KEY environment variable is required.');
    process.exit(1);
  }

  try {
    if (mode === 'encrypt') {
      const res = await encryptFile(inPath, outPath, pass);
      console.log(`[crypto] Encrypted ${inPath} -> ${outPath}`);
      console.log(`[crypto] SHA256: ${res.sha256Ciphertext}`);
      console.log(`[crypto] Bytes: ${res.bytesWritten}`);
    } else if (mode === 'decrypt') {
      await decryptFile(inPath, outPath, pass);
      console.log(`[crypto] Decrypted & Authenticated ${inPath} -> ${outPath}`);
    } else {
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`[crypto error] ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[crypto fatal]', err);
  process.exit(1);
});

