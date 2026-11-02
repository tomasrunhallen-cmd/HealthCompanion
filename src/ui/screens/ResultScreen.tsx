import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { actionsForLevel, displaySentence, firstStep, seriousActions, seriousIntro } from '../../core/analysis/assess';
import { addDays, eveningDateKey, formatDateSv, formatDateSvYear, formatTime } from '../../core/analysis/dates';
import { explainAssessment } from '../../core/analysis/explain';
import { CrisisCard } from '../CrisisCard';
import { correctionFor } from '../../services/corrections';
import { MEDICAL_REMINDER } from '../../legal';
import { directionSentence, routinesFor, showValueAnchors, signDirection } from '../../core/plan/guidance';
import { greenDayLine, routineSummary, routinesToday as routinesTodayList } from '../../core/plan/routines';
import { SOURCE_TEXT } from '../../core/analysis/sources';
import { Button, Card, Disclosure, LevelLight, P, Screen, Section, Step, Tag } from '../components';
import { useNav } from '../nav';
import { useDialog, useRepo } from '../state';
import { RemeasureCard } from '../RemeasureCard';
import { wasStale } from '../../core/analysis/remeasure';
import { moodText } from '../../core/analysis/mood';
import { thinLine } from '../../core/analysis/coverage';
import { TextPatternResult } from '../TextPatternResult';
import { forgetKept, isKept, remeasureEntry } from '../../services/remeasure';
import { SYNC_DAYS, syncGarmin } from '../../services/garmin';
import { colors, LEVEL_TEXT, levelColor, space, type } from '../theme';

const METHOD_TEXT = {
  wordmatch: 'Tecknen hittades med ordmatchning på telefonen (ingen språkmodell).',
  llm: 'Tecknen tolkades av din språkmodell. Nivån räknades i appen.',
  llm_fallback: 'Språkmodellen svarade inte som den skulle, så ordmatchning användes i stället.',
  none: 'Ingen text att jämföra med.',
  import: 'Dagen importerades från din tidigare dagbok. Tecknen kom från hur du kopplade dagbokens kolumner till dina tecken, och från ordmatchning i anteckningen. Nivån räknades i appen.',
};

