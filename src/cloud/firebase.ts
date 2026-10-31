// Phone app and tests: no Firebase. The phone keeps everything on the device.
import type { CloudDocs } from '../storage/cloudBackend';

export interface CloudUser {
  uid: string;
  email: string | null;
}

export const cloudConfigured = false;

export function onUserChanged(cb: (u: CloudUser | null) => void): () => void {
  cb(null);
  return () => undefined;
}

export async function signIn(_email: string, _password: string): Promise<void> {}
export async function signUp(_email: string, _password: string): Promise<void> {}
export async function resetPassword(_email: string): Promise<void> {}
export async function signOutUser(): Promise<void> {}

export function cloudDocsFor(_uid: string): CloudDocs {
  throw new Error('Firebase används bara i webbversionen.');
}
