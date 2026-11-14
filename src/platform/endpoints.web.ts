// Garmin refuses calls from a browser, so the hosted web version goes through its own
// Netlify function (netlify/functions/garmin.mjs). EXPO_PUBLIC_GARMIN_PROXY is set in
// netlify.toml; a plain `npm run web` calls Garmin directly and will be refused.
import { currentIdToken } from '../cloud/firebase';
import { GARMIN_BASE_URL, type GarminFetch } from '../garmin/client';

const viaFunction = () => process.env.EXPO_PUBLIC_GARMIN_PROXY === '1' && typeof location !== 'undefined';

export function garminBaseUrl(): string {
  return viaFunction() ? `${location.origin}/api/garmin` : GARMIN_BASE_URL;
}

/** The header the function reads the sign-in from. The same name as in netlify/lib/auth.mjs. */
export const AUTH_HEADER = 'x-dagsljus-auth';

/**
 * Through the function, every call carries the signed-in person's Firebase ID token: the
 * function forwards nothing without it. Garmin's own key and token stay in Authorization.
 */
export function garminFetch(): GarminFetch | undefined {
  if (!viaFunction()) return undefined;
  return async (url, init) => {
    const token = await currentIdToken();
    return fetch(url, { ...init, headers: token ? { ...init.headers, [AUTH_HEADER]: token } : init.headers });
  };
}
