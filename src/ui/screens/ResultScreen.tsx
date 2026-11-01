import React from 'react';
import { Text, View } from 'react-native';
import { actionsForLevel, displaySentence, firstStep, SERIOUS_INTRO, seriousActions } from '../../analysis/assess';
import { formatDateSv, formatTime } from '../../analysis/dates';
import { explainAssessment } from '../../analysis/explain';
import { CrisisCard } from '../CrisisCard';
import { CorrectionBox } from '../CorrectionBox';
import type { Signal } from '../../domain/types';
import { Button, Card, LevelLight, P, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, levelColor, space, type } from '../theme';

const METHOD_TEXT = {
  wordmatch: 'Tecknen hittades med ordmatchning på telefonen (ingen språkmodell).',
  llm: 'Tecknen tolkades av din språkmodell. Nivån räknades i appen.',
  llm_fallback: 'Språkmodellen svarade inte som den skulle, så ordmatchning användes i stället.',
  none: 'Ingen text att jämföra med.',
};

function SignalRow({ s }: { s: Signal }) {
  return (
    <View style={{ paddingVertical: space.s, borderBottomWidth: 1, borderColor: colors.border }}>
      <Text style={[type.body, { fontWeight: '600' }]}>
        {s.label}
        <Text style={type.small}>{`  +${s.points}`}</Text>
      </Text>
      {s.quote ? <Text style={[type.small, { fontStyle: 'italic', marginTop: 2 }]}>”{s.quote}”</Text> : null}
    </View>
  );
}

