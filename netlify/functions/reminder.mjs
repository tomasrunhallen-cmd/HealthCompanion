// Returns a calendar event that repeats every evening at the chosen time, with an alarm.
// The web version cannot schedule notifications itself, so the phone's own calendar
// reminds the user. Only the time and today's date are sent here; nothing is stored.

const pad = (n) => String(n).padStart(2, '0');

export function calendarFor({ time, date, origin, now = new Date() }) {
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time ?? '');
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!t || !d) return null;
  const start = `${d[1]}${d[2]}${d[3]}T${t[1]}${t[2]}00`;
  const endMin = Number(t[1]) * 60 + Number(t[2]) + 10;
  // Floating local time (no Z): the event follows the phone's time zone.
  const end = endMin >= 24 * 60
    ? `${d[1]}${d[2]}${d[3]}T235900`
    : `${d[1]}${d[2]}${d[3]}T${pad(Math.floor(endMin / 60))}${pad(endMin % 60)}00`;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dagsljus//Kvallspaminnelse//SV',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:dagsljus-kvallens-avstamning',
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'RRULE:FREQ=DAILY',
    'SUMMARY:Dagsljus: kvällens avstämning',
    `DESCRIPTION:Tre frågor och två reglage. Under två minuter.\\n${origin}`,
    `URL:${origin}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Dags för kvällens avstämning',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export default async (req) => {
  const url = new URL(req.url);
  const body = calendarFor({ time: url.searchParams.get('time'), date: url.searchParams.get('date'), origin: url.origin });
  if (!body) return new Response('Bad time or date', { status: 400 });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="dagsljus.ics"',
      'cache-control': 'no-store',
    },
  });
};

export const config = { path: '/api/reminder.ics' };
