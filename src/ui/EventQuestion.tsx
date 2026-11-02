// "Något stort på gång kommande veckan?" Once a week, last in the check-in. One tap for a day.

import React, { useState } from 'react';
import { Text } from 'react-native';
import { askAboutEvents } from '../core/analysis/events';
import { addDays, eveningDateKey, formatDateSv } from '../core/analysis/dates';
import { addEvent, eventsAskedAt, markEventsAsked } from '../services/events';
import { Button, Card, Chip, Field, P, Row } from './components';
import { useRepo } from './state';
import { space, type } from './theme';

const WEEKDAY = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];

export function EventQuestion() {
  const repo = useRepo();
  const today = eveningDateKey(new Date());
  const [text, setText] = useState('');
  const [date, setDate] = useState(addDays(today, 1));
  const [added, setAdded] = useState<string[]>([]);
  if (!askAboutEvents(eventsAskedAt(repo), today) && !added.length) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  const label = (d: string) => `${WEEKDAY[new Date(`${d}T12:00:00`).getDay()]} ${Number(d.slice(8))}`;

  return (
    <Card>
      <Text style={type.h2} accessibilityRole="header">Något stort på gång kommande veckan?</Text>
      <Text style={type.small}>Valfritt</Text>
      {added.map((a) => <P key={a} style={{ marginTop: space.xs }}>{`✓ ${a}`}</P>)}
      <Field value={text} onChangeText={setText} placeholder="Till exempel: resa till Berlin" accessibilityLabel="Händelse" style={{ marginTop: space.s }} />
      <Row style={{ gap: 6 }}>
        {days.map((d) => <Chip key={d} label={label(d)} selected={date === d} onPress={() => setDate(d)} />)}
      </Row>
      <Row style={{ marginTop: space.s }}>
        <Button title="Lägg till" disabled={!text.trim()} onPress={async () => {
          await addEvent(repo, text, date);
          await markEventsAsked(repo, today);
          setAdded((all) => [...all, `${text.trim()}, ${formatDateSv(date)}`]);
          setText('');
        }} />
        <Button kind="ghost" title={added.length ? 'Klar' : 'Inget just nu'} onPress={async () => { await markEventsAsked(repo, today); setAdded([]); }} />
      </Row>
    </Card>
  );
}
