// Passphrase encryption, using the Web Crypto built into browsers. A key is stretched from
// your passphrase with PBKDF2 and the data is sealed with AES-GCM, which also detects any
// change to the file. There is no recovery: a lost passphrase means lost data.

export const ITERATIONS = 600000; // the OWASP recommendation for PBKDF2-SHA256
const MIN_ITERATIONS = 100000;
const MAX_ITERATIONS = 10000000; // a tampered file must not be able to hang the app
export const MIN_PASSPHRASE = 12;

export const BACKUP_FORMAT = 'finance-backup';
export const LOCK_FORMAT = 'finance-lock';

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

export function checkPassphrase(passphrase) {
  if (String(passphrase ?? '').length < MIN_PASSPHRASE) {
    throw new Error(`Please use at least ${MIN_PASSPHRASE} characters. Several unrelated words work well.`);
  }
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); // false: the key can never be read out
}

// The header is authenticated too, so swapping its format or settings breaks the seal.
const headerBytes = (format, iterations, saltB64) => new TextEncoder().encode(`${format}|1|${iterations}|${saltB64}`);

// Make a new key from a passphrase. Returned as a handle to keep in memory while unlocked.
export async function createKey(passphrase) {
  checkPassphrase(passphrase);
  const salt = random(16);
  return { key: await deriveKey(passphrase, salt, ITERATIONS), salt: toB64(salt), iterations: ITERATIONS };
}

export async function seal(handle, format, data) {
  const iv = random(12); // new every time, which AES-GCM requires
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: headerBytes(format, handle.iterations, handle.salt) }, handle.key, plain);
  return {
    format, version: 1, kdf: 'PBKDF2-SHA256', iterations: handle.iterations, salt: handle.salt,
    iv: toB64(iv), ciphertext: toB64(new Uint8Array(sealed)),
  };
}

export const isEnvelope = (value, format) => Boolean(value) && value.format === format;

// Returns { data, handle }, or throws one message for a wrong passphrase or a damaged file,
// because the two cannot be told apart.
export async function unseal(envelope, passphrase, format) {
  if (!isEnvelope(envelope, format) || envelope.version !== 1) throw new Error('This is not a backup file this app can read.');
  const { iterations, salt, iv, ciphertext } = envelope;
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('This file has unsafe encryption settings, so it was not opened.');
  }
  let opened;
  let key;
  try {
    key = await deriveKey(String(passphrase ?? ''), fromB64(salt), iterations);
    opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: headerBytes(format, iterations, salt) }, key, fromB64(ciphertext));
  } catch {
    throw new Error('Wrong passphrase, or the file is damaged.');
  }
  return { data: JSON.parse(new TextDecoder().decode(opened)), handle: { key, salt, iterations } };
}
