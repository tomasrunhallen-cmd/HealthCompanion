// What the privacy view says about where data is kept, per storage mode. Every sentence has to
// be true in the mode the person is in: the app on a phone, the web version with an account, or
// the preview in a browser without an account.

/** The storage modes, as the storage layer names them (kept here so the core imports nothing from it). */
export type StorageKind = 'sqlite' | 'browser' | 'memory' | 'cloud';

export interface StorageText {
  /** Which version this is, in a few words. */
  mode: string;
  heading: string;
  /** Where the crisis plan, notes and assessments are kept. */
  where: string;
  encryption: string;
}

export function storageText(info: { kind: StorageKind; encrypted: boolean | null }): StorageText {
  switch (info.kind) {
    case 'cloud':
      return {
        mode: 'Webbversionen med konto',
        heading: 'Lagring i ditt konto',
        where: 'I ditt eget Firebase-projekt, bakom din inloggning, och i den här webbläsaren. Allt krypteras i webbläsaren med en nyckel från ditt lösenord innan det sparas, så Firebase och Google ser bara krypterad data. Lösenordet lämnar aldrig webbläsaren.',
        encryption: 'Kryptering: på, med en nyckel från ditt krypteringslösenord.',
      };
    case 'sqlite':
      return {
        mode: 'Appen på telefonen',
        heading: 'Lagring på den här telefonen',
        where: 'Sparas bara på den här telefonen. Det finns ingen server och inget konto.',
        encryption: `Kryptering: ${info.encrypted === true ? 'på (SQLCipher)' : info.encrypted === false ? 'av' : 'okänd'}.`,
      };
    case 'browser':
      return {
        mode: 'Förhandsvisning i webbläsaren, utan konto',
        heading: 'Lagring i den här webbläsaren',
        where: 'Sparas bara i den här webbläsaren på den här enheten. Det finns ingen server och inget konto i förhandsvisningen.',
        encryption: 'Kryptering: av. Använd inte förhandsvisningen för riktiga uppgifter.',
      };
    case 'memory':
      return {
        mode: 'Tillfällig visning',
        heading: 'Ingen lagring',
        where: 'Inget sparas. Allt försvinner när sidan stängs.',
        encryption: 'Kryptering: inte aktuell, inget sparas.',
      };
  }
}
