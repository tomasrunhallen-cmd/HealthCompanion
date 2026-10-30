// Saving and opening the encrypted export file. The user decides where it goes
// through the phone's share sheet; the app never uploads it anywhere.
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export function randomBytes(n: number): Uint8Array {
  return Crypto.getRandomBytes(n);
}

export async function saveExportFile(filename: string, content: string): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Spara exportfilen' });
  } finally {
    // The share sheet has made its own copy; do not leave the file in the cache.
    setTimeout(() => {
      try {
        if (file.exists) file.delete();
      } catch {
        /* ignore */
      }
    }, 60_000);
  }
}

export async function pickImportFile(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const file = new File(res.assets[0].uri);
  const text = await file.text();
  try {
    file.delete();
  } catch {
    /* ignore */
  }
  return text;
}
