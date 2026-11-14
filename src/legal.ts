// Public links the App Store requires (Review Guidelines 5.1.1): the privacy policy,
// built from INTEGRITETSPOLICY.md by scripts/build-policy.js and served by the app's site.
/** The address the app's site is published at. Checked 14 November 2026: no site answers here yet. */
export const PUBLISHED_SITE_URL = 'https://dagsljus.netlify.app';

/**
 * The web version is its own site and has the policy page beside it, so there the link follows
 * the address the app was opened from. The phone app has no site of its own and uses the published one.
 */
export function siteUrl(origin: string | null | undefined = (globalThis as { location?: { origin?: string } }).location?.origin): string {
  return origin && /^https?:\/\//.test(origin) ? origin : PUBLISHED_SITE_URL;
}

export const SITE_URL = siteUrl();
export const PRIVACY_POLICY_URL = `${SITE_URL}/integritet.html`;

/** Review Guidelines 1.4.1: remind people to check with a doctor before medical decisions. */
export const MEDICAL_REMINDER = 'Appen ställer ingen diagnos och ersätter inte vården. Prata med din läkare eller vårdkontakt innan du fattar beslut om din behandling.';
