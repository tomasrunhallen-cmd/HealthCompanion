// Storage backends. Data is small (one entry per evening), so the repository keeps
// everything in memory and writes each change through to the backend.

// 'plan' is only read by the migration into the context bank ('grund').
export type Collection = 'plan' | 'entries' | 'assessments' | 'kv' | 'grund' | 'profil' | 'dagligt';

export type Snapshot = Record<Collection, Record<string, unknown>>;

export interface StorageInfo {
  kind: 'sqlite' | 'browser' | 'memory' | 'cloud';
  /** True when the database file is encrypted (SQLCipher). Null when unknown. */
  encrypted: boolean | null;
  detail: string;
}

export interface DocBackend {
  load(): Promise<Snapshot>;
  put(collection: Collection, id: string, doc: unknown): Promise<void>;
  remove(collection: Collection, id: string): Promise<void>;
  /** Replaces everything (used by import). */
  replaceAll(snapshot: Snapshot): Promise<void>;
  /** Deletes all data and keys. */
  wipe(): Promise<void>;
  info(): StorageInfo;
}

export function emptySnapshot(): Snapshot {
  return { plan: {}, entries: {}, assessments: {}, kv: {}, grund: {}, profil: {}, dagligt: {} };
}

export function memoryBackend(initial?: Snapshot): DocBackend {
  let data: Snapshot = initial ? JSON.parse(JSON.stringify(initial)) : emptySnapshot();
  return {
    async load() {
      return JSON.parse(JSON.stringify(data));
    },
    async put(c, id, doc) {
      data[c][id] = JSON.parse(JSON.stringify(doc));
    },
    async remove(c, id) {
      delete data[c][id];
    },
    async replaceAll(s) {
      data = JSON.parse(JSON.stringify(s));
    },
    async wipe() {
      data = emptySnapshot();
    },
    info() {
      return { kind: 'memory', encrypted: null, detail: 'Endast i minnet, försvinner när appen stängs.' };
    },
  };
}
