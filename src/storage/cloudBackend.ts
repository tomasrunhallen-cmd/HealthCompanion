// Storage in the user's own Firebase project, for the web version only. The app keeps
// everything in memory (Repository) and writes each change through. Documents live under
// users/{uid}/docs, one per stored item, so security rules can limit each account to its
// own data. Writes are not awaited: Firestore's local cache keeps them and syncs when online.

import { emptySnapshot, type Collection, type DocBackend, type Snapshot, type StorageInfo } from './backend';

/** The few Firestore operations the backend needs, so it can be tested without Firebase. */
export interface CloudDocs {
  list(): Promise<{ id: string; data: CloudDoc }[]>;
  set(id: string, data: CloudDoc): Promise<void>;
  remove(id: string): Promise<void>;
  /** Applies many writes; the implementation splits them into batches Firestore accepts. */
  commit(ops: ({ type: 'set'; id: string; data: CloudDoc } | { type: 'delete'; id: string })[]): Promise<void>;
}

export interface CloudDoc {
  c: Collection;
  i: string;
  /** The item as JSON text: Firestore cannot store every JSON shape (nested arrays). */
  j: string;
  u: string;
}

const COLLECTIONS: Collection[] = ['plan', 'entries', 'assessments', 'kv', 'grund', 'profil', 'dagligt'];

export function docId(c: Collection, id: string): string {
  return `${c}~${encodeURIComponent(id)}`;
}

export function snapshotFrom(rows: { data: CloudDoc }[]): Snapshot {
  const snap = emptySnapshot();
  for (const { data } of rows) {
    if (!COLLECTIONS.includes(data?.c)) continue;
    try {
      snap[data.c][data.i] = JSON.parse(data.j);
    } catch {
      /* skip a damaged item rather than lose everything */
    }
  }
  return snap;
}

function isEmpty(s: Snapshot): boolean {
  return COLLECTIONS.every((c) => Object.keys(s[c]).length === 0);
}

export function cloudBackend(
  docs: CloudDocs,
  opts: { account: string; now?: () => Date; onError?: (message: string) => void },
): DocBackend & { lastError(): string | null } {
  let lastError: string | null = null;
  const now = opts.now ?? (() => new Date());
  const fail = (e: unknown) => {
    const code = String((e as { code?: string })?.code ?? '');
    lastError = code.includes('permission-denied')
      ? 'Firebase nekade skrivningen. Kontrollera reglerna för Firestore.'
      : 'Ändringen kunde inte sparas i Firebase än. Den ligger kvar i webbläsaren och synkas senare.';
    opts.onError?.(lastError);
  };
  const doc = (c: Collection, id: string, value: unknown): CloudDoc => ({ c, i: id, j: JSON.stringify(value), u: now().toISOString() });

  const allOps = (snap: Snapshot) =>
    COLLECTIONS.flatMap((c) => Object.entries(snap[c]).map(([id, v]) => ({ type: 'set' as const, id: docId(c, id), data: doc(c, id, v) })));

  return {
    async load() {
      return snapshotFrom(await docs.list());
    },
    async put(c, id, value) {
      docs.set(docId(c, id), doc(c, id, value)).catch(fail);
    },
    async remove(c, id) {
      docs.remove(docId(c, id)).catch(fail);
    },
    async replaceAll(snapshot) {
      const existing = await docs.list();
      await docs.commit([
        ...existing.map((r) => ({ type: 'delete' as const, id: r.id })),
        ...allOps(snapshot),
      ]);
    },
    async wipe() {
      const existing = await docs.list();
      await docs.commit(existing.map((r) => ({ type: 'delete' as const, id: r.id })));
    },
    info(): StorageInfo {
      return {
        kind: 'cloud',
        encrypted: false,
        detail:
          `Data sparas i ditt eget Firebase-projekt, kopplat till ${opts.account}, och i den här webbläsaren. ` +
          'Google krypterar lagringen på sina servrar, men inte med en nyckel som bara du har.' +
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
