// Saving and opening the encrypted export file. The user decides where it goes
// through the phone's share sheet; the app never uploads it anywhere.
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export function randomBytes(n: number): Uint8Array {
  return Crypto.getRandomBytes(n);
}

export async function saveExportFile(filename: string, content: string, mimeType = 'application/json'): Promise<void> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: `Spara ${filename}` });
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

export async function pickImportFile(types: string[] = ['application/json', '*/*']): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
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

/** Several text files at once, for an import from another diary. Empty when cancelled. */
export async function pickTextFiles(types: string[] = ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*']): Promise<{ name: string; text: string }[]> {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: true });
  if (res.canceled || !res.assets?.length) return [];
  const out: { name: string; text: string }[] = [];
  for (const a of res.assets) {
    const file = new File(a.uri);
    out.push({ name: a.name, text: await file.text() });
    try {
      file.delete();
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** One binary file, for a crisis plan as PDF or .docx. Read on the phone and deleted from the cache. */
export async function pickBinaryFile(types: string[]): Promise<{ name: string; data: Uint8Array } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const file = new File(res.assets[0].uri);
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    file.delete();
  } catch {
    /* ignore */
  }
  return { name: res.assets[0].name, data };
}
