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
