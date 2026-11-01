// Rutiner: the routines and lifestyle from the crisis plan. The person chooses which ones to
// tick off in the evening check-in and which ones to be reminded of, and sees how often they
// kept them. A support for balance; it never changes the level and is never sent to a model.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { eveningDateKey } from '../../core/analysis/dates';
import type { ContextEntry, RoutineSettings } from '../../core/domain/types';
import { polarityText } from '../../core/plan/fields';
import { routineSettings, routineStats, routines, suggestReminderTime } from '../../core/plan/routines';
import { cancelHint, cancelRoutineReminder, reminderSupported, reminderViaCalendar, scheduleRoutineReminder } from '../../platform/reminder';
import { Button, Card, Field, P, Row, Screen, Section, Toggle } from '../components';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

function shift(time: string, minutes: number): string {
  const total = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function RoutineCard({ e, stat }: { e: ContextEntry; stat: { answered: number; done: number } | undefined }) {
  const repo = useRepo();
  const dialog = useDialog();
  const settings = routineSettings(e);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const suggested = suggestReminderTime(e.text);
  const shown = settings.reminder ?? preview ?? suggested ?? '20:00';
  const words = repo.planSettings();

  const save = (patch: Partial<RoutineSettings>) => repo.updateContextEntry(e.id, { routine: { ...settings, ...patch } });

  const remind = async (on: boolean, at = shown) => {
    if (!on) {
      await cancelRoutineReminder(e.id);
      await save({ reminder: null });
      setMessage(reminderViaCalendar ? cancelHint : null);
      return;
    }
    const res = await scheduleRoutineReminder(e.id, e.text, Number(at.slice(0, 2)), Number(at.slice(3, 5)));
    setMessage(res.message);
    await save({ reminder: res.ok ? at : null });
  };

  // A new time moves an active reminder at once on the phone; in the calendar the person adds it again.
  const move = async (minutes: number) => {
    const next = shift(shown, minutes);
    if (!settings.reminder) setPreview(next);
    else if (reminderViaCalendar) await save({ reminder: next });
    else await remind(true, next);
  };

  return (
    <Card>
      <P style={{ fontWeight: '600' }}>{e.text}</P>
      {e.plan?.polarity && e.plan.polarity !== 'both' ? (
        <Text style={[type.small, { marginTop: 2 }]}>Gäller {polarityText(e.plan.polarity, words).toLowerCase()}</Text>
      ) : null}
      {stat && stat.answered ? (
        <Text style={[type.small, { marginTop: space.xs, color: colors.green }]}>
          Gjord {stat.done} av {stat.answered} {stat.answered === 1 ? 'dag' : 'dagar'} du bockat av rutiner de senaste 14 dagarna.
        </Text>
      ) : null}
      <View style={{ marginTop: space.s }}>
        <Toggle label="Bocka av i kvällens avstämning" value={settings.track} onChange={(track) => save({ track })} />
        {reminderViaCalendar ? null : (
          <Toggle
            label="Påminn mig varje dag"
            value={!!settings.reminder}
            disabled={!reminderSupported}
            onChange={(on) => remind(on, shown)}
            hint={settings.reminder ? `Klockan ${settings.reminder}` : suggested ? `Förslag ur planen: ${suggested}` : undefined}
          />
        )}
        <Row style={{ marginTop: space.xs }}>
          <Button kind="secondary" title="−15 min" onPress={() => move(-15)} />
          <Text style={[type.h2, { minWidth: 80, textAlign: 'center' }]} accessibilityLabel={`Påminnelse klockan ${shown}`}>{shown}</Text>
          <Button kind="secondary" title="+15 min" onPress={() => move(15)} />
        </Row>
        {reminderViaCalendar ? (
          <Button title="Lägg till i kalendern" onPress={() => remind(true, shown)} />
        ) : null}
        {message ? <P muted style={{ marginTop: space.xs }}>{message}</P> : null}
      </View>
      <Button
        kind="ghost"
        title="Ta bort rutinen"
        onPress={async () => {
          const ok = await dialog.confirm({ title: 'Ta bort rutinen?', message: e.text, confirmLabel: 'Ta bort', danger: true });
          if (!ok) return;
          await cancelRoutineReminder(e.id);
          await repo.removeContextEntry(e.id);
        }}
      />
    </Card>
  );
}

export function RoutinesScreen() {
  const repo = useRepo();
  const [text, setText] = useState('');
  const list = routines(repo.contextEntries('grund'));
  const stats = new Map(routineStats(repo.contextEntries(), eveningDateKey(new Date())).map((s) => [s.routine.id, s]));

  return (
    <Screen title="Rutiner">
      <P muted>
        Rutinerna kommer från Livsstil och rutiner i din krisplan. Välj vilka du vill bocka av i kvällens avstämning och vilka
        du vill bli påmind om. Det påverkar aldrig nivån, och rutinerna skickas aldrig till en språkmodell.
        {reminderViaCalendar
          ? ' I webbversionen påminner telefonens kalender dig. Bara klockslaget lämnar telefonen, inte rutinens ord.'
          : ' Påminnelsen är en notis på telefonen, och rutinens ord syns på låsskärmen.'}
      </P>
      {list.length === 0 ? (
        <Card style={{ marginTop: space.m }}>
          <P>Inga rutiner än. Lägg in din krisplan, eller skriv en rutin nedan.</P>
        </Card>
      ) : null}
      {list.map((e) => <RoutineCard key={e.id} e={e} stat={stats.get(e.id)} />)}
      <Section title="Lägg till en rutin">
        <Field value={text} onChangeText={setText} placeholder="Till exempel: promenad i dagsljus varje dag" accessibilityLabel="Ny rutin" />
        <Button
          title="Lägg till"
          disabled={!text.trim()}
          onPress={async () => {
            await repo.addContextEntry({ kind: 'routine', text, origin: 'user', plan: { kind: 'routine', polarity: 'both' }, routine: { track: true, reminder: null } });
            setText('');
          }}
        />
      </Section>
    </Screen>
  );
}
