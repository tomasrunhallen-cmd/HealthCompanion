// Phone: the HTML becomes a PDF on the phone and opens in the share sheet. The app sends nothing
// itself; the person chooses where the file goes.
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export async function sharePdf(html: string, filename: string): Promise<{ ok: boolean; message: string }> {
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: filename });
  return { ok: true, message: 'Du bestämmer själv vem som får filen.' };
}
