// Storage in the user's own Firebase project, for the web version only. The app keeps
// everything in memory (Repository) and writes each change through. Documents live under
// users/{uid}/docs, one per stored item, so security rules can limit each account to its
// own data. Writes are not awaited: Firestore's local cache keeps them and syncs when online.
//
// With a vault (src/cloud/vault.ts) every item is encrypted in the browser before it is
// written: the document id is an HMAC of the item's id and the content is AES-256-GCM.
// Firebase then holds only ciphertext, the salt and a check value.

import { VAULT_DOC_ID, type Sealed, type Vault, type VaultHeader } from '../cloud/vault';
import { emptySnapshot, type Collection, type DocBackend, type Snapshot, type StorageInfo } from './backend';

/** An item stored as plain JSON text: the format before encryption. */
export interface CloudDoc {
  c: Collection;
  i: string;
  /** The item as JSON text: Firestore cannot store every JSON shape (nested arrays). */
  j: string;
  u: string;
}

/** An encrypted item. Collection, id and content are all inside the ciphertext. */
export interface SealedDoc extends Sealed {
  e: 1;
}

export type StoredDoc = CloudDoc | SealedDoc | VaultHeader;

/** The few Firestore operations the backend needs, so it can be tested without Firebase. */
export interface CloudDocs {
  list(): Promise<{ id: string; data: StoredDoc }[]>;
  get(id: string): Promise<StoredDoc | null>;
  set(id: string, data: StoredDoc): Promise<void>;
  remove(id: string): Promise<void>;
  /** Applies many writes; the implementation splits them into batches Firestore accepts. */
  commit(ops: ({ type: 'set'; id: string; data: StoredDoc } | { type: 'delete'; id: string })[]): Promise<void>;
}

const COLLECTIONS: Collection[] = ['plan', 'entries', 'assessments', 'kv', 'grund', 'profil', 'dagligt'];

export function docId(c: Collection, id: string): string {
  return `${c}~${encodeURIComponent(id)}`;
}

export function isPlainDoc(d: unknown): d is CloudDoc {
  return !!d && COLLECTIONS.includes((d as CloudDoc).c) && typeof (d as CloudDoc).j === 'string';
}

export function isSealedDoc(d: unknown): d is SealedDoc {
  return !!d && (d as SealedDoc).e === 1 && typeof (d as SealedDoc).d === 'string';
}

export function snapshotFrom(rows: { data: StoredDoc }[]): Snapshot {
  const snap = emptySnapshot();
  for (const { data } of rows) {
    if (!isPlainDoc(data)) continue;
    try {
      snap[data.c][data.i] = JSON.parse(data.j);
    } catch {
      /* skip a damaged item rather than lose everything */
    }
  }
  return snap;
}

/** What an encrypted item holds once opened. */
interface Inner {
  c: Collection;
  i: string;
  v: unknown;
}

async function sealItem(vault: Vault, c: Collection, i: string, v: unknown): Promise<{ id: string; data: SealedDoc }> {
  const id = await vault.docIdFor(docId(c, i));
  const sealed = await vault.seal(id, JSON.stringify({ c, i, v } satisfies Inner));
  return { id, data: { e: 1, ...sealed } };
}

/** Opens every encrypted item. Throws when one cannot be opened: better to stop than to show half the data. */
export async function openSnapshot(rows: { id: string; data: StoredDoc }[], vault: Vault): Promise<Snapshot> {
  const snap = emptySnapshot();
  for (const { id, data } of rows) {
    if (!isSealedDoc(data)) continue;
    let inner: Inner;
    try {
      inner = JSON.parse(await vault.open(id, data)) as Inner;
    } catch {
      throw new Error('En post i Firebase gick inte att låsa upp. Den kan vara skadad, eller krypterad med ett annat lösenord.');
    }
    if (COLLECTIONS.includes(inner.c)) snap[inner.c][inner.i] = inner.v;
  }
  return snap;
}

function isEmpty(s: Snapshot): boolean {
  return COLLECTIONS.every((c) => Object.keys(s[c]).length === 0);
}

