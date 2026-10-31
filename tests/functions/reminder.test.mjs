// Runs with node --test (npm test).
import assert from 'node:assert';
import { test } from 'node:test';
import handler, { calendarFor } from '../../netlify/functions/reminder.mjs';

test('calendar event repeats daily at the chosen local time with an alarm', () => {
  const ics = calendarFor({ time: '21:00', date: '2026-10-31', origin: 'https://x.netlify.app', now: new Date('2026-10-31T12:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nDTSTART:20261031T210000\r\n/);
  assert.match(ics, /\r\nDTEND:20261031T211000\r\n/);
  assert.match(ics, /\r\nRRULE:FREQ=DAILY\r\n/);
  assert.match(ics, /\r\nTRIGGER:PT0M\r\n/);
  assert.match(ics, /\r\nURL:https:\/\/x\.netlify\.app\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261031T120000Z\r\n/);
  assert.equal(calendarFor({ time: '23:55', date: '2026-10-31', origin: 'o' }).includes('DTEND:20261031T235900'), true);
});

test('rejects anything but HH:MM and YYYY-MM-DD', async () => {
  assert.equal(calendarFor({ time: '25:00', date: '2026-10-31', origin: 'o' }), null);
  assert.equal(calendarFor({ time: '21:00', date: 'tomorrow', origin: 'o' }), null);
  const bad = await handler(new Request('https://x.netlify.app/api/reminder.ics?time=21:00%0D%0AX'));
  assert.equal(bad.status, 400);
  const ok = await handler(new Request('https://x.netlify.app/api/reminder.ics?time=20:45&date=2026-10-31'));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'text/calendar; charset=utf-8');
});
