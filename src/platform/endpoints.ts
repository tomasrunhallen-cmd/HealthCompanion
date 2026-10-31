// Where the app reaches Garmin. The phone app and the tests call Garmin directly.
import { GARMIN_BASE_URL } from '../garmin/client';

export function garminBaseUrl(): string {
  return GARMIN_BASE_URL;
}
