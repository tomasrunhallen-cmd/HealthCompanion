import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { actionsForLevel, displaySentence, firstStep, SERIOUS_INTRO, seriousActions } from '../../core/analysis/assess';
import { formatDateSv, formatDateSvYear, formatTime } from '../../core/analysis/dates';
import { explainAssessment } from '../../core/analysis/explain';
import { CrisisCard } from '../CrisisCard';
import { correctionFor } from '../../services/corrections';
import { MEDICAL_REMINDER } from '../../legal';
import type { Signal } from '../../core/domain/types';
import { directionSentence, routinesFor, showValueAnchors, signDirection } from '../../core/plan/guidance';
import { greenDayLine, routineSummary, routinesToday as routinesTodayList } from '../../core/plan/routines';
import { SOURCE_TEXT } from '../../core/analysis/sources';
import { Button, Card, LevelLight, P, Screen, Section } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, LEVEL_TEXT, levelColor, space, type } from '../theme';

const METHOD_TEXT = {
  wordmatch: 'Tecknen hittades med ordmatchning på telefonen (ingen språkmodell).',
  llm: 'Tecknen tolkades av din språkmodell. Nivån räknades i appen.',
  llm_fallback: 'Språkmodellen svarade inte som den skulle, så ordmatchning användes i stället.',
  none: 'Ingen text att jämföra med.',
  import: 'Dagen importerades från din tidigare dagbok. Tecknen kom från hur du kopplade dagbokens kolumner till dina tecken, och från ordmatchning i anteckningen. Nivån räknades i appen.',
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
  // When the screen opened: an assessment still waiting for the model after two minutes will not get an answer.
  const [openedAt] = useState(() => Date.now());
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

  const garminDay = repo.measuredDay(entry.date);
  const why = explainAssessment(entry, a, garminDay);
  const plan = repo.plan();
  // Which way the signs point, in the plan's own words. Points and level are unchanged.
  const dir = signDirection(a.signals, plan);
  const direction = a.akut ? null : directionSentence(dir, repo.planSettings());
  const actions = actionsForLevel(a.level, plan, dir);
  const routines = a.level === 'yellow' ? routinesFor(repo.contextOf('routine'), dir) : [];
  const todays = routinesTodayList(repo.contextEntries(), repo.settings().planMode);
  const greenLine = a.level === 'green' && !a.akut
    ? greenDayLine(repo.contextEntries(), a.date, { measured: repo.measuredDays(), window: repo.planSettings().sleepWindow ?? null })
    : null;
  const routinesToday = routineSummary(repo.contextEntries(), a.date, todays.daily.length + todays.extra.length);
  const anchors = showValueAnchors(a, repo.assessments()) ? repo.contextOf('value_anchor').filter((e) => e.approvedAt) : [];
  const signs = a.signals.filter((s) => s.kind === 'early_sign' || s.kind === 'serious_sign');
  const measured = a.signals.filter((s) => s.kind !== 'early_sign' && s.kind !== 'serious_sign' && s.kind !== 'akut');
  const first = a.level === 'green' ? null : firstStep(a.level, plan, dir);
  // A serious sign shows the plan's red steps, also when the level is yellow.
  const serious = seriousActions(a, plan, dir);
  const answered = correctionFor(repo, a.id).length > 0;

  return (
    <Screen
      title={entry.kind === 'heavy' ? 'Loggad dag' : entry.kind === 'imported' ? 'Importerad dag' : 'Bedömning'}
      back
      footer={<Button title="Till startsidan" onPress={() => nav.reset()} />}
    >
      <Text style={[type.small, { marginTop: -space.s, marginBottom: space.l }]}>
        {entry.kind === 'imported' ? `${formatDateSvYear(a.date)}, importerad` : `${formatDateSv(a.date)}, inlägg ${formatTime(entry.createdAt)}`}
      </Text>

      {a.akut ? <CrisisCard plan={plan} /> : a.akutMild ? <CrisisCard plan={plan} mild /> : null}

      {anchors.length ? (
        // The plan's value anchors, word for word, on red and after three yellow days in a row.
        <Card tone="accent">
          <Text style={type.label} accessibilityRole="header">DET SOM ÄR VIKTIGT FÖR DIG</Text>
          {anchors.map((e) => <P key={e.id} style={{ marginTop: space.xs }}>{e.text}</P>)}
        </Card>
      ) : null}

      {a.awaitingModel ? (
        <Card>
          <Text accessibilityLiveRegion="polite" style={type.body}>
            {openedAt - new Date(a.createdAt).getTime() < 120_000
              ? 'Språkmodellen har inte svarat än. Det här är ordmatchningens resultat från telefonen. Bedömningen fylls på när svaret kommer.'
              : 'Språkmodellen hann inte svara. Ordmatchningens resultat från telefonen gäller för dagen.'}
          </Text>
        </Card>
      ) : null}

      <Card tone={a.level} style={{ alignItems: 'center', borderColor: levelColor(a.level) }}>
        <LevelLight level={a.level} />
        <P style={{ textAlign: 'center', marginTop: space.m }}>{displaySentence(a)}</P>
        {direction && a.level !== 'green' ? <P muted style={{ textAlign: 'center', marginTop: space.s }}>{direction}</P> : null}
      </Card>

      {greenLine ? (
        // Gröna dagar: what the person did, never that all is well.
        <P muted style={{ textAlign: 'center', marginBottom: space.m }}>{greenLine}</P>
      ) : null}

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
            {firstStep('yellow', plan, dir)?.text ?? 'Din plan har ingen åtgärd vid gult ännu.'}
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

      <Section title="Stämmer bedömningen?">
        <Card>
          <P muted style={{ marginBottom: space.s }}>
            {answered ? 'Du har redan svarat. Du kan ändra ditt svar.' : 'Ditt svar hjälper appen att lära sig vad som stämmer för dig.'}
          </P>
          <Button kind="secondary" title={answered ? 'Ändra ditt svar' : 'Svara'} onPress={() => nav.push({ name: 'correction', assessmentId: a.id })} />
        </Card>
      </Section>

      {actions.length > 0 && !(serious && a.level === 'red') && (
        <Section title={a.level === 'red' ? 'Åtgärder vid rött' : 'Åtgärder vid gult'}>
          <Card>
            {actions.map((p, i) => (
              <P key={p.id} style={{ marginBottom: space.xs }}>{`${i + 1}. ${p.text}`}</P>
            ))}
          </Card>
        </Section>
      )}

      {routinesToday ? (
        <Section title="Rutiner i dag">
          <Card>
            <P>
              {routinesToday.done.length
                ? `Du gjorde ${routinesToday.done.length} av ${routinesToday.answered} rutiner i dag.`
                : 'Ingen av rutinerna blev av i dag. Det räknas inte in i nivån.'}
            </P>
            {routinesToday.done.map((t) => <P key={t} muted style={{ marginTop: space.xs }}>{`✓ ${t}`}</P>)}
          </Card>
        </Section>
      ) : null}

      {routines.length > 0 && (
        <Section title="Livsstil och rutiner">
          <Card>
            <P muted style={{ marginBottom: space.xs }}>Från din plan.</P>
            {routines.map((e) => <P key={e.id} style={{ marginBottom: space.xs }}>{`• ${e.text}`}</P>)}
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
                  ? `sömn ${String(entry.sleepHours).replace('.', ',')} h${entry.sleepSource ? ` (${SOURCE_TEXT[entry.sleepSource]})` : ''}`
                  : 'sömn saknas',
                garminDay?.sleepStart && entry.sleepSource !== 'transcript' ? `somnade ${garminDay.sleepStart}` : null,
                entry.stressAvg != null ? `stress ${entry.stressAvg} (${SOURCE_TEXT[entry.stressSource ?? 'garmin']})` : null,
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
        {a.inputs ? ` Regler ${a.inputs.rulesVersion}.` : ''}
        {a.recomputed ? ` Omräknad ${a.recomputed.at.slice(0, 10)}; tidigare ${LEVEL_TEXT[a.recomputed.level].toLowerCase()} med ${a.recomputed.points} poäng.` : ''}
      </P>
      <P muted style={{ marginTop: space.s }}>{MEDICAL_REMINDER}</P>
    </Screen>
  );
}
