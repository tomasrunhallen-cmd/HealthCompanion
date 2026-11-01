// Encryption for the web version's Firebase storage. Everything the app stores (notes,
// crisis plan, context bank, assessments, settings) is encrypted in the browser before it
// is written to Firestore, with a key derived from a password that never leaves the
// browser. Forgotten password: the data cannot be read by anyone, including the user.
//
// Key derivation: PBKDF2-SHA256, 600 000 iterations (OWASP's figure for PBKDF2-HMAC-SHA256),
// 512 bits: the first half is an AES-256-GCM key for the content, the second an HMAC-SHA256
// key that turns each item's id into an opaque document id, so neither the kind of item
// nor dates in ids are visible in Firebase. Both keys are non-extractable Web Crypto keys,
// kept in memory only.

export const VAULT_FORMAT = 'dagsljus-vault';
export const VAULT_ITERATIONS = 600_000;
/** Firestore document holding the salt and a check value. Not secret, never encrypted. */
export const VAULT_DOC_ID = '_vault';
export const MIN_PASSWORD_LENGTH = 10;

const CHECK_TEXT = 'dagsljus-vault-ok';
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface Sealed {
  iv: string;
  d: string;
}

export interface VaultHeader {
  format: typeof VAULT_FORMAT;
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  cipher: 'AES-256-GCM';
  /** A known text encrypted with the key: tells a wrong password from damaged data. */
  check: Sealed;
  createdAt: string;
}

export interface Vault {
  /** The opaque Firestore document id for an item id ("entries~e_123"). */
  docIdFor(plainId: string): Promise<string>;
  seal(plainId: string, text: string): Promise<Sealed>;
  open(plainId: string, sealed: Sealed): Promise<string>;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Fel lösenord.');
  }
}

/** Web Crypto: the browser's own, or Node's in tests. */
export interface CryptoLike {
  subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

function webCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c?.subtle) throw new Error('Webbläsaren saknar Web Crypto. Använd en aktuell webbläsare över https.');
  return c;
}

export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64url(bytes: ArrayBuffer): string {
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deriveKeys(c: CryptoLike, password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await c.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 512));
  const aes = await c.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const mac = await c.subtle.importKey('raw', bits.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  bits.fill(0);
  return { aes, mac };
}

function vaultFrom(c: CryptoLike, aes: CryptoKey, mac: CryptoKey): Vault {
  return {
    async docIdFor(plainId) {
      return `x${b64url(await c.subtle.sign('HMAC', mac, enc.encode(plainId)))}`;
    },
    async seal(plainId, text) {
      const iv = c.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
      // The item id is bound to the ciphertext, so an item cannot be moved to another id.
      const d = await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(plainId) }, aes, enc.encode(text));
      return { iv: b64(iv), d: b64(d) };
    },
    async open(plainId, sealed) {
      const plain = await c.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: enc.encode(plainId) },
        aes,
        unb64(sealed.d),
      );
      return dec.decode(plain);
    },
  };
}

/** A new vault for a new password: the header to store in Firestore, and the open vault. */
export async function createVault(
  password: string,
  opts: { crypto?: CryptoLike; iterations?: number; now?: Date } = {},
): Promise<{ header: VaultHeader; vault: Vault }> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Lösenordet behöver minst ${MIN_PASSWORD_LENGTH} tecken.`);
  const c = opts.crypto ?? webCrypto();
  const iterations = opts.iterations ?? VAULT_ITERATIONS;
  const salt = c.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const { aes, mac } = await deriveKeys(c, password, salt, iterations);
  const vault = vaultFrom(c, aes, mac);
  const header: VaultHeader = {
    format: VAULT_FORMAT,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64(salt) },
    cipher: 'AES-256-GCM',
    check: await vault.seal(VAULT_DOC_ID, CHECK_TEXT),
    createdAt: (opts.now ?? new Date()).toISOString(),
  };
  return { header, vault };
}

/** Opens the vault with the password. Throws WrongPasswordError when it does not fit. */
export async function openVault(password: string, header: VaultHeader, opts: { crypto?: CryptoLike } = {}): Promise<Vault> {
  if (header?.format !== VAULT_FORMAT || header.version !== 1) throw new Error('Krypteringsuppgifterna i Firebase känns inte igen.');
  const c = opts.crypto ?? webCrypto();
  const { aes, mac } = await deriveKeys(c, password, unb64(header.kdf.salt), header.kdf.iterations);
  const vault = vaultFrom(c, aes, mac);
  try {
    if ((await vault.open(VAULT_DOC_ID, header.check)) !== CHECK_TEXT) throw new WrongPasswordError();
  } catch {
    throw new WrongPasswordError();
  }
  return vault;
}

export function isVaultHeader(x: unknown): x is VaultHeader {
  return !!x && (x as VaultHeader).format === VAULT_FORMAT;
}