export function cloudBackend(
  docs: CloudDocs,
  opts: { account: string; vault?: Vault; now?: () => Date; onError?: (message: string) => void },
): DocBackend & { lastError(): string | null } {
  let lastError: string | null = null;
  const now = opts.now ?? (() => new Date());
  const vault = opts.vault ?? null;
  const fail = (e: unknown) => {
    const code = String((e as { code?: string })?.code ?? '');
    lastError = code.includes('permission-denied')
      ? 'Firebase nekade skrivningen. Kontrollera reglerna för Firestore.'
      : 'Ändringen kunde inte sparas i Firebase än. Den ligger kvar i webbläsaren och synkas senare.';
    opts.onError?.(lastError);
  };
  const plain = (c: Collection, id: string, value: unknown): { id: string; data: CloudDoc } => ({
    id: docId(c, id),
    data: { c, i: id, j: JSON.stringify(value), u: now().toISOString() },
  });
  const item = (c: Collection, id: string, value: unknown) => (vault ? sealItem(vault, c, id, value) : Promise.resolve(plain(c, id, value)));
  const target = async (c: Collection, id: string) => (vault ? vault.docIdFor(docId(c, id)) : docId(c, id));

  // Writes made here that Firebase has not confirmed, per document.
  const unsent = new Map<string, number>();
  const sending = (c: Collection, id: string) => {
    const k = docId(c, id);
    unsent.set(k, (unsent.get(k) ?? 0) + 1);
    let once = false;
    return () => {
      if (once) return;
      once = true;
      const n = (unsent.get(k) ?? 1) - 1;
      if (n > 0) unsent.set(k, n);
      else unsent.delete(k);
    };
  };

  // Encryption is asynchronous; a queue keeps the writes in the order the app made them.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).catch(fail);
  };

  const allOps = async (snap: Snapshot) => {
    const out: { type: 'set'; id: string; data: StoredDoc }[] = [];
    for (const c of COLLECTIONS) {
      for (const [id, v] of Object.entries(snap[c])) {
        const it = await item(c, id, v);
        out.push({ type: 'set', id: it.id, data: it.data });
      }
    }
    return out;
  };

  return {
    async load() {
      await queue;
      const rows = await docs.list();
      return vault ? openSnapshot(rows, vault) : snapshotFrom(rows);
    },
    async put(c, id, value) {
      const done = sending(c, id);
      enqueue(async () => {
        try {
          const it = await item(c, id, value);
          docs.set(it.id, it.data).catch(fail).finally(done);
        } catch (e) {
          done();
          throw e;
        }
      });
    },
    async fetch(c, id) {
      // Asks Firebase, since another device may have written since loading; unless this browser's
      // own write is still on its way (or waiting for the network), which is then the newest.
      if (unsent.get(docId(c, id))) return 'pending';
      const at = await target(c, id);
      const d = await docs.get(at);
      if (!d) return { stored: undefined };
      if (vault) return { stored: isSealedDoc(d) ? (JSON.parse(await vault.open(at, d)) as Inner).v : undefined };
      return { stored: isPlainDoc(d) ? JSON.parse(d.j) : undefined };
    },
    async remove(c, id) {
      const done = sending(c, id);
      enqueue(async () => {
        try {
          docs.remove(await target(c, id)).catch(fail).finally(done);
        } catch (e) {
          done();
          throw e;
        }
      });
    },
    async replaceAll(snapshot) {
      await queue;
      const existing = await docs.list();
      await docs.commit([
        // The vault header stays: it holds the salt, without which nothing can be opened.
        ...existing.filter((r) => r.id !== VAULT_DOC_ID).map((r) => ({ type: 'delete' as const, id: r.id })),
        ...(await allOps(snapshot)),
      ]);
    },
    async wipe() {
      await queue;
      const existing = await docs.list();
      await docs.commit(existing.map((r) => ({ type: 'delete' as const, id: r.id })));
    },
    info(): StorageInfo {
      return {
        kind: 'cloud',
        encrypted: !!vault,
        detail:
          `Data sparas i ditt eget Firebase-projekt, kopplat till ${opts.account}, och i den här webbläsaren. ` +
          (vault
            ? 'Allt krypteras i webbläsaren med en nyckel från ditt lösenord innan det sparas. Lösenordet lämnar aldrig webbläsaren.'
            : 'Google krypterar lagringen på sina servrar, men inte med en nyckel som bara du har.') +
          (lastError ? ` ${lastError}` : ''),
      };
    },
    lastError: () => lastError,
  };
}

/** Moves data from the old browser-only storage into an empty cloud store, once. */
export async function adoptLocalData(backend: DocBackend, local: Snapshot | null): Promise<boolean> {
  if (!local || isEmpty(local)) return false;
  const cloud = await backend.load();
  if (!isEmpty(cloud)) return false;
  await backend.replaceAll(local);
  return true;
}