export function ResultScreen({ entryId }: { entryId: string }) {
  const repo = useRepo();
  const nav = useNav();
  const entry = repo.entries().find((e) => e.id === entryId);
  const a = entry ? repo.assessmentFor(entry.id) : null;

  if (!entry || !a) {
    return (
      <Screen title="Bedömning" back>
        <P>Bedömningen finns inte längre.</P>
      </Screen>
    );
  }

  const garminDay = repo.garminDay(entry.date);
  const why = explainAssessment(entry, a, garminDay);
  const plan = repo.plan();
  const actions = actionsForLevel(a.level, plan);
  const signs = a.signals.filter((s) => s.kind === 'early_sign' || s.kind === 'serious_sign');
  const measured = a.signals.filter((s) => s.kind !== 'early_sign' && s.kind !== 'serious_sign' && s.kind !== 'akut');
  const first = a.level === 'green' ? null : firstStep(a.level, plan);
  // A serious sign shows the plan's red steps, also when the level is yellow.
  const serious = seriousActions(a, plan);

  return (
    <Screen
      title={entry.kind === 'heavy' ? 'Dagen är loggad' : 'Kvällens bedömning'}
      back
      footer={<Button title="Till startsidan" onPress={() => nav.reset()} />}
    >
      <Text style={[type.small, { marginTop: -space.s, marginBottom: space.l }]}>
        {formatDateSv(a.date)}, inlägg {formatTime(entry.createdAt)}
      </Text>

      {a.akut ? <CrisisCard plan={plan} /> : a.akutMild ? <CrisisCard plan={plan} mild /> : null}

      <Card tone={a.level} style={{ alignItems: 'center', borderColor: levelColor(a.level) }}>
        <LevelLight level={a.level} />
        <P style={{ textAlign: 'center', marginTop: space.m }}>{displaySentence(a)}</P>
      </Card>

      {a.level === 'green' && a.trend?.length ? (
        // A neutral observation: no points, no colour.
        <View style={{ marginBottom: space.l }}>
          {a.trend.map((line) => <P key={line} muted style={{ textAlign: 'center' }}>{line}</P>)}
        </View>
      ) : null}

      {serious && (
        <Card style={{ borderColor: colors.red, borderWidth: 2 }}>
          <Text style={type.h2}>Åtgärder vid rött</Text>
          <P style={{ marginTop: space.xs }}>{SERIOUS_INTRO}</P>
          {serious.length ? serious.map((p, i) => (
            <P key={p.id} style={{ marginTop: space.xs }}>{`${i + 1}. ${p.text}`}</P>
          )) : (
            <P style={{ marginTop: space.xs }}>Din plan har ingen åtgärd vid rött ännu. Lägg till en under Min krisplan.</P>
          )}
          <P muted style={{ marginTop: space.s }}>Appen kontaktar ingen. Det är du som bestämmer vad du gör.</P>
        </Card>
      )}

      {a.level === 'red' && !a.akut && !serious && (
        <Card style={{ borderColor: colors.red, borderWidth: 2 }}>
          <Text style={type.h2}>Rekommendation</Text>
          <P style={{ marginTop: space.xs }}>
            {first
              ? `Din plan säger att det första steget vid rött är: ${first.text}`
              : 'Din plan har ingen åtgärd vid rött ännu. Lägg till en under Min krisplan.'}
          </P>
          <P muted style={{ marginTop: space.s }}>Appen kontaktar ingen. Det är du som bestämmer vad du gör.</P>
        </Card>
      )}

      {entry.kind === 'heavy' && a.level !== 'red' && (
        <Card tone="accent">
          <Text style={type.h2}>Första steget i din plan</Text>
          <P style={{ marginTop: space.xs }}>
            {firstStep('yellow', plan)?.text ?? 'Din plan har ingen åtgärd vid gult ännu.'}
          </P>
        </Card>
      )}

      <Section title="Så gjordes bedömningen">
        <Card>
          <Text style={type.label}>UNDERLAG</Text>
          {why.data.map((line) => (
            <P key={line} style={{ marginTop: space.xs }}>{`• ${line}`}</P>
          ))}
          <Text style={[type.label, { marginTop: space.m }]}>TECKEN SOM GAV POÄNG</Text>
          {why.signs.length ? why.signs.map((s, i) => (
            <P key={s.label + i} style={{ marginTop: space.xs }}>{`• ${s.label}  +${s.points}`}</P>
          )) : <P muted style={{ marginTop: space.xs }}>Inga.</P>}
          <Text style={[type.label, { marginTop: space.m }]}>SLUTSATS</Text>
          <P style={{ marginTop: space.xs, fontWeight: '600' }}>{why.conclusion}</P>
        </Card>
      </Section>

      <CorrectionBox assessment={a} />

      {actions.length > 0 && !(serious && a.level === 'red') && (
        <Section title={a.level === 'red' ? 'Åtgärder vid rött' : 'Åtgärder vid gult'}>
          <Card>
            {actions.map((p, i) => (
              <P key={p.id} style={{ marginBottom: space.xs }}>{`${i + 1}. ${p.text}`}</P>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Tecken ur din plan">
        <Card>
          {signs.length ? signs.map((s) => <SignalRow key={s.kind + s.planItemId} s={s} />) : (
            <P muted>Inga av dina tecken hittades i anteckningen.</P>
          )}
        </Card>
      </Section>

      <Section title="Mätt">
        <Card>
          {measured.length ? measured.map((s, i) => <SignalRow key={s.kind + i} s={s} />) : (
            <P muted>Inga mätta tecken.</P>
          )}
          <View style={{ marginTop: space.m }}>
            <Text style={type.label}>DAGENS VÄRDEN</Text>
            <P muted>
              {[
                entry.mood != null ? `Stämning ${entry.mood}` : null,
                entry.energy != null ? `energi ${entry.energy}` : null,
                entry.sleepHours != null
                  ? `sömn ${String(entry.sleepHours).replace('.', ',')} h${entry.sleepSource === 'transcript' ? ' (skattat)' : entry.sleepSource === 'garmin' ? ' (Garmin)' : ''}`
                  : 'sömn saknas',
                garminDay?.sleepStart && entry.sleepSource === 'garmin' ? `somnade ${garminDay.sleepStart}` : null,
                entry.stressAvg != null ? `stress ${entry.stressAvg}` : null,
                garminDay?.bodyBatteryWake != null ? `Body Battery ${garminDay.bodyBatteryWake} vid uppvaknandet` : null,
                entry.wordsPerMinute != null ? `${entry.wordsPerMinute} ord/min` : 'talhastighet ej mätt',
              ].filter(Boolean).join(', ')}
            </P>
            <Text style={[type.label, { marginTop: space.s }]}>DIN BASLINJE</Text>
            <P muted>
              {a.baseline.greenDays} gröna dagar senaste 28 dagarna.
              {a.baseline.wordsPerMinute != null ? ` Vanligt tempo ${a.baseline.wordsPerMinute} ord/min.` : ''}
              {a.baseline.stressAvg != null ? ` Vanlig stress ${a.baseline.stressAvg}.` : ''}
              {a.baseline.greenDays < 3 ? ' Baslinjen behöver minst tre gröna dagar.' : ''}
            </P>
          </View>
        </Card>
      </Section>

      {entry.transcript ? (
        <Section title="Anteckningen">
          <Card><P>{entry.transcript}</P></Card>
        </Section>
      ) : null}

      <P muted style={{ marginTop: space.l }}>
        {METHOD_TEXT[a.method]} Poäng: {a.points}.
        {a.method === 'llm' && a.model ? ` Modell ${a.model}, prompt ${a.promptId} ${a.promptVersion}.` : ''}
      </P>
    </Screen>
  );
}
