// Firebase sign-in errors in plain Swedish.
export function authErrorText(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'Fel e-post eller lösenord.';
  if (code.includes('invalid-email')) return 'E-postadressen ser inte rätt ut.';
  if (code.includes('email-already-in-use')) return 'Det finns redan ett konto med den e-postadressen. Logga in i stället.';
  if (code.includes('weak-password')) return 'Lösenordet är för svagt. Välj minst 8 tecken.';
  if (code.includes('too-many-requests')) return 'För många försök. Vänta en stund och försök igen.';
  if (code.includes('network-request-failed')) return 'Ingen kontakt med Firebase. Kontrollera nätet.';
  if (code.includes('operation-not-allowed')) return 'Inloggning med e-post och lösenord är inte påslagen i Firebase. Slå på den under Authentication.';
  if (code.includes('admin-restricted-operation')) return 'Nya konton är avstängda i Firebase. Logga in med ditt befintliga konto.';
  return 'Inloggningen misslyckades. Försök igen.';
}