/** Firestore operations on a copy in memory: the migration's trial run, and tests. */
export function memoryCloudDocs(rows: { id: string; data: StoredDoc }[] = []): CloudDocs & { store: Map<string, StoredDoc> } {
  const store = new Map<string, StoredDoc>(rows.map((r) => [r.id, JSON.parse(JSON.stringify(r.data))]));
  return {
    store,
    async list() {
      return Array.from(store, ([id, data]) => ({ id, data: JSON.parse(JSON.stringify(data)) }));
    },
    async get(id) {
      const d = store.get(id);
      return d ? JSON.parse(JSON.stringify(d)) : null;
    },
    async set(id, data) {
      store.set(id, JSON.parse(JSON.stringify(data)));
    },
    async remove(id) {
      store.delete(id);
    },
    async commit(ops) {
      for (const op of ops) {
        if (op.type === 'set') store.set(op.id, JSON.parse(JSON.stringify(op.data)));
        else store.delete(op.id);
      }
    },
  };
}

// ---- encrypting data stored before the vault ----

export interface MigrationReport {
  /** Plain items found. */
  found: number;
  /** Encrypted items opened again and equal to the originals. */
  verified: number;
  /** Plain items removed after the check. Always 0 in a trial run on the real data. */
  removed: number;
  perCollection: Partial<Record<Collection, number>>;
  ok: boolean;
  /** Why the migration stopped, in Swedish. The plain items are then untouched. */
  problem: string | null;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Counts the plain (unencrypted) items in the store. */
export async function countPlain(docs: CloudDocs): Promise<number> {
  return (await docs.list()).filter((r) => isPlainDoc(r.data)).length;
}

/**
 * Encrypts every plain item. The encrypted copies are written beside the originals, read
 * back, opened and compared item by item; only when every one is equal are the originals
 * removed. On any difference the copies are removed again and the originals stay as they
 * were. Safe to run again after an interruption. With `trial`, everything happens on a copy
 * in memory and Firebase is not touched.
 */
export async function encryptExisting(docs: CloudDocs, vault: Vault, opts: { trial?: boolean } = {}): Promise<MigrationReport> {
  const target = opts.trial ? memoryCloudDocs(await docs.list()) : docs;
  const rows = (await target.list()).filter((r) => isPlainDoc(r.data)) as { id: string; data: CloudDoc }[];
  const report: MigrationReport = { found: rows.length, verified: 0, removed: 0, perCollection: {}, ok: true, problem: null };
  if (!rows.length) return report;

  const originals = new Map<string, { c: Collection; i: string; v: unknown }>();
  for (const r of rows) {
    try {
      originals.set(docId(r.data.c, r.data.i), { c: r.data.c, i: r.data.i, v: JSON.parse(r.data.j) });
    } catch {
      return { ...report, ok: false, problem: `Posten ${r.id} i Firebase går inte att läsa. Inget har ändrats.` };
    }
  }

  const written: string[] = [];
  const sets: { type: 'set'; id: string; data: StoredDoc }[] = [];
  for (const o of originals.values()) {
    const it = await sealItem(vault, o.c, o.i, o.v);
    written.push(it.id);
    sets.push({ type: 'set', id: it.id, data: it.data });
  }
  await target.commit(sets);

  // Read back and compare every item before anything is removed.
  let opened: Snapshot;
  try {
    opened = await openSnapshot(await target.list(), vault);
  } catch (e) {
    await target.commit(written.map((id) => ({ type: 'delete' as const, id })));
    return { ...report, ok: false, problem: `${(e as Error).message} De okrypterade posterna är orörda.` };
  }
  for (const o of originals.values()) {
    if (!(o.i in opened[o.c]) || canonical(opened[o.c][o.i]) !== canonical(o.v)) {
      await target.commit(written.map((id) => ({ type: 'delete' as const, id })));
      return { ...report, ok: false, problem: 'En krypterad post stämde inte med originalet. De okrypterade posterna är orörda.' };
    }
    report.verified++;
    report.perCollection[o.c] = (report.perCollection[o.c] ?? 0) + 1;
  }

  await target.commit(rows.map((r) => ({ type: 'delete' as const, id: r.id })));
  report.removed = opts.trial ? 0 : rows.length;
  return report;
}
