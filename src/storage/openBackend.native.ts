// SQLite on the phone, encrypted with SQLCipher in a development build.
// The database key is random, created on first start and kept in Keychain/Keystore.
// In Expo Go SQLCipher is not available: the database then works unencrypted and the
// "Data och integritet" screen says so.

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { emptySnapshot, type Collection, type DocBackend, type Snapshot, type StorageInfo } from './backend';

const DB_NAME = 'dagsljus.db';
const KEY_NAME = 'dagsljus.dbkey.v1';
const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME, SECURE_OPTS);
  if (existing) return existing;
  const key = toHex(Crypto.getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAME, key, SECURE_OPTS);
  return key;
}

async function open(): Promise<{ db: SQLite.SQLiteDatabase; info: StorageInfo }> {
  const key = await getOrCreateKey();
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Must be the first statement on the connection. Plain SQLite ignores unknown pragmas.
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  let encrypted = false;
  try {
    const row = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version;');
    encrypted = !!row?.cipher_version;
  } catch {
    encrypted = false;
  }
  await db.execAsync(
    'PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS docs (collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (collection, id));',
  );
  return {
    db,
    info: {
      kind: 'sqlite',
      encrypted,
      detail: encrypted
        ? 'SQLite krypterad med SQLCipher. Nyckeln ligger i telefonens nyckelring.'
        : 'SQLite utan kryptering. SQLCipher kräver en utvecklingsbuild; i Expo Go är databasen okrypterad.',
    },
  };
}

export async function openBackend(_user?: unknown, _vault?: unknown): Promise<DocBackend> {
  let { db, info } = await open();
  return {
    async load() {
      const snap: Snapshot = emptySnapshot();
      const rows = await db.getAllAsync<{ collection: Collection; id: string; json: string }>(
        'SELECT collection, id, json FROM docs',
      );
      for (const r of rows) if (r.collection in snap) snap[r.collection][r.id] = JSON.parse(r.json);
      return snap;
    },
    async put(collection, id, doc) {
      await db.runAsync(
        'INSERT OR REPLACE INTO docs (collection, id, json) VALUES (?, ?, ?)',
        collection, id, JSON.stringify(doc),
      );
    },
    async remove(collection, id) {
      await db.runAsync('DELETE FROM docs WHERE collection = ? AND id = ?', collection, id);
    },
    async replaceAll(snapshot) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM docs');
        for (const c of Object.keys(snapshot) as Collection[]) {
          for (const [id, doc] of Object.entries(snapshot[c])) {
            await db.runAsync('INSERT INTO docs (collection, id, json) VALUES (?, ?, ?)', c, id, JSON.stringify(doc));
          }
        }
      });
    },
    async wipe() {
      await db.closeAsync();
      await SQLite.deleteDatabaseAsync(DB_NAME);
      await SecureStore.deleteItemAsync(KEY_NAME, SECURE_OPTS);
      // Reopen with a fresh key so the app keeps working after "Radera allt".
      ({ db, info } = await open());
    },
    info() {
      return info;
    },
  };
}
