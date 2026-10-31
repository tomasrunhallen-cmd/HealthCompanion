// Reads the Firebase web config the user pastes into Netlify as EXPO_PUBLIC_FIREBASE_CONFIG.
// Accepts the snippet exactly as the Firebase console shows it (a JavaScript object with
// unquoted keys) as well as plain JSON. The web config is not a secret; Firestore rules
// and sign-in protect the data.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

const REQUIRED: (keyof FirebaseWebConfig)[] = ['apiKey', 'authDomain', 'projectId', 'appId'];
const KNOWN = [...REQUIRED, 'storageBucket', 'messagingSenderId'];

export function parseFirebaseConfig(raw: string | undefined | null): FirebaseWebConfig | null {
  if (!raw || !raw.trim()) return null;
  const out: Record<string, string> = {};
  const re = /["']?([A-Za-z]+)["']?\s*:\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (KNOWN.includes(m[1])) out[m[1]] = m[2].trim();
  }
  return REQUIRED.every((k) => out[k]) ? (out as unknown as FirebaseWebConfig) : null;
}
