// Web preview and tests: no local notifications.
export const reminderSupported = false;

export async function scheduleReminder(_hour: number, _minute: number): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: 'Påminnelser finns bara i appen på telefonen.' };
}

export async function cancelReminder(): Promise<void> {}

/** True on the web, where the reminder is a calendar event the user adds. */
export const reminderViaCalendar = false;

export const cancelHint: string | null = null;

/** A daily reminder for one routine from the plan. */
export async function scheduleRoutineReminder(_id: string, _text: string, _hour: number, _minute: number): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: 'Påminnelser finns bara i appen på telefonen.' };
}

export async function cancelRoutineReminder(_id: string): Promise<void> {}

export async function cancelOrphanRoutineReminders(_keep: string[]): Promise<void> {}

/** A notice shown at once. Only on the phone; the web shows it on the home screen instead. */
export async function notifyNow(_id: string, _title: string, _body: string): Promise<boolean> {
  return false;
}
