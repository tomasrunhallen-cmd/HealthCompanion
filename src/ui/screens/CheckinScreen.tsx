import Slider from '@react-native-community/slider';
import React, { useMemo, useState } from 'react';
import { Platform, Text, useColorScheme, View } from 'react-native';
import { eveningDateKey, formatDateSv, localClock } from '../../core/analysis/dates';
import { minutesBehind, STALE_MINUTES } from '../../core/analysis/remeasure';
import { MOOD_MAX, MOOD_MIN, moodStep } from '../../core/analysis/mood';
import { syncGarmin } from '../../services/garmin';
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


/** A slider with its value above it (HIG: Sliders). Stämning and energi 1–10; sömn in half hours. */
function Scale(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  low: string;
  high: string;
  min?: number;
  max?: number;
  step?: number;
  /** The value as shown, and as VoiceOver reads it. */
  show?: (v: number) => string;
  spoken?: (v: number) => string;
  /** A line under the value that says what it means. */
  detail?: (v: number) => string;
  /** Balance in the middle: no filled track, since more is not better. */
  centred?: boolean;
}) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const min = props.min ?? 1;
  const max = props.max ?? 10;
  const step = props.step ?? 1;
  const show = props.show ?? String;
  const spoken = props.spoken ?? ((v: number) => `${v} av ${max}`);
  return (
    <View style={{ marginBottom: space.l }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.label}>{props.label.toUpperCase()}</Text>
        <Text style={[type.h2, { color: colors.accent, flexShrink: 1, textAlign: 'right' }]} accessibilityLabel={`${props.label} ${spoken(props.value)}`}>
          {show(props.value)}
        </Text>
      </Row>
      {props.detail ? <Text style={[type.small, { textAlign: 'right' }]} accessibilityElementsHidden importantForAccessibility="no">{props.detail(props.value)}</Text> : null}
      <Slider
        accessibilityLabel={props.label}
        accessibilityHint={`Från ${props.low} till ${props.high}`}
        accessibilityValue={{ min, max, now: props.value, text: spoken(props.value) }}
        // The slider counts from 0: the web slider puts the thumb wrong on a range below zero.
        minimumValue={0}
        maximumValue={max - min}
        step={step}
        value={props.value - min}
        onValueChange={(v) => props.onChange(Math.round(v / step) * step + min)}
        // The slider takes plain colour strings; pick the pair for the current appearance.
        minimumTrackTintColor={paletteHex(props.centred ? 'border' : 'accent', scheme)}
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

const SLEEP_MAX = 14;
/** Hours to the nearest half hour, within the slider. */
const halfHour = (h: number) => Math.min(SLEEP_MAX, Math.max(0, Math.round(h * 2) / 2));
const hoursText = (h: number) => `${String(h).replace('.', ',')} h`;
const hoursSpoken = (h: number) => `${String(h).replace('.', ',')} timmar`;

export function CheckinScreen() {
  const repo = useRepo();
  const nav = useNav();
  const [text, setText] = useState('');
  const [mood, setMood] = useState(0);
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
  // How far the watch has synced to Garmin. Hours behind: the day's stress is not complete.
  const connected = repo.garminStatus().connected;
  const behind = minutesBehind(garmin?.dataUntil, localClock(new Date()));
  const [fetching, setFetching] = useState(false);
  const fetchAgain = async () => {
    setFetching(true);
    try {
      await syncGarmin(repo, { days: 1 });
    } finally {
      setFetching(false);
    }
  };

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
      setMood(0);
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

      <Text style={[type.h2, { marginBottom: space.s }]} accessibilityRole="header">Hur har dagen varit?</Text>
      <Field
        accessibilityLabel="Din anteckning"
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

      <Scale
        label="Stämning"
        value={mood}
        onChange={setMood}
        min={MOOD_MIN}
        max={MOOD_MAX}
        show={(v) => moodStep(v).label}
        spoken={(v) => `${moodStep(v).label}, ${moodStep(v).hint.toLowerCase()}`}
        detail={(v) => moodStep(v).hint}
        centred
        low="Akut depression"
        high="Akut mani"
      />
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
        {connected ? (
          behind != null && behind >= STALE_MINUTES ? (
            <View style={{ marginTop: space.s }}>
              <Text style={[type.body, { fontWeight: '600' }]} accessibilityLiveRegion="polite">
                Klockan har inte synkat sedan {garmin!.dataUntil}.
              </Text>
              <P muted style={{ marginTop: 2 }}>
                Öppna Garmin Connect så att klockan synkar, och tryck Hämta igen. Annars uppdateras dagen när värdena kommer.
              </P>
              <Button kind="secondary" title="Hämta igen" hint="Hämtar dagens värden från Garmin" busy={fetching} onPress={fetchAgain} />
            </View>
          ) : garmin?.dataUntil ? (
            <Text style={[type.small, { marginTop: 2 }]}>Klockans värden fram till {garmin.dataUntil}.</Text>
          ) : !garmin ? (
            <View style={{ marginTop: space.s }}>
              <P muted>Inga värden från klockan än i dag.</P>
              <Button kind="secondary" title="Hämta igen" hint="Hämtar dagens värden från Garmin" busy={fetching} onPress={fetchAgain} />
            </View>
          ) : null
        ) : null}
        <P muted style={{ marginTop: space.xs }}>
          {garmin && (garminSleep != null || garmin.stressAvg != null) ? 'Stämmer det inte, ange själv. Det du anger gäller.' : 'Ange själv om du vill.'}
        </P>
        {/* Own sleep: a slider in half hours, starting where the watch or the note put it. */}
        {manualSleep == null ? (
          <Row style={{ marginTop: space.s, justifyContent: 'space-between' }}>
            <Text style={[type.body, { flexShrink: 1 }]}>Sömn i natt</Text>
            <Button
              kind="secondary"
              title="Ange själv"
              label="Ange sömnen själv"
              hint="Visar ett reglage för timmar"
              onPress={() => setManualSleep(halfHour(garminSleep ?? sleep ?? 7))}
            />
          </Row>
        ) : (
          <View style={{ marginTop: space.m }}>
            <Scale label="Sömn i natt" value={manualSleep} onChange={setManualSleep} min={0} max={SLEEP_MAX} step={0.5} show={hoursText} spoken={hoursSpoken} low="0 h" high={`${SLEEP_MAX} h`} />
            <Button kind="ghost" title="Ta bort min uppgift" hint={garminSleep != null ? 'Klockans värde gäller igen' : undefined} onPress={() => setManualSleep(null)} />
          </View>
        )}
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