export function ResultScreen({ entryId }: { entryId: string }) {
  // When the screen opened: an assessment still waiting for the model after two minutes will not get an answer.
  const [openedAt] = useState(() => Date.now());
  // The person asked for the watch's values again on this screen.
  const [asked, setAsked] = useState(false);
  const [fetching, setFetching] = useState(false);
  const repo = useRepo();
  const nav = useNav();
  const dialog = useDialog();
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
  // The plan's signs first, then what was measured; nothing that gave no points.
  const seen = [
    ...a.signals.filter((s) => (s.kind === 'early_sign' || s.kind === 'serious_sign') && s.points > 0),
    ...a.signals.filter((s) => s.kind !== 'early_sign' && s.kind !== 'serious_sign' && s.kind !== 'akut' && s.points > 0),
  ];
  const first = a.level === 'green' ? null : firstStep(a.level, plan, dir);
  // A serious sign shows the plan's red steps, also when the level is yellow.
  const serious = seriousActions(a, plan, dir);
  const answered = correctionFor(repo, a.id).length > 0;
  // Next to the level: what is missing, so a green day without sleep does not look like a full one.
  const thin = thinLine(entry, a);
  // Values the watch synced after the check-in: shown when it lagged, when values were missing, or when asked.
  const remeasured = entry.kind === 'imported' ? null : remeasureEntry(repo, entry.id);
  const lagged = wasStale(entry) || entry.stressAvg == null || entry.sleepHours == null || entry.sleepSource === 'transcript';
  const showRemeasure = remeasured && !isKept(repo, remeasured) && (asked || lagged);
  const recent = entry.date >= addDays(eveningDateKey(new Date()), -SYNC_DAYS);
  const canFetch = repo.garminStatus().connected && recent && entry.kind !== 'imported' && !showRemeasure;
  const fetchAgain = async () => {
    setFetching(true);
    try {
      const res = await syncGarmin(repo);
      if (!res.ok) {
        await dialog.info('Hämtningen misslyckades', res.error ?? 'Försök igen senare.');
        return;
      }
      const r = remeasureEntry(repo, entry.id);
      if (!r) await dialog.info('Samma värden', 'Garmin har samma värden som bedömningen använde.');
      else if (isKept(repo, r)) await forgetKept(repo, entry.id);
      setAsked(true);
    } finally {
      setFetching(false);
    }
  };

  return (
    <Screen
      title={entry.kind === 'heavy' ? 'Loggad dag' : entry.kind === 'imported' ? 'Importerad dag' : 'Bedömning'}
      back
      footer={<Button title="Till startsidan" onPress={() => nav.reset()} />}
    >
      <Text style={[type.label, { textTransform: 'uppercase', marginTop: -space.s, marginBottom: space.l }]}>
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
              ? 'En första bedömning. Den kan uppdateras om en stund.'
              : 'Bedömningen är klar.'}
          </Text>
        </Card>
      ) : null}

      <Card tone={a.level} style={{ alignItems: 'center', borderColor: levelColor(a.level) }}>
        <LevelLight level={a.level} />
        <P style={{ textAlign: 'center', marginTop: space.m }}>{displaySentence(a)}</P>
        {/* The model's own sentence is marked as such; the level beside it is counted in the app. */}
        {a.method === 'llm' && displaySentence(a) === a.sentence ? (
          <View style={{ marginTop: space.s, alignItems: 'center' }}><Tag label="Meningen är formulerad av AI" /></View>
        ) : null}
        {direction && a.level !== 'green' ? <P muted style={{ textAlign: 'center', marginTop: space.s }}>{direction}</P> : null}
        {thin ? <P muted style={{ textAlign: 'center', marginTop: space.s }}>{thin}</P> : null}
      </Card>

      {showRemeasure ? <RemeasureCard r={remeasured!} onDone={() => setAsked(false)} /> : null}

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
        <Step tag="Från din plan">
          <Text style={type.h2} accessibilityRole="header">Åtgärder vid rött</Text>
          <P style={{ marginTop: space.xs }}>{seriousIntro(a)}</P>
          {serious.length ? serious.map((p, i) => (
            <P key={p.id} style={{ marginTop: space.xs }}>{`${i + 1}. ${p.text}`}</P>
          )) : (
            <P style={{ marginTop: space.xs }}>Din plan har ingen åtgärd vid rött ännu. Lägg till en under Min krisplan.</P>
          )}
          <P muted style={{ marginTop: space.s }}>Appen kontaktar ingen.</P>
        </Step>
      )}

      {a.level === 'red' && !a.akut && !serious && (
        <Step tag="Från din plan">
          <Text style={type.h2} accessibilityRole="header">Ditt nästa steg</Text>
          <P style={{ marginTop: space.xs }}>
            {first ? first.text : 'Din plan har ingen åtgärd vid rött ännu. Lägg till en under Min krisplan.'}
          </P>
          <P muted style={{ marginTop: space.s }}>Appen kontaktar ingen.</P>
        </Step>
      )}

      {entry.kind === 'heavy' && a.level !== 'red' && (
        <Card tone="accent">
          <Text style={type.h2} accessibilityRole="header">Första steget i din plan</Text>
          <P style={{ marginTop: space.xs }}>
            {firstStep('yellow', plan, dir)?.text ?? 'Din plan har ingen åtgärd vid gult ännu.'}
          </P>
        </Card>
      )}

      {actions.length > 0 && !(serious && a.level === 'red') && (
        <Section title={a.level === 'red' ? 'Din plan vid rött' : 'Din plan vid gult'}>
          <Card>
            {actions.map((p, i) => (
              <P key={p.id} style={{ marginBottom: space.xs }}>{`${i + 1}. ${p.text}`}</P>
            ))}
          </Card>
        </Section>
      )}

      {routines.length > 0 && (
        <Section title="Livsstil och rutiner">
          <Card>
            {routines.map((e) => <P key={e.id} style={{ marginBottom: space.xs }}>{`• ${e.text}`}</P>)}
          </Card>
        </Section>
      )}

      {/* What the app saw, in plain words. Points and method are under Så räknade appen. */}
      <Section title="Det här syntes i dag">
        <Card>
          {seen.length ? seen.map((s, i) => (
            <View key={s.kind + (s.planItemId ?? '') + i} style={{ paddingVertical: space.s, borderBottomWidth: i < seen.length - 1 ? 1 : 0, borderColor: colors.border }}>
              <Text style={[type.body, { fontWeight: '600' }]}>{s.label}</Text>
              {s.quote ? <Text style={[type.body, { marginTop: 2 }]} accessibilityLabel={`Ur din anteckning: ${s.quote}`}>”{s.quote}”</Text> : null}
            </View>
          )) : (
            <P muted>Inga av tecknen i din plan syntes i dag.</P>
          )}
        </Card>
        {canFetch ? (
          <Button kind="ghost" title="Synkade klockan sent? Hämta värdena igen" hint="Hämtar Garmins värden och visar om dagen ändras" busy={fetching} onPress={fetchAgain} />
        ) : null}
      </Section>

      {routinesToday ? (
        <Section title="Rutiner i dag">
          <Card>
            <P>
              {routinesToday.done.length
                ? `Du gjorde ${routinesToday.done.length} av ${routinesToday.answered} rutiner i dag.`
                : 'Ingen av rutinerna blev av i dag. Det påverkar inte nivån.'}
            </P>
            {routinesToday.done.map((t) => <P key={t} muted style={{ marginTop: space.xs }}>{`✓ ${t}`}</P>)}
          </Card>
        </Section>
      ) : null}

      <TextPatternResult a={a} />

      <Section title="Stämmer bedömningen?">
        <Card>
          <Button kind="secondary" title={answered ? 'Ändra ditt svar' : 'Svara'} label={answered ? 'Ändra ditt svar om bedömningen' : 'Svara om bedömningen stämmer'} onPress={() => nav.push({ name: 'correction', assessmentId: a.id })} />
        </Card>
      </Section>

      {entry.transcript ? (
        <Section title="Din anteckning">
          <Card><P>{entry.transcript}</P></Card>
        </Section>
      ) : null}

      {/* For the curious and for review: data, points, rule and method. Closed by default. */}
      <Disclosure title="Så räknade appen">
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
          <Text style={[type.label, { marginTop: space.m }]}>DAGENS VÄRDEN</Text>
          <P muted>
            {[
              entry.mood != null ? `Stämning ${moodText(entry.mood).toLowerCase()}` : null,
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
          {a.inputs?.sentText ? (
            <>
              <Text style={[type.label, { marginTop: space.s }]}>SKICKAT TILL MODELLEN, RENSAT</Text>
              <Text selectable style={type.small}>{a.inputs.sentText}</Text>
            </>
          ) : null}
          <Text style={[type.label, { marginTop: space.s }]}>METOD</Text>
          <P muted>
            {METHOD_TEXT[a.method]} Poäng: {a.points}.
            {a.method === 'llm' && a.model ? ` Modell ${a.model}, prompt ${a.promptId} ${a.promptVersion}.` : ''}
            {a.inputs ? ` Regler ${a.inputs.rulesVersion}.` : ''}
            {a.awaitingModel ? ' Språkmodellen hade inte svarat när bedömningen visades, så ordmatchningens resultat gäller.' : ''}
            {a.textPatterns ? ` Mina tidigare texter: prompt ${a.textPatterns.promptId} ${a.textPatterns.promptVersion}${a.textPatterns.model ? `, modell ${a.textPatterns.model}` : ''}, referenser ${a.textPatterns.referenceVersion} (${a.textPatterns.referenceIds.length} utdrag), regler ${a.textPatterns.rulesVersion}.` : ''}
            {a.remeasured ? ` Uppdaterad med klockans senare värden ${a.remeasured.at.slice(0, 10)}; tidigare ${LEVEL_TEXT[a.remeasured.level].toLowerCase()} med ${a.remeasured.points} poäng.` : ''}
            {a.recomputed ? ` Omräknad ${a.recomputed.at.slice(0, 10)}; tidigare ${LEVEL_TEXT[a.recomputed.level].toLowerCase()} med ${a.recomputed.points} poäng.` : ''}
          </P>
        </Card>
      </Disclosure>
      <P muted style={{ marginTop: space.l }}>{MEDICAL_REMINDER}</P>
    </Screen>
  );
}
