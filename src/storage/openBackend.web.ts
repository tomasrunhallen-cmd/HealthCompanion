// Web preview only (browser demo of step 1). Stores data in this browser's localStorage,
// unencrypted, and falls back to memory where storage is blocked. Not for real use.

import { emptySnapshot, memoryBackend, type DocBackend, type Snapshot } from './backend';

const KEY = 'dagsljus.preview.v1';

function read(): Snapshot | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { ...emptySnapshot(), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function write(s: Snapshot): boolean {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export async function openBackend(): Promise<DocBackend> {
  const initial = read() ?? emptySnapshot();
  const ok = write(initial);
  if (!ok) return memoryBackend(initial);
  let data = initial;
  const persist = () => write(data);
  return {
    async load() {
      return JSON.parse(JSON.stringify(data));
    },
    async put(c, id, doc) {
      data[c][id] = JSON.parse(JSON.stringify(doc));
      persist();
    },
    async remove(c, id) {
      delete data[c][id];
      persist();
    },
    async replaceAll(s) {
      data = JSON.parse(JSON.stringify(s));
      persist();
    },
    async wipe() {
      data = emptySnapshot();
      try {
        globalThis.localStorage?.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
    info() {
      return {
        kind: 'browser',
        encrypted: false,
        detail: 'Webbförhandsvisning: data sparas okrypterat i den här webbläsaren. Använd inte riktiga uppgifter här.',
      };
    },
  };
}
