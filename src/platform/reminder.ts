// Web preview and tests: no local notifications.
export const reminderSupported = false;

export async function scheduleReminder(_hour: number, _minute: number): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: 'Påminnelser finns bara i appen på telefonen.' };
}

export async function cancelReminder(): Promise<void> {}
