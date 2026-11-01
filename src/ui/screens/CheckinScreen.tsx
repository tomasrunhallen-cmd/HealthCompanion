import Slider from '@react-native-community/slider';
import React, { useMemo, useState } from 'react';
import { Platform, Text, useColorScheme, View } from 'react-native';
import { eveningDateKey, formatDateSv } from '../../core/analysis/dates';
import { redFollowup, redStepAnswers } from '../../core/analysis/afterRed';
import { setRedStep } from '../../services/afterRed';
import { parseSleepHours } from '../../core/analysis/sleep';
import { akutLevel } from '../../core/context/akut';
import { CrisisCard } from '../CrisisCard';
import { RoutinesToday } from '../RoutinesToday';
import { EventQuestion } from '../EventQuestion';
import * as Haptics from 'expo-haptics';
import { saveCheckin } from '../../services/checkin';
import { FROM_SOURCE, MANUAL_STRESS, sleepSourceOf, stressSourceOf } from '../../core/analysis/sources';
import { Button, Card, Chip, Field, P, Row, Screen, Toggle } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, MIN_TOUCH, paletteHex, space, type } from '../theme';

const QUESTIONS = 'Skriv några meningar, till exempel om hur du sovit, hur tempot i huvudet är i kväll och om något stack ut i dag.';

function Scale(props: { label: string; value: number; onChange: (v: number) => void; low: string; high: string }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return (
    <View style={{ marginBottom: space.l }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.label}>{props.label.toUpperCase()}</Text>
        <Text style={[type.h2, { color: colors.accent }]} accessibilityLabel={`${props.label} ${props.value} av 10`}>
          {props.value}
        </Text>
      </Row>
      <Slider
        accessibilityLabel={props.label}
        accessibilityHint={`Från ${props.low} till ${props.high}`}
        accessibilityValue={{ min: 1, max: 10, now: props.value, text: `${props.value} av 10` }}
        minimumValue={1}
        maximumValue={10}
        step={1}
        value={props.value}
        onValueChange={(v) => props.onChange(Math.round(v))}
        // The slider takes plain colour strings; pick the pair for the current appearance.
        minimumTrackTintColor={paletteHex('accent', scheme)}
        maximumTrackTintColor={paletteHex('border', scheme)}
        thumbTintColor={paletteHex('accent', scheme)}
        style={{ height: MIN_TOUCH }}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[type.small, { flexShrink: 1 }]}>{props.low}</Text>
        <Text style={[type.small, { flexShrink: 1, textAlign: 'right' }]}>{props.high}</Text>
      </Row>
    </View>
  );
}

