// Inför återbesök: 14 or 30 days on one screen, the person's own list of things to bring up,
// and a PDF the person saves and shares themselves. Notes are never included.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { formatDateSv } from '../../core/analysis/dates';
import { LEVEL_DISCLAIMER } from '../../core/analysis/visit';
import { moodStep } from '../../core/analysis/mood';
import { polarityWord } from '../../core/plan/fields';
import { sharePdf } from '../../platform/pdf';
import { levelCounts } from '../../core/report/html';
import { addVisitTopic, removeVisitTopic, visitHtml, visitSummary } from '../../services/visit';
import { Button, Card, Dot, Field, P, Row, Screen, Section, Segmented } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { colors, LEVEL_TEXT, space, type } from '../theme';

const dec = (n: number | null) => (n == null ? '–' : String(n).replace('.', ','));

export function VisitScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const nav = useNav();
  const [days, setDays] = useState<'14' | '30'>('14');
  const [topic, setTopic] = useState('');
  const s = visitSummary(repo, Number(days) as 14 | 30);
  const ps = repo.planSettings();
  const signList = (dir: 'up' | 'down' | 'both', title: string) =>
    s.signs[dir].length ? (
      <View style={{ marginTop: space.s }}>
        <Text style={type.label}>{title.toUpperCase()}</Text>
        {s.signs[dir].map((x) => <P key={x.text} style={{ marginTop: 2 }}>{`${x.text}: ${x.days} ${x.days === 1 ? 'dag' : 'dagar'}`}</P>)}
      </View>
    ) : null;

  return (
    <Screen
      title="Inför återbesök"
      footer={<Button big title="Spara som PDF" onPress={async () => {
        const res = await sharePdf(visitHtml(s, ps), 'Inför återbesök.pdf');
        if (!res.ok) await dialog.info('PDF:en gick inte att skapa', res.message);
      }} />}
    >
      <P muted>Anteckningarna följer aldrig med.</P>
      <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '14', label: '14 dagar' }, { value: '30', label: '30 dagar' }]} />

      {repo.pendingSuggestions().length && repo.settings().suggestionPace === 'visit' ? (
        <Card tone="accent">
          <P>{repo.pendingSuggestions().length === 1 ? 'Ett förslag väntar' : `${repo.pendingSuggestions().length} förslag väntar`}.</P>
          <Button kind="ghost" title="Granska förslagen" onPress={() => nav.push({ name: 'suggestions' })} />
        </Card>
      ) : null}

      <Section title="Saker jag vill ta upp">
        <Card>
          {s.topics.length ? s.topics.map((t) => (
            <Row key={t.id} style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <P style={{ flex: 1 }}>{`• ${t.text}`}</P>
              <Button kind="ghost" title="Ta bort" onPress={() => removeVisitTopic(repo, t.id)} />
            </Row>
          )) : <P muted>Skriv ner saker mellan besöken, så finns de här när det är dags.</P>}
          <Field value={topic} onChangeText={setTopic} placeholder="Något jag vill ta upp" accessibilityLabel="Ny sak att ta upp" />
          <Button title="Lägg till" disabled={!topic.trim()} onPress={async () => { await addVisitTopic(repo, topic); setTopic(''); }} />
        </Card>
      </Section>

      <Section title="Dag för dag">
        <Card>
          <P>{levelCounts(s.counts)}</P>
          <P muted style={{ marginTop: space.xs }}>{LEVEL_DISCLAIMER}</P>
          {s.days.map((d) => {
            const dir = d.direction === 'both' ? 'båda hållen' : d.direction ? polarityWord(d.direction, ps) : null;
            const parts = [
              d.mood != null ? moodStep(d.mood).label : null,
              d.sleepHours != null ? `sömn ${dec(d.sleepHours)} h` : 'sömn saknas',
              dir ? `åt ${dir}` : null,
              ...d.notes,
            ].filter(Boolean);
            return (
              <View
                key={d.date}
                accessible
                accessibilityLabel={`${formatDateSv(d.date)}: ${d.level ? LEVEL_TEXT[d.level] : 'ingen avstämning'}. ${parts.join(', ')}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.xs, borderTopWidth: 1, borderColor: colors.border, marginTop: space.xs }}
              >
                <Text style={[type.small, { width: 52 }]}>{formatDateSv(d.date).slice(0, 7)}</Text>
                <Dot level={d.level} size={18} />
                <Text style={[type.small, { flex: 1, color: colors.text }]}>{d.level ? parts.join(' · ') : 'Ingen avstämning'}</Text>
              </View>
            );
          })}
        </Card>
      </Section>

      <Section title="Sömn och stress">
        <Card>
          <P>Snitt: sömn {dec(s.sleepAvg)} timmar, stress {dec(s.stressAvg)}.</P>
        </Card>
      </Section>

      <Section title="Tecken som syntes">
        <Card>
          {!s.signs.up.length && !s.signs.down.length && !s.signs.both.length ? <P muted>Inga av dina tecken under perioden.</P> : null}
          {signList('up', `Åt ${polarityWord('up', ps)}`)}
          {signList('down', `Åt ${polarityWord('down', ps)}`)}
          {signList('both', 'Utan riktning')}
        </Card>
      </Section>

      {s.redSteps.length ? (
        <Section title="Stegen efter röda dagar">
          <Card>
            {s.redSteps.map((r) => (
              <View key={r.date} style={{ marginBottom: space.s }}>
                <Text style={type.label}>{formatDateSv(r.date).toUpperCase()}</Text>
                {r.steps.map((x) => <P key={x.text}>{`${x.done ? '✓ Gjort' : '– Inte gjort'}: ${x.text}`}</P>)}
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Rutiner">
        <Card>
          {s.routines.length ? s.routines.map((r) => <P key={r.text} style={{ marginTop: 2 }}>{`${r.text}: ${r.done} av ${r.logged} dagar`}</P>) : <P muted>Inga rutiner avbockade under perioden.</P>}
        </Card>
      </Section>
    </Screen>
  );
}
