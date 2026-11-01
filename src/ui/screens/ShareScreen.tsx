// Visa för någon: a view and a PDF with the traffic light, sleep and stress and the signs that
// were seen, never the notes. The person chooses the period and what goes in. The app sends nothing.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { formatDateSv } from '../../core/analysis/dates';
import { polarityWord } from '../../core/plan/fields';
import { sharePdf } from '../../platform/pdf';
import { shareHtml, visitSummary, type ShareChoice } from '../../services/visit';
import { Button, Card, Dot, P, Screen, Section, Segmented, Toggle } from '../components';
import { useDialog, useRepo } from '../state';
import { LEVEL_TEXT, space, type } from '../theme';

export function ShareScreen() {
  const repo = useRepo();
  const dialog = useDialog();
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const [choice, setChoice] = useState<ShareChoice>({ levels: true, sleepStress: true, signs: false });
  const s = visitSummary(repo, Number(days));
  const ps = repo.planSettings();
  const nothing = !choice.levels && !choice.sleepStress && !choice.signs;
  const dec = (n: number | null) => (n == null ? '–' : String(n).replace('.', ','));

  return (
    <Screen
      title="Visa för någon"
      footer={<Button big title="Spara som PDF" disabled={nothing} onPress={async () => {
        const res = await sharePdf(shareHtml(s, choice, ps), 'Så har jag haft det.pdf');
        if (!res.ok) await dialog.info('PDF:en gick inte att skapa', res.message);
      }} />}
    >
      <P muted>
        Visa skärmen eller spara en PDF. Anteckningarna följer aldrig med. Du väljer period och innehåll, och appen skickar inget själv.
      </P>
      <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 dagar' }, { value: '14', label: '14 dagar' }, { value: '30', label: '30 dagar' }]} />
      <Section title="Det här tas med">
        <Card>
          <Toggle label="Ampeln per dag" value={choice.levels} onChange={(levels) => setChoice({ ...choice, levels })} />
          <Toggle label="Sömn och stress" value={choice.sleepStress} onChange={(sleepStress) => setChoice({ ...choice, sleepStress })} />
          <Toggle label="Tecken som syntes" hint="Dina egna ord ur krisplanen" value={choice.signs} onChange={(signs) => setChoice({ ...choice, signs })} />
        </Card>
      </Section>
      <Section title={`${formatDateSv(s.from)} – ${formatDateSv(s.to)}`}>
        <Card>
          {nothing ? <P muted>Välj något att ta med.</P> : null}
          {choice.levels ? (
            <>
              <P>{s.counts.green} gröna, {s.counts.yellow} gula, {s.counts.red} röda, {s.counts.none} utan avstämning.</P>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s }}>
                {s.days.map((d) => (
                  <View key={d.date} accessible accessibilityLabel={`${formatDateSv(d.date)}: ${d.level ? LEVEL_TEXT[d.level] : 'ingen avstämning'}`} style={{ alignItems: 'center', minWidth: 34 }}>
                    <Dot level={d.level} size={18} />
                    <Text style={type.small}>{d.date.slice(8)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          {choice.sleepStress ? <P style={{ marginTop: space.m }}>Snitt: sömn {dec(s.sleepAvg)} timmar, stress {dec(s.stressAvg)}.</P> : null}
          {choice.signs ? (
            <View style={{ marginTop: space.m }}>
              {(['up', 'down'] as const).map((dir) => (
                <View key={dir} style={{ marginBottom: space.s }}>
                  <Text style={type.label}>{`ÅT ${polarityWord(dir, ps).toUpperCase()}`}</Text>
                  {s.signs[dir].length ? s.signs[dir].map((x) => <P key={x.text}>{`${x.text}: ${x.days} ${x.days === 1 ? 'dag' : 'dagar'}`}</P>) : <P muted>Inga.</P>}
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
