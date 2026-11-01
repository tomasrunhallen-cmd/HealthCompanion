// Web version: a browser cannot schedule a daily notification by itself, so the phone's
// calendar does it. The app opens a repeating calendar event (netlify/functions/reminder.mjs)
// that the user adds once; the calendar's alarm is the reminder. Only the time is sent.

export const reminderSupported = true;
export const reminderViaCalendar = true;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function calendarUrl(hour: number, minute: number, today = new Date()): string {
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return `/api/reminder.ics?time=${pad(hour)}:${pad(minute)}&date=${date}`;
}

export async function scheduleReminder(hour: number, minute: number): Promise<{ ok: boolean; message: string }> {
  try {
    globalThis.location?.assign(calendarUrl(hour, minute));
  } catch {
    return { ok: false, message: 'Kalendern gick inte att öppna från den här webbläsaren.' };
  }
  return {
    ok: true,
    message: `Lägg till händelsen i Kalender. Telefonen påminner dig sedan varje kväll ${pad(hour)}:${pad(minute)}. Byter du tid: ta bort den gamla händelsen i Kalender först.`,
  };
}

export async function cancelReminder(): Promise<void> {}

export const cancelHint = 'Ta bort händelsen ”Dagsljus: kvällens avstämning” i appen Kalender.';

/**
 * A routine's reminder as a calendar event. Only the time is sent to the calendar address,
 * never the routine's words: the event says "Dagsljus: din rutin", and the app shows which.
 */
export function routineCalendarUrl(hour: number, minute: number, today = new Date()): string {
  return `${calendarUrl(hour, minute, today)}&what=rutin`;
}

export async function scheduleRoutineReminder(_id: string, _text: string, hour: number, minute: number): Promise<{ ok: boolean; message: string }> {
  try {
    globalThis.location?.assign(routineCalendarUrl(hour, minute));
  } catch {
    return { ok: false, message: 'Kalendern gick inte att öppna från den här webbläsaren.' };
  }
  return {
    ok: true,
    message: `Lägg till händelsen i Kalender. Telefonen påminner dig sedan varje dag ${pad(hour)}:${pad(minute)}. Händelsen heter ”Dagsljus: din rutin”, utan rutinens ord.`,
  };
}

export async function cancelRoutineReminder(_id: string): Promise<void> {}

/** Calendar events are the person's own; the app cannot remove them. */
export async function cancelOrphanRoutineReminders(_keep: string[]): Promise<void> {}

/** The web cannot show a notice by itself; the home screen shows it instead. */
export async function notifyNow(_id: string, _title: string, _body: string): Promise<boolean> {
  return false;
}
