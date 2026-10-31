// Firebase sign-in errors in plain Swedish.
export function authErrorText(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'Fel e-post eller lösenord.';
  if (code.includes('invalid-email')) return 'E-postadressen ser inte rätt ut.';
  if (code.includes('too-many-requests')) return 'För många försök. Vänta en stund och försök igen.';
  if (code.includes('network-request-failed')) return 'Ingen kontakt med Firebase. Kontrollera nätet.';
  if (code.includes('operation-not-allowed')) return 'Inloggning med e-post och lösenord är inte påslagen i Firebase. Slå på den under Authentication.';
  return 'Inloggningen misslyckades. Försök igen.';
}
