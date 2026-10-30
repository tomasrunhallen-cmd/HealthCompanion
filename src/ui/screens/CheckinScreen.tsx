import Slider from '@react-native-community/slider';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { parseSleepHours } from '../../analysis/sleep';
import { saveCheckin } from '../../services/checkin';
import { Button, Card, Field, P, Row, Screen } from '../components';
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
  const sleep = useMemo(() => parseSleepHours(text), [text]);

  const save = async () => {
    setBusy(true);
    try {
      const { entry } = await saveCheckin(repo, { transcript: text, mood, energy, wordsPerMinute: null });
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
          sleep != null
            ? `Sömn: ${sleep} h (skattat ur anteckningen)`
            : 'Tips: skriv till exempel ”sov sex timmar” så räknas sömnen med.'
        }
      />
      <Card tone="accent">
        <P muted>
          Inspelning med taligenkänning på telefonen (Whisper) kräver en utvecklingsbuild och läggs till efter steg 1.
          Till dess kan du skriva, eller använda tangentbordets mikrofon. Observera att tangentbordets diktering kan
          skicka ljud till Apple eller Google, beroende på telefonens inställningar.
        </P>
      </Card>

      <Scale label="Stämning" value={mood} onChange={setMood} low="1 Mycket låg" high="10 Mycket hög" />
      <Scale label="Energi" value={energy} onChange={setEnergy} low="1 Ingen" high="10 Väldigt mycket" />
    </Screen>
  );
}
