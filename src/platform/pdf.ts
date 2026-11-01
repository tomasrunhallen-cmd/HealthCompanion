// Web: the browser's print dialog, where the person chooses "Spara som PDF". Nothing is uploaded.

export async function sharePdf(html: string, _filename: string): Promise<{ ok: boolean; message: string }> {
  const w = (globalThis as { open?: (url: string, target: string) => { document: { write(s: string): void; close(): void }; focus(): void; print(): void } | null }).open?.('', '_blank');
  if (!w) return { ok: false, message: 'Webbläsaren stoppade fönstret. Tillåt popup-fönster för sidan och försök igen.' };
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
  return { ok: true, message: 'Välj Spara som PDF i utskriftsrutan. Du bestämmer själv vem som får filen.' };
}
