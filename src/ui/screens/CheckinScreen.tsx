import Slider from '@react-native-community/slider';
import React, { useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { eveningDateKey } from '../../analysis/dates';
import { parseSleepHours } from '../../analysis/sleep';
import { akutLevel } from '../../context/akut';
import { CrisisCard } from '../CrisisCard';
import { saveCheckin } from '../../services/checkin';
import { Button, Card, Chip, Field, P, Row, Screen } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, space, type } from '../theme';

const QUESTIONS = [
  'Hur har du sovit?',
  'Hur är tempot i huvudet i kväll?',
  'Var det något som stack ut i dag?',
];

function Scale(props: { label: string; value: number; onChange: (v: number) => void; low: string; high: string }) {
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
        minimumValue={1}
        maximumValue={10}
        step={1}
        value={props.value}
        onValueChange={(v) => props.onChange(Math.round(v))}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
        style={{ height: 40 }}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.small}>{props.low}</Text>
        <Text style={type.small}>{props.high}</Text>
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
  const sleep = useMemo(() => parseSleepHours(text), [text]);
  // Checked on the phone while typing; the crisis numbers show before anything is saved or sent.
  const akut = useMemo(() => akutLevel(text, repo.contextOf('akut').map((e) => e.text)), [text, repo]);
  const garmin = repo.garminDay(eveningDateKey(new Date()));
  const garminSleep = garmin?.sleepHours ?? null;

  const save = async () => {
    setBusy(true);
    try {
      const { entry } = await saveCheckin(repo, { transcript: text, mood, energy, wordsPerMinute: null, medicationTaken: medication }, new Date(), { browser: Platform.OS === 'web' });
      nav.replace({ name: 'result', entryId: entry.id, fresh: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Kvällens avstämning"
      back
      footer={<Button big title="Spara och se bedömningen" onPress={save} busy={busy} />}
    >
      <Card>
        {QUESTIONS.map((q, i) => (
          <Text key={q} style={[type.body, { fontWeight: '600', marginBottom: i < 2 ? space.s : 0 }]}>
            {i + 1}. {q}
          </Text>
        ))}
      </Card>

      <Field
        label="DIN ANTECKNING"
        value={text}
        onChangeText={setText}
        multiline
        placeholder="Skriv eller prata in några meningar…"
        autoCorrect
        hint={
          garminSleep != null
            ? undefined
            : sleep != null
              ? `Sömn: ${sleep} h (skattat ur anteckningen)`
              : 'Tips: skriv till exempel ”sov sex timmar” så räknas sömnen med.'
        }
      />
      {akut ? <CrisisCard plan={repo.plan()} mild={akut === 'mild'} /> : null}
      {garmin && (garminSleep != null || garmin.stressAvg != null) ? (
        <Card>
          <Text style={type.label}>FRÅN GARMIN</Text>
          <P style={{ marginTop: space.xs }}>
            {[
              garminSleep != null
                ? `Sömn i natt ${String(garminSleep).replace('.', ',')} h${garmin.sleepStart ? `, somnade ${garmin.sleepStart}` : ''}`
                : null,
              garmin.stressAvg != null ? `stress hittills i dag ${garmin.stressAvg}` : null,
            ].filter(Boolean).join(', ') + '.'}
          </P>
          <P muted>Uppdateras när du sparar. Dagens och veckans värden följer med till bedömningen.</P>
        </Card>
      ) : null}
      <Card tone="accent">
        <P muted>
          Inspelning med taligenkänning på telefonen (Whisper) kräver en utvecklingsbuild och läggs till senare.
          Till dess kan du skriva, eller använda tangentbordets mikrofon. Observera att tangentbordets diktering kan
          skicka ljud till Apple eller Google, beroende på telefonens inställningar.
        </P>
      </Card>

      {hasMedication ? (
        <View style={{ marginBottom: space.l }}>
          <Text style={type.label}>TOG DU DIN MEDICIN I DAG?</Text>
          <Row style={{ marginTop: space.xs }}>
            <Chip label="Ja" selected={medication === true} onPress={() => setMedication(medication === true ? null : true)} />
            <Chip label="Nej" selected={medication === false} onPress={() => setMedication(medication === false ? null : false)} />
          </Row>
        </View>
      ) : null}
      <Scale label="Stämning" value={mood} onChange={setMood} low="1 Mycket låg" high="10 Mycket hög" />
      <Scale label="Energi" value={energy} onChange={setEnergy} low="1 Ingen" high="10 Väldigt mycket" />
    </Screen>
  );
}