export function CheckinScreen() {
  const repo = useRepo();
  const nav = useNav();
  const [text, setText] = useState('');
  const [mood, setMood] = useState(5);
  const [energy, setEnergy] = useState(5);
  const [busy, setBusy] = useState(false);
  const hasMedication = repo.contextOf('medication').length > 0;
  const [medication, setMedication] = useState<boolean | null>(null);
  const [strain, setStrain] = useState(false);
  const [manualSleep, setManualSleep] = useState<number | null>(null);
  const [manualStress, setManualStress] = useState<number | null>(null);
  const sleep = useMemo(() => parseSleepHours(text), [text]);
  // Checked on the phone while typing; the crisis numbers show before anything is saved or sent.
  const akut = useMemo(() => akutLevel(text, repo.contextOf('akut').map((e) => e.text)), [text, repo]);
  const garmin = repo.measuredDay(eveningDateKey(new Date()));
  // Dagen efter rött: asked first, answered with one tap per step.
  const followup = redFollowup(repo.assessments(), repo.contextEntries(), repo.plan(), eveningDateKey(new Date()));
  const stepAnswers = followup ? redStepAnswers(repo.contextEntries('dagligt'), followup.date) : new Map<string, boolean>();
  const garminSleep = garmin?.sleepHours ?? null;

  const save = async () => {
    setBusy(true);
    try {
      const { entry, assessment } = await saveCheckin(repo, { transcript: text, mood, energy, wordsPerMinute: null, medicationTaken: medication, strainYesterday: strain, manualSleepHours: manualSleep, manualStress }, new Date(), { browser: Platform.OS === 'web' });
      // HIG: haptics sparingly. A light confirmation that the check-in is saved, never on a red day.
      if (Platform.OS !== 'web' && assessment.level !== 'red' && !assessment.akut) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
      nav.push({ name: 'result', entryId: entry.id, fresh: true });
      // The tab keeps this screen; start the next evening with an empty form.
      setText('');
      setMood(5);
      setEnergy(5);
      setMedication(null);
      setStrain(false);
      setManualSleep(null);
      setManualStress(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Avstämning"
      back
      footer={<Button big title="Spara och se bedömningen" onPress={save} busy={busy} />}
    >
      {followup ? (
        <Card tone="accent">
          <Text style={type.h2} accessibilityRole="header">
            {followup.yesterday ? 'I går var det rött.' : `Den ${formatDateSv(followup.date)} var det rött.`} Gjorde du något av stegen?
          </Text>
          <P muted style={{ marginTop: space.xs }}>Svaren sparas till Inför återbesök. De ändrar inte nivån.</P>
          {followup.steps.map((step) => {
            const v = stepAnswers.get(step);
            return (
              <View key={step} style={{ marginTop: space.s }}>
                <Text style={type.body}>{step}</Text>
                <Row style={{ marginTop: space.xs }}>
                  <Chip label="Ja" selected={v === true} color={colors.green} onPress={() => setRedStep(repo, followup.date, step, v === true ? null : true)} />
                  <Chip label="Nej" selected={v === false} onPress={() => setRedStep(repo, followup.date, step, v === false ? null : false)} />
                </Row>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Text style={type.h2} accessibilityRole="header">Hur har dagen varit?</Text>
      <Text style={[type.small, { marginTop: space.xs, marginBottom: space.s }]}>{QUESTIONS}</Text>
      <Field
        accessibilityLabel="Din anteckning"
        accessibilityHint={QUESTIONS}
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Några meningar om dagen…"
        autoCorrect
        hint={
          garminSleep != null
            ? undefined
            : sleep != null
              ? `Sömn: ${sleep} h (skattat ur anteckningen)`
              : 'Tips: skriv till exempel ”sov sex timmar” så räknas sömnen med.'
        }
      />
      <P muted style={{ marginTop: -space.s, marginBottom: space.l }}>
        Du kan prata in med tangentbordets mikrofon. Då kan ljudet gå till Apple eller Google, beroende på telefonens inställningar.
      </P>
      {akut ? <CrisisCard plan={repo.plan()} mild={akut === 'mild'} /> : null}

      <Scale label="Stämning" value={mood} onChange={setMood} low="1 Mycket låg" high="10 Mycket hög" />
      <Scale label="Energi" value={energy} onChange={setEnergy} low="1 Ingen" high="10 Väldigt mycket" />

      <Card>
        <Text style={type.h2} accessibilityRole="header">Sömn och stress</Text>
        {garmin && (garminSleep != null || garmin.stressAvg != null) ? (
          <P style={{ marginTop: space.xs }}>
            {[
              garminSleep != null
                ? `Sömn i natt ${String(garminSleep).replace('.', ',')} h ${FROM_SOURCE[sleepSourceOf(garmin) ?? 'garmin']}${garmin.sleepStart ? `, somnade ${garmin.sleepStart}` : ''}`
                : null,
              garmin.stressAvg != null ? `stress hittills i dag ${garmin.stressAvg} ${FROM_SOURCE[stressSourceOf(garmin) ?? 'garmin']}` : null,
            ].filter(Boolean).join(', ') + '.'}
          </P>
        ) : null}
        <P muted style={{ marginTop: space.xs }}>
          {garmin && (garminSleep != null || garmin.stressAvg != null) ? 'Stämmer det inte, ange själv. Det du anger gäller.' : 'Ange själv om du vill.'}
        </P>
        <Row style={{ marginTop: space.s }}>
          <Text style={[type.body, { flex: 1 }]}>Sömn i natt</Text>
          <Button kind="secondary" title="−" label="Mindre sömn, en halvtimme" onPress={() => setManualSleep(Math.max(0, (manualSleep ?? garminSleep ?? sleep ?? 7) - 0.5))} />
          <Text style={[manualSleep != null ? type.h2 : type.small, { minWidth: 72, textAlign: 'center' }]} accessibilityLiveRegion="polite" accessibilityLabel={manualSleep != null ? `Sömn ${manualSleep} timmar` : 'Sömn inte angiven'}>
            {manualSleep != null ? `${String(manualSleep).replace('.', ',')} h` : 'Inte angiven'}
          </Text>
          <Button kind="secondary" title="+" label="Mer sömn, en halvtimme" onPress={() => setManualSleep(Math.min(16, (manualSleep ?? garminSleep ?? sleep ?? 7) + 0.5))} />
        </Row>
        <Text style={[type.body, { marginTop: space.s }]}>Stress i dag</Text>
        <Row style={{ marginTop: space.xs }}>
          {(['low', 'medium', 'high'] as const).map((k) => (
            <Chip key={k} label={{ low: 'Låg', medium: 'Medel', high: 'Hög' }[k]} selected={manualStress === MANUAL_STRESS[k]}
              onPress={() => setManualStress(manualStress === MANUAL_STRESS[k] ? null : MANUAL_STRESS[k])} />
          ))}
        </Row>
        <View style={{ marginTop: space.m }}>
          <Toggle
            label="Alkohol, sjuk eller hård träning i går?"
            value={strain}
            onChange={setStrain}
            hint={strain ? 'Sömn och stress räknas inte i dag.' : 'Då räknas inte sömn och stress i dag.'}
          />
        </View>
      </Card>

      {hasMedication ? (
        <Card>
          <Text style={type.h2} accessibilityRole="header">Tog du din medicin i dag?</Text>
          <Row style={{ marginTop: space.xs }}>
            <Chip label="Ja" selected={medication === true} onPress={() => setMedication(medication === true ? null : true)} />
            <Chip label="Nej" selected={medication === false} onPress={() => setMedication(medication === false ? null : false)} />
          </Row>
        </Card>
      ) : null}
      <RoutinesToday compact />
      <EventQuestion />
    </Screen>
  );
}
