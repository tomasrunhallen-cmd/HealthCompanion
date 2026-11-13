// Rutiner: the routines and lifestyle from the crisis plan. The person chooses which ones to
// tick off in the evening check-in, how often each should be done, and which ones to be
// reminded of, and sees how often they kept them. A support for balance; it never changes the
// level. The day's suggestion on Hem may send the routines' words, scrubbed, and their numbers
// to the person's language model; the person can turn that off here.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { eveningDateKey } from '../../core/analysis/dates';
import type { ContextEntry, RoutineFrequency, RoutineSettings } from '../../core/domain/types';
import { frequencyOf, frequencyText, suggestFrequency, WEEKDAY_SHORT } from '../../core/plan/routineFrequency';
import { DAY_SUGGESTION_KEY, modelSuggestionsOn } from '../../services/daySuggestion';
import { polarityText } from '../../core/plan/fields';
import { routineSettings, routineStats, routines, suggestReminderTime } from '../../core/plan/routines';
import { cancelHint, cancelRoutineReminder, reminderSupported, reminderViaCalendar, scheduleRoutineReminder } from '../../platform/reminder';
import { planBlocks, saveBlock } from '../../services/planBlocks';
import { renameRoutine } from '../../services/routines';
import { Button, Card, Chip, Field, P, Row, Screen, Section, Segmented, Toggle } from '../components';
import { useDialog, useRepo } from '../state';
import { colors, space, type } from '../theme';

function shift(time: string, minutes: number): string {
  const total = (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** How often the routine should be done: every day, a number of times a week, or given weekdays. */
function FrequencyPicker({ e, onChange }: { e: ContextEntry; onChange: (f: RoutineFrequency) => void }) {
  const f = frequencyOf(e);
  const fromWords = !e.routine?.frequency ? suggestFrequency(e.text) : null;
  return (
    <View style={{ marginTop: space.xs, marginBottom: space.s }}>
      <Segmented
        label="Hur ofta"
        options={[{ value: 'daily', label: 'Varje dag' }, { value: 'weekly', label: 'Per vecka' }, { value: 'weekdays', label: 'Vissa dagar' }]}
        value={f.kind}
        onChange={(kind) => onChange(kind === 'daily' ? { kind } : kind === 'weekly' ? { kind, times: 3 } : { kind, days: [1, 3, 5] })}
      />
      {f.kind === 'weekly' ? (
        <Row style={{ marginTop: space.s, gap: 6 }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Chip key={n} label={`${n}`} selected={f.times === n} onPress={() => onChange({ kind: 'weekly', times: n })} />
          ))}
          <Text style={type.small}>gånger i veckan</Text>
        </Row>
      ) : null}
      {f.kind === 'weekdays' ? (
        <Row style={{ marginTop: space.s, gap: 6 }}>
          {WEEKDAY_SHORT.map((name, i) => {
            const day = i + 1;
            const on = f.days.includes(day);
            return (
              <Chip key={name} label={name} selected={on} onPress={() => {
                const days = on ? f.days.filter((d) => d !== day) : [...f.days, day].sort();
                if (days.length) onChange({ kind: 'weekdays', days });
              }} />
            );
          })}
        </Row>
      ) : null}
      <Text style={[type.small, { marginTop: space.xs }]}>
        {fromWords ? `Läst ur planens ord: ${frequencyText(fromWords)}. Ändra om det inte stämmer.` : `Mål: ${frequencyText(f)}.`}
      </Text>
    </View>
  );
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

  const [renaming, setRenaming] = useState<string | null>(null);
  const rename = async () => {
    const next = await renameRoutine(repo, e, renaming ?? '');
    setRenaming(null);
    // A phone reminder carries the routine's words: schedule it again with the new ones.
    if (next && settings.reminder && !reminderViaCalendar) {
      await scheduleRoutineReminder(e.id, next.text, Number(settings.reminder.slice(0, 2)), Number(settings.reminder.slice(3, 5)));
    }
  };

  return (
    <Card>
      {renaming != null ? (
        <View>
          <Field label="NYTT NAMN" value={renaming} onChangeText={setRenaming} autoFocus accessibilityLabel="Rutinens nya namn" onSubmitEditing={rename} returnKeyType="done" />
          <Row>
            <Button title="Spara" disabled={!renaming.trim() || renaming.trim() === e.text} onPress={rename} />
            <Button kind="ghost" title="Avbryt" onPress={() => setRenaming(null)} />
          </Row>
        </View>
      ) : (
        <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <P style={{ fontWeight: '600', flex: 1 }}>{e.text}</P>
          <Button kind="ghost" title="Byt namn" label={`Byt namn på ${e.text}`} onPress={() => setRenaming(e.text)} />
        </Row>
      )}
      {e.plan?.polarity && e.plan.polarity !== 'both' ? (
        <Text style={[type.small, { marginTop: 2 }]}>Gäller {polarityText(e.plan.polarity, words).toLowerCase()}</Text>
      ) : null}
      {stat && stat.answered ? (
        <Text style={[type.small, { marginTop: space.xs, color: colors.green }]}>
          {frequencyOf(e).kind === 'daily'
            ? `${stat.done} av ${stat.answered} ${stat.answered === 1 ? 'dag' : 'dagar'}, senaste 14 dagarna`
            : `${stat.done} ${stat.done === 1 ? 'gång' : 'gånger'} de senaste 14 dagarna, målet är ${frequencyText(frequencyOf(e))}`}
        </Text>
      ) : null}
      <View style={{ marginTop: space.s }}>
        <Toggle label="Bocka av i kvällens avstämning" value={settings.track} onChange={(track) => save({ track })} />
        {settings.track && (e.plan?.polarity ?? 'both') === 'both' ? <FrequencyPicker e={e} onChange={async (frequency) => { await save({ frequency }); await repo.kvSet(DAY_SUGGESTION_KEY, null); }} /> : null}
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
          <Button kind="secondary" title="−15 min" label="15 minuter tidigare" onPress={() => move(-15)} />
          <Text style={[type.h2, { minWidth: 80, textAlign: 'center' }]} accessibilityLabel={`Påminnelse klockan ${shown}`}>{shown}</Text>
          <Button kind="secondary" title="+15 min" label="15 minuter senare" onPress={() => move(15)} />
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
      <P muted>{reminderViaCalendar ? 'Påminnelsen läggs i kalendern, utan rutinens ord.' : 'Rutinens ord syns på låsskärmen.'}</P>
      {list.length ? (
        <Card style={{ marginTop: space.m }}>
          <Toggle
            label="Dagens förslag med språkmodellen"
            value={modelSuggestionsOn(repo)}
            onChange={async (on) => {
              await repo.updateSettings({ routineSuggestions: on });
              await repo.kvSet(DAY_SUGGESTION_KEY, null);
            }}
            hint="Hem föreslår varje morgon vilka rutiner som passar i dag. Med en kopplad språkmodell väljer och motiverar den utifrån rutinernas ord, rensade, och hur ofta de gjorts. Inga anteckningar skickas. Avstängt väljer appen själv."
          />
        </Card>
      ) : null}
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
            // A new routine is a new line in the plan's daily routines, so the plan stays the source.
            const block = planBlocks(repo).find((b) => b.type === 'routine');
            if (block) await saveBlock(repo, { ...block, text: block.text.trim() ? `${block.text.trim()}\n${text.trim()}` : text.trim() });
            setText('');
          }}
        />
      </Section>
    </Screen>
  );
}
