// Web preview: download and pick files through the browser.
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export async function saveExportFile(filename: string, content: string): Promise<void> {
  const doc = (globalThis as { document?: any }).document;
  if (!doc) throw new Error('Export stöds inte här');
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function pickImportFile(): Promise<string | null> {
  const doc = (globalThis as { document?: any }).document;
  if (!doc) return null;
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? await f.text() : null);
    };
    input.click();
  });
}
