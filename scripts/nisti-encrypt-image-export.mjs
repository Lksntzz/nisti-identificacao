// Criptografa o ZIP de imagens ANTES de enviá-lo ao GitHub Actions.
// Formato distinto dos backups PostgreSQL. Nunca salva senha em artefatos.
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, appendFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const MAGIC = Buffer.from('NISTIIMG1', 'ascii');
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;

function deriveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 20 || passphrase.length > 4096) {
    throw new Error('NISTI_IMAGE_EXPORT_PASSPHRASE deve ter pelo menos 20 caracteres e estar protegida.');
  }
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export async function encryptImageZip(source, destination, passphrase) {
  if (!source?.endsWith('.zip') || !destination?.endsWith('.zip.nisti.enc')
    || path.resolve(source) === path.resolve(destination)) {
    throw new Error('Informe ZIP de origem e destino terminado em .zip.nisti.enc.');
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const handle = await open(destination, 'wx', 0o600);
  await handle.close();
  try {
    const header = Buffer.concat([MAGIC, salt, iv]);
    const out = createWriteStream(destination, { flags: 'a', mode: 0o600 });
    out.write(header);
    await pipeline(createReadStream(source), cipher, out);
    await appendFile(destination, cipher.getAuthTag());
    return destination;
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
}

async function decryptTo(encrypted, target, passphrase) {
  const handle = await open(encrypted, 'r');
  let fileSize;
  let salt;
  let iv;
  let tag;
  try {
    fileSize = (await handle.stat()).size;
    if (fileSize <= HEADER_LEN + TAG_LEN) throw new Error('Exportação criptografada vazia ou inválida.');
    const header = Buffer.alloc(HEADER_LEN);
    tag = Buffer.alloc(TAG_LEN);
    const first = await handle.read(header, 0, HEADER_LEN, 0);
    const last = await handle.read(tag, 0, TAG_LEN, fileSize - TAG_LEN);
    if (first.bytesRead !== HEADER_LEN || last.bytesRead !== TAG_LEN
      || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Formato de exportação de imagens desconhecido.');
    }
    salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
    iv = header.subarray(MAGIC.length + SALT_LEN);
  } finally {
    await handle.close();
  }
  const cipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  cipher.setAuthTag(tag);
  await pipeline(
    createReadStream(encrypted, { start: HEADER_LEN, end: fileSize - TAG_LEN - 1 }),
    cipher, target
  );
}

export async function verifyEncryptedImageZip(encrypted, passphrase) {
  let bytes = 0;
  await decryptTo(encrypted, new Writable({
    write(chunk, _encoding, callback) { bytes += chunk.length; callback(); }
  }), passphrase);
  return { plaintextBytes: bytes };
}

export async function decryptImageZip(encrypted, outputDir, passphrase) {
  if (!encrypted?.endsWith('.zip.nisti.enc') || !outputDir) {
    throw new Error('Informe arquivo .zip.nisti.enc e pasta de destino.');
  }
  const target = path.join(outputDir, path.basename(encrypted, '.nisti.enc'));
  const handle = await open(target, 'wx', 0o600);
  await handle.close();
  try {
    const stream = createWriteStream(target, { flags: 'w', mode: 0o600 });
    await decryptTo(encrypted, stream, passphrase);
    return target;
  } catch {
    await unlink(target).catch(() => {});
    throw new Error('Senha incorreta ou exportação corrompida; saída parcial descartada.');
  }
}

async function main() {
  const [command, input, arg] = process.argv.slice(2);
  const secret = process.env.NISTI_IMAGE_EXPORT_PASSPHRASE;
  if (command === 'encrypt' && input && arg) {
    await encryptImageZip(input, arg, secret);
    const verified = await verifyEncryptedImageZip(arg, secret);
    console.log('Exportação criptografada e verificada: ' + verified.plaintextBytes + ' bytes.');
    return;
  }
  if (command === 'verify' && input && !arg) {
    const verified = await verifyEncryptedImageZip(input, secret);
    console.log('Criptografia íntegra: ' + verified.plaintextBytes + ' bytes.');
    return;
  }
  if (command === 'decrypt' && input && arg) {
    const location = await decryptImageZip(input, arg, secret);
    console.log('ZIP recuperado localmente: ' + location);
    return;
  }
  throw new Error('Uso: encrypt origem.zip destino.zip.nisti.enc | verify arquivo.zip.nisti.enc | decrypt arquivo.zip.nisti.enc pasta');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Falha segura ao processar exportação: ' + error.message);
    process.exitCode = 1;
  });
}
