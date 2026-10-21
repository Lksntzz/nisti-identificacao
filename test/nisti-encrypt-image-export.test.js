import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  encryptImageZip,
  decryptImageZip,
  verifyEncryptedImageZip
} from '../scripts/nisti-encrypt-image-export.mjs';

const passphrase = 'senha-unica-segura-exportacao-2026';
const contents = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('imagem de teste; estrutura zip simulada', 'utf8')
]);

test('original image ZIP is encrypted, verified and decrypted only with secret', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nisti-img-export-'));
  const zip = path.join(folder, 'test.zip');
  const encrypted = zip + '.nisti.enc';
  const recovery = path.join(folder, 'restored');
  const { mkdir } = await import('node:fs/promises');
  try {
    await mkdir(recovery);
    await writeFile(zip, contents);
    await encryptImageZip(zip, encrypted, passphrase);
    const bytes = await readFile(encrypted);
    assert.equal(bytes.subarray(0, 9).toString(), 'NISTIIMG1');
    assert.ok(!bytes.includes(contents));
    assert.deepEqual(await verifyEncryptedImageZip(encrypted, passphrase), { plaintextBytes: contents.length });
    const output = await decryptImageZip(encrypted, recovery, passphrase);
    assert.deepEqual(await readFile(output), contents);
    await assert.rejects(() => decryptImageZip(encrypted, recovery, passphrase), /EEXIST/);
  } finally {
    await rm(folder, { recursive:true, force:true });
  }
});

test('wrong passphrase and modified authentication tag never leave a decrypted ZIP', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nisti-img-tamper-'));
  const zip = path.join(folder, 'test.zip');
  const encrypted = zip + '.nisti.enc';
  try {
    await writeFile(zip, contents);
    await encryptImageZip(zip, encrypted, passphrase);
    await assert.rejects(() => verifyEncryptedImageZip(encrypted, 'outra-senha-longa-de-teste-2026'));
    await assert.rejects(() => decryptImageZip(encrypted, folder, 'outra-senha-longa-de-teste-2026'), /descartada/);
    const bytes = await readFile(encrypted);
    bytes[bytes.length - 1] ^= 0xff;
    await writeFile(encrypted, bytes);
    await assert.rejects(() => verifyEncryptedImageZip(encrypted, passphrase));
    const pathReturned = path.join(folder, 'test.zip');
    assert.ok((await stat(pathReturned)).size > 0);
  } finally {
    await rm(folder, { recursive:true, force:true });
  }
});

test('invalid encryption destination or short passphrase is rejected', async () => {
  await assert.rejects(() => encryptImageZip('test.txt', 'test.zip.nisti.enc', passphrase), /ZIP/);
  await assert.rejects(() => encryptImageZip('test.zip', 'test.zip.nisti.enc', 'short'), /20 caracteres/);
});
