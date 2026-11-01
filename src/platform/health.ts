// Apple Hälsa (HealthKit) and Health Connect: the third source for sleep and stress (B5).
// Reading them needs a native module and a development build; Expo Go has neither. The
// format, the merge with Garmin and the person's own entry, and the saving are in place
// (core/analysis/sources.ts, Repository.saveHealthDays), so only the reading is missing.

import type { DateKey, MeasuredDay } from '../core/domain/types';

export const healthAvailable = false;

export const healthUnavailableReason =
  'Apple Hälsa och Health Connect kräver en utvecklingsbuild av appen med en modul för hälsodata. Den finns inte ännu.';

export async function readHealthDays(_from: DateKey, _to: DateKey): Promise<MeasuredDay[]> {
  throw new Error(healthUnavailableReason);
}
