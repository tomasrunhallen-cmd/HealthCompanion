// Web version. With Firebase configured and the user signed in, data lives in the user's
// own Firestore (cloudBackend). Without Firebase it stays in this browser's localStorage,
// unencrypted, falling back to memory where storage is blocked.

import { cloudDocsFor, cloudConfigured, type CloudUser } from '../cloud/firebase';
import { emptySnapshot, memoryBackend, type DocBackend, type Snapshot } from './backend';
import { adoptLocalData, cloudBackend } from './cloudBackend';

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

export async function openBackend(user?: CloudUser | null): Promise<DocBackend> {
  if (cloudConfigured && user) {
    const backend = cloudBackend(cloudDocsFor(user.uid), { account: user.email ?? 'ditt konto' });
    // Data saved in the browser before Firebase was set up moves into an empty cloud store once.
    if (await adoptLocalData(backend, read())) {
      try {
        globalThis.localStorage?.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
    return backend;
  }
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
