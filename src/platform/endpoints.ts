// Where the app reaches Garmin. The phone app and the tests call Garmin directly.
import { GARMIN_BASE_URL, type GarminFetch } from '../garmin/client';

export function garminBaseUrl(): string {
  return GARMIN_BASE_URL;
}

/** A fetch of its own for Garmin calls, where the platform needs one. The phone uses the plain one. */
export function garminFetch(): GarminFetch | undefined {
  return undefined;
}
