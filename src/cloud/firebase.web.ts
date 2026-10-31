// Web version only: sign-in and storage in the user's own Firebase project, configured in
// projectConfig.ts. Accounts are added in the Firebase console; the app has no sign-up.
// Only Auth and Firestore are loaded: no Analytics or other Firebase services.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence, indexedDBLocalPersistence, initializeAuth,
  onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type Auth,
} from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDocs, getDocsFromCache, initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, setDoc, writeBatch, type Firestore,
} from 'firebase/firestore';
import type { CloudDoc, CloudDocs } from '../storage/cloudBackend';
import { parseFirebaseConfig } from './config';
import { FIREBASE_WEB_CONFIG } from './projectConfig';

export interface CloudUser {
  uid: string;
  email: string | null;
}

const config = parseFirebaseConfig(process.env.EXPO_PUBLIC_FIREBASE_CONFIG || FIREBASE_WEB_CONFIG);

export const cloudConfigured = config != null;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init(): { auth: Auth; db: Firestore } {
  if (!config) throw new Error('Firebase är inte inställt.');
  if (!app) {
    app = initializeApp(config);
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
    // Local cache in IndexedDB: the app works offline and syncs when back online.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  }
  return { auth: auth!, db: db! };
}

export function onUserChanged(cb: (u: CloudUser | null) => void): () => void {
  if (!cloudConfigured) {
    cb(null);
    return () => undefined;
  }
  return onAuthStateChanged(init().auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null));
}

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(init().auth, email.trim(), password);
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(init().auth, email.trim());
}

export async function signOutUser(): Promise<void> {
  await signOut(init().auth);
}

const BATCH_LIMIT = 450;

export function cloudDocsFor(uid: string): CloudDocs {
  const { db } = init();
  const col = collection(db, 'users', uid, 'docs');
  return {
    async list() {
      let snap;
      try {
        snap = await getDocs(col);
      } catch {
        snap = await getDocsFromCache(col);
      }
      return snap.docs.map((d) => ({ id: d.id, data: d.data() as CloudDoc }));
    },
    async set(id, data) {
      await setDoc(doc(col, id), data);
    },
    async remove(id) {
      await deleteDoc(doc(col, id));
    },
    async commit(ops) {
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const op of ops.slice(i, i + BATCH_LIMIT)) {
          if (op.type === 'set') batch.set(doc(col, op.id), op.data);
          else batch.delete(doc(col, op.id));
        }
        await batch.commit();
      }
    },
  };
}
