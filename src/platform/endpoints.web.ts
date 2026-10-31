// Garmin refuses calls from a browser, so the hosted web version goes through its own
// Netlify function (netlify/functions/garmin.mjs). EXPO_PUBLIC_GARMIN_PROXY is set in
// netlify.toml; a plain `npm run web` calls Garmin directly and will be refused.
import { GARMIN_BASE_URL } from '../garmin/client';

export function garminBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_GARMIN_PROXY === '1' && typeof location !== 'undefined') {
    return `${location.origin}/api/garmin`;
  }
  return GARMIN_BASE_URL;
}
