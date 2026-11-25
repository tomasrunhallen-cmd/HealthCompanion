// Dygnsrytm (experimental): the passive estimate from the watch. The page goes from what the
// watch shows (the observation), to one step from the person's own plan, to what it rests on:
// the nights as a simple chart, the comparison with earlier periods the person has entered (kept
// apart from the observation, and never a claim that a period is starting), and optional context.
// How it is used and its effect on the evening's colour are one folded part; the pulse share, the
// fetch log, the evaluation and the arithmetic are another (Fördjupning).
// The rated mood, this estimate and the earlier periods are kept apart, here and in storage.

import { RULES } from '../../core/analysis/rules';
import { meanPhases, phasesOf } from '../../core/analysis/sleepPhases';
import { PHASES_NOTE, SleepPhasesBar } from '../SleepPhases';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, formatDateSv, formatDateSvYear, formatTime, toDateKey } from '../../core/analysis/dates';
import { LEVEL_WORD } from '../../core/analysis/levelWords';
import { axis, changeSentence, clockOfAxis, directionText, eveningOf, nightsFrom, PATTERN_WORD, type RhythmAssessment, type RhythmMode } from '../../core/analysis/rhythm';
import { assumptions, evaluateRhythm, METHOD_NAME, MIN_EPISODES_FOR_RATE, rate, type RhythmEvaluation } from '../../core/analysis/rhythmEval';
import { simulatedYear } from '../../core/analysis/rhythmSim';
import type { DateKey, Level } from '../../core/domain/types';
import {
  activityDays, activityProgress, activitySource, episodeStarts, fetchAllActivity, missingActivityDays, evaluateOwnData, explainCourse, latestRhythm, markRhythmSeen, planStepFor,
  rhythmCard, rhythmEffect, rhythmFeedback, rhythmMode, setRhythmMode, syncLog, undoExplanation, watchNights,
} from '../../services/rhythm';
import { Button, Card, Chip, Disclosure, Eyebrow, P, Row, Screen, Section, Tag } from '../components';
import { rhythmFreshness, rhythmHeadline } from '../RhythmToday';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, MIN_TOUCH, radius, space, type } from '../theme';

const MODES: RhythmMode[] = ['off', 'show', 'use'];
export const MODE_LABEL: Record<RhythmMode, string> = { off: 'Av', show: 'Visa mönster', use: 'Använd i bedömningen' };
const MODE_TEXT: Record<RhythmMode, string> = {
  off: 'Appen tittar inte på klockans sömn och puls.',
  show: 'Du ser mönstret. Kvällens färg påverkas aldrig.',
  use: 'En förändring som liknar tiden före en tidigare period kan göra kvällens färg gul, aldrig röd på egen hand.',
};

const TRIGGER: Record<string, string> = { open: 'appen öppnades', checkin: 'avstämning', manual: 'Hämta igen', connect: 'anslutning' };
const REASONS = ['Resa', 'Sjuk', 'Fest eller gäster', 'Arbete', 'Annat'];

const MONTH = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const shortDate = (d: DateKey) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`;

function Label({ children }: { children: string }) {
  return <Text style={[type.label, { marginTop: space.m, marginBottom: space.xs }]} accessibilityRole="header">{children.toUpperCase()}</Text>;
}

/** One choice per row, with what it means under it: the three names are too long for a segmented control. */
function ModeChooser({ mode, onChange }: { mode: RhythmMode; onChange: (m: RhythmMode) => void }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Hur Dygnsrytm används">
      {MODES.map((m) => {
        const on = m === mode;
        // During the first clinical evaluation the signal is shown only (rules 1.9.0).
        const locked = m === 'use' && !RULES.experimentalInLevel;
        return (
          <Pressable
            key={m}
            disabled={locked}
            onPress={() => onChange(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on, disabled: locked }}
            accessibilityLabel={`${MODE_LABEL[m]}. ${MODE_TEXT[m]}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: space.m, minHeight: MIN_TOUCH, paddingVertical: space.s, opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? colors.accent : colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { fontWeight: on ? '600' : '400' }]}>{MODE_LABEL[m]}</Text>
              <Text style={type.small}>{locked ? 'Inte valbart under den första kliniska utvärderingen: Dygnsrytm visas men räknas inte in i färgen.' : MODE_TEXT[m]}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const hoursWord = (h: number) => `${String(h).replace('.', ',')} h`;

/**
 * The latest seven nights as bars from falling asleep to waking, on a field that shows the usual
 * night. Later and shorter sleep are both visible at a glance; the exact values are one tap away.
 */
/** The latest night's phases, the week's mean and the month's mean, as background next to the nights. */
function SleepPhasesSection() {
  const repo = useRepo();
  const days = repo.measuredDays();
  const dates = Object.keys(days).filter((d) => phasesOf(days[d])).sort();
  const last = dates[dates.length - 1];
  if (!last) return null;
  const week = meanPhases(days, addDays(last, -6), last);
  const month = meanPhases(days, addDays(last, -27), last);
  return (
    <Section title="Sömnfaser">
      <Card>
        <SleepPhasesBar parts={phasesOf(days[last])!} label={`Natten till ${formatDateSv(last)}`} />
        {week && week.nights > 1 ? <SleepPhasesBar parts={week.parts} label={`Snitt senaste veckan, ${week.nights} nätter`} /> : null}
        {month && week && month.nights > week.nights ? <SleepPhasesBar parts={month.parts} label={`Snitt senaste fyra veckorna, ${month.nights} nätter`} /> : null}
        <P muted style={{ marginTop: space.s }}>{PHASES_NOTE} Mina mönster prövar om mindre djupsömn än vanligt brukar komma före perioder då du skattat lägre.</P>
      </Card>
    </Section>
  );
}

function NightsChart({ a }: { a: RhythmAssessment }) {
  const repo = useRepo();
  const [exact, setExact] = useState(false);
  const nights = nightsFrom(watchNights(repo), addDays(a.date, -6), a.date);
  const inWindow = (d: DateKey) => d >= a.covers.from && d <= a.covers.to;
  const usualOn = a.baseline ? axis(a.baseline.onset) : null;
  const usualHours = a.baseline ? Number(a.baseline.hours.replace(' h', '').replace(',', '.')) : null;
  const usualWake = usualOn != null && usualHours != null ? usualOn + usualHours * 60 : null;
  const bars = nights.map((n) => (n.excluded ? null : { from: n.onset!, to: n.wake != null && n.wake > n.onset! ? n.wake : n.onset! + n.hours! * 60 }));
  const starts = [...bars.filter((b) => b).map((b) => b!.from), ...(usualOn != null ? [usualOn] : [])];
  const ends = [...bars.filter((b) => b).map((b) => b!.to), ...(usualWake != null ? [usualWake] : [])];
  if (!starts.length) return <P muted>Inga nätter från klockan den senaste veckan.</P>;
  const lo = Math.floor((Math.min(...starts) - 20) / 60) * 60;
  const hi = Math.ceil((Math.max(...ends) + 20) / 60) * 60;
  const pos = (m: number) => `${((m - lo) / (hi - lo)) * 100}%` as const;
  const width = (from: number, to: number) => `${((to - from) / (hi - lo)) * 100}%` as const;
  const ticks: number[] = [];
  for (let m = Math.ceil(lo / 120) * 120; m <= hi; m += 120) ticks.push(m);
  const LABEL = 62;
  return (
    <View>
      <View accessibilityLabel="De senaste sju nätterna, från insomning till uppvakning, mot hur du brukar sova">
        {nights.map((n, i) => {
          const b = bars[i];
          const strong = inWindow(n.date);
          return (
            <View
              key={n.date}
              accessible
              accessibilityLabel={b
                ? `Natten till ${shortDate(n.date)}: somnade ${clockOfAxis(b.from)}, vaknade ${clockOfAxis(b.to)}, sov ${hoursWord(n.hours!)}${strong ? '. Med i bedömningen' : ''}`
                : `Natten till ${shortDate(n.date)}: ${n.excluded === 'missing' ? 'ingen sömn från klockan' : n.excluded === 'timezone' ? 'tidszonsbyte, jämförs inte' : 'sov på dagen'}`}
              style={{ flexDirection: 'row', alignItems: 'center', height: 26 }}
            >
              <Text style={[type.small, { width: LABEL }, strong && { fontWeight: '600', color: colors.text }]}>{shortDate(n.date)}</Text>
              <View style={{ flex: 1, height: 18, justifyContent: 'center' }}>
                {usualOn != null && usualWake != null ? (
                  <View style={{ position: 'absolute', left: pos(usualOn), width: width(usualOn, usualWake), top: 0, bottom: 0, backgroundColor: colors.surfaceAlt, borderRadius: radius.xs }} />
                ) : null}
                {b ? (
                  <View style={{ position: 'absolute', left: pos(b.from), width: width(b.from, b.to), height: 10, borderRadius: 5, backgroundColor: strong ? colors.accent : colors.textMuted, opacity: strong ? 1 : 0.45 }} />
                ) : (
                  <Text style={[type.small, { fontSize: 13 }]}>{n.excluded === 'missing' ? 'Ingen sömn från klockan' : n.excluded === 'timezone' ? 'Tidszonsbyte' : 'Sov på dagen'}</Text>
                )}
              </View>
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', height: 20 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={{ width: LABEL }} />
          <View style={{ flex: 1 }}>
            {ticks.map((m) => (
              <Text key={m} style={[type.small, { fontSize: 12, position: 'absolute', left: pos(m), width: 30, marginLeft: -15, textAlign: 'center' }]}>{clockOfAxis(m).slice(0, 2)}</Text>
            ))}
          </View>
        </View>
      </View>
      <P muted style={{ marginTop: space.xs }}>
        {a.baseline ? `Fältet bakom staplarna är hur du brukar sova: från ${a.baseline.onset}, ${a.baseline.hours.replace(' h', ' timmar')}. ` : ''}Mörka staplar är nätterna bedömningen bygger på.
      </P>
      <Button kind="ghost" title={exact ? 'Dölj exakta värden' : 'Visa exakta värden'} onPress={() => setExact(!exact)} />
      {exact ? <NightsTable a={a} /> : null}
    </View>
  );
}

/** The latest nights against the usual, as numbers. `pulse`: the evening's share of raised pulse instead of the sleep. */
function NightsTable({ a, pulse }: { a: RhythmAssessment; pulse?: boolean }) {
  const repo = useRepo();
  const nights = nightsFrom(watchNights(repo), addDays(a.date, -6), a.date);
  const act = activityDays(repo);
  const inWindow = (d: DateKey) => d >= a.covers.from && d <= a.covers.to;
  const cell = { flex: 1, textAlign: 'right' as const };
  return (
    <View accessibilityLabel={pulse ? 'Förhöjd puls på kvällen de senaste sju dygnen' : 'De senaste sju nätterna mot det vanliga'}>
      <Row style={{ paddingVertical: space.xs, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={[type.small, { flex: 1.3 }]}>Natten till</Text>
        {pulse ? <Text style={[type.small, cell]}>Efter 21</Text> : (
          <>
            <Text style={[type.small, cell]}>Somnade</Text>
            <Text style={[type.small, cell]}>Sov</Text>
          </>
        )}
      </Row>
      {a.baseline ? (
        <Row style={{ paddingVertical: space.xs }}>
          <Text style={[type.small, { flex: 1.3, fontStyle: 'italic' }]}>Vanligt</Text>
          {pulse ? <Text style={[type.small, cell]}>{a.baseline.late ?? '–'}</Text> : (
            <>
              <Text style={[type.small, cell]}>{a.baseline.onset}</Text>
              <Text style={[type.small, cell]}>{a.baseline.hours}</Text>
            </>
          )}
        </Row>
      ) : null}
      {nights.map((n) => {
        const e = eveningOf(act, n.date);
        const strong = inWindow(n.date);
        const t = [type.body, cell, strong && { fontWeight: '600' as const }];
        return (
          <Row key={n.date} style={{ paddingVertical: space.xs, borderTopWidth: 1, borderColor: colors.border }}>
            <Text style={[type.body, { flex: 1.3 }, strong && { fontWeight: '600' as const }]}>{shortDate(n.date)}</Text>
            {pulse ? <Text style={t}>{e.late != null ? `${Math.round(e.late * 100)} %` : '–'}</Text>
              : n.excluded ? (
                <Text style={[type.small, { flex: 2, textAlign: 'right' }]}>
                  {n.excluded === 'missing' ? 'Ingen sömn från klockan' : n.excluded === 'timezone' ? 'Tidszonsbyte, jämförs inte' : 'Sov på dagen'}
                </Text>
              ) : (
                <>
                  <Text style={t}>{clockOfAxis(n.onset!)}</Text>
                  <Text style={t}>{hoursWord(n.hours!)}</Text>
                </>
              )}
          </Row>
        );
      })}
      <P muted style={{ marginTop: space.xs }}>
        {pulse
          ? 'Andel av dygnets minuter med förhöjd puls (minst 25 slag över vilopuls) som kom efter 21. Det är en uppskattning ur pulsen, inte ett mått på rörelse. Fet stil: nätterna bedömningen bygger på.'
          : 'Fet stil: nätterna bedömningen bygger på.'}
      </P>
    </View>
  );
}

function EvaluationView({ ev, onAddEpisode }: { ev: RhythmEvaluation; onAddEpisode: () => void }) {
  const known = ev.episodes.total > 0;
  // The model's alarms over the whole period, newest first: dates the person can hold against memory.
  const alarms = ev.parts.flatMap((p) => p.methods.find((m) => m.method === 'sleep_activity')?.alarms ?? []).reverse();
  const [all, setAll] = useState(false);
  return (
    <View>
      {ev.simulated ? (
        <Card tone="yellow" style={{ marginTop: space.s }}>
          <Text style={[type.body, { fontWeight: '600' }]}>Simulerade testfall</Text>
          <P>Påhittade data. Resultaten säger ingenting om hur modellen fungerar för dig.</P>
        </Card>
      ) : <Label>Dina egna data</Label>}
      <P style={{ marginTop: space.s }}>
        {formatDateSvYear(ev.from)} – {formatDateSvYear(ev.to)}: {ev.coverage.days} dagar, {ev.coverage.nights} nätter med sömn från klockan, {ev.coverage.evenings} kvällar med puls.
        {' '}Tidigare perioder: {ev.episodes.total} ({ev.episodes.bySource.self_retro} angivna i efterhand, {ev.episodes.bySource.clinical} från klinisk bedömning).
      </P>
      <P muted style={{ marginTop: space.xs }}>{assumptions(ev)}</P>
      {!known ? (
        <Card tone="accent" style={{ marginTop: space.s }}>
          <P>Utan inlagda tidigare perioder går det inte att säga om ett larm var rätt eller fel, eller om något fångades i förväg. Det som går att läsa är hur ofta varje metod larmar och hur ofta den avstår.</P>
          <Button kind="secondary" title="Lägg in tidigare perioder" onPress={onAddEpisode} />
        </Card>
      ) : null}
      {ev.parts.map((part) => (
        <View key={part.name}>
          <Label>{part.name === 'test' ? `Testdel, ${formatDateSvYear(part.from)} – ${formatDateSvYear(part.to)}` : `Utvecklingsdel, ${formatDateSvYear(part.from)} – ${formatDateSvYear(part.to)}`}</Label>
          {part.methods.map((m) => {
            const types = (['up', 'down', 'mixed'] as const).filter((t) => m.perType[t].episodes);
            return (
              <View key={m.method} style={{ marginBottom: space.s }}>
                <Text style={[type.body, { fontWeight: '600' }]}>{METHOD_NAME[m.method]}</Text>
                {types.map((t) => {
                  const r = m.perType[t];
                  const word = { up: 'Uppvarvade', down: 'Nedstämda', mixed: 'Blandade' }[t];
                  return (
                    <P key={t}>
                      {word}: {r.caught} av {r.evaluable} bedömbara starter fångade i förväg{r.evaluable < MIN_EPISODES_FOR_RATE ? ' (för få för en andel)' : ''}
                      {r.leadDays.length ? `, förvarning ${r.leadDays.join(', ')} dygn` : ''}.
                    </P>
                  );
                })}
                <P muted>
                  {known ? 'Falsklarm' : 'Larm'}: {rate(m.falseAlarms, m.judgedStableDays, m.days)}{known ? ', räknat på dagar utanför episoder' : ''}. Avstod: {m.abstainDays} av {m.days} dagar.
                </P>
              </View>
            );
          })}
          {known && part.methods[0].perType.up.episodes + part.methods[0].perType.down.episodes + part.methods[0].perType.mixed.episodes < MIN_EPISODES_FOR_RATE
            ? <P muted>För få inlagda perioder i den här delen för att säga hur ofta starter fångas.</P>
            : null}
        </View>
      ))}
      {alarms.length ? (
        <View>
          <Label>{`Modellens larm, sömn och puls (${alarms.length})`}</Label>
          <P muted>Minns du om en period började något av de här dygnen eller strax efter? Lägg då in starten. Det är så modellen kan prövas.</P>
          {(all ? alarms : alarms.slice(0, 8)).map((r) => (
            <P key={r.from} style={{ marginTop: space.xs }}>
              {r.from === r.to ? formatDateSvYear(r.from) : `${formatDateSvYear(r.from)} – ${formatDateSvYear(r.to)}`}: {r.patterns.map((x) => PATTERN_WORD[x]).join(', ') || 'förändring'}{r.startFollowed ? '. En inlagd period började efteråt.' : ''}
            </P>
          ))}
          {alarms.length > 8 ? <Button kind="ghost" title={all ? 'Visa färre' : `Visa alla ${alarms.length}`} onPress={() => setAll(!all)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

export function RhythmScreen() {
  const repo = useRepo();
  const nav = useNav();
  const mode = rhythmMode(repo);
  const a = latestRhythm(repo);
  const [ev, setEv] = useState<RhythmEvaluation | null>(null);
  const feedback = a?.courseStart ? rhythmFeedback(repo)[a.courseStart] : undefined;
  const step = a?.status === 'change' ? planStepFor(repo, a) : null;
  const today = toDateKey(new Date());
  const todayEntry = repo.entryFor(today);
  const todayAssessment = todayEntry ? repo.assessmentFor(todayEntry.id) : null;
  const effect = mode === 'off' ? [] : rhythmEffect(repo);
  const src = activitySource(repo);
  const log = syncLog(repo).slice(0, 6);
  const nights = Object.keys(watchNights(repo)).sort();
  const act = Object.keys(activityDays(repo)).sort();
  const episodes = episodeStarts(repo);

  const fetchProgress = activityProgress(repo);
  const missing = mode === 'off' ? [] : missingActivityDays(repo, today);
  const fetchNow = () => { fetchAllActivity(repo).catch(() => null); };

  // Opening the page is reading the change: the Ny mark on Hem goes away.
  const unread = rhythmCard(repo)?.id ?? null;
  useEffect(() => { if (unread) markRhythmSeen(repo, unread).catch(() => null); }, [repo, unread]);

  const head = a ? rhythmHeadline(a) : null;
  const old = a ? a.date !== today : false;
  const usual = a?.baseline ? `Du brukar somna runt ${a.baseline.onset} och sova ${a.baseline.hours.replace(' h', ' timmar')}.` : null;
  const explanation = !a ? null
    : a.status === 'stable' ? `Dina senaste nätter liknar hur du brukar sova. ${usual ?? ''}${a.singleShort ? ` En natt var kort (${String(a.singleShort.hours).replace('.', ',')} timmar), men en enstaka natt är ingen förändring.` : ''}`.trim()
    : a.status === 'insufficient' ? a.text.change.replace(/^För lite data\. /, '')
    : null;
  const sleepChanges = a?.changes.filter((c) => c.pattern !== 'evening_activity') ?? [];
  const pulseChange = a?.changes.find((c) => c.pattern === 'evening_activity') ?? null;

  if (mode === 'off') {
    return (
      <Screen title="Dygnsrytm">
        <Tag label="Experimentell" />
        <P style={{ marginTop: space.s }}>Jämför dina senaste nätter från klockan med hur du brukar sova, och säger till om något ändras. Du behöver inte skriva något.</P>
        <Card style={{ marginTop: space.m }}><ModeChooser mode={mode} onChange={(m) => setRhythmMode(repo, m)} /></Card>
      </Screen>
    );
  }

  const effectSummary = todayAssessment?.rhythm
    ? `I kväll: ${LEVEL_WORD[todayAssessment.rhythm.withoutRhythm.level]} utan, ${LEVEL_WORD[todayAssessment.rhythm.withRhythm.level]} med`
    : effect.length ? `${effect.length} ${effect.length === 1 ? 'dag' : 'dagar'} skulle få en annan färg` : 'ingen skillnad de senaste 30 dagarna';

  return (
    <Screen title="Dygnsrytm">
      {/* 1. The observation: what the watch shows, and nothing about what it might mean. */}
      <Card>
        <Text style={type.label}>{`Klockan visar · ${old && a ? formatDateSv(a.date) : 'i dag'}`.toUpperCase()}</Text>
        {a && head ? (
          <>
            <Text style={[type.title, { marginTop: space.xs }]} accessibilityRole="header">{head.title}</Text>
            {a.status === 'change' ? (
              <>
                {sleepChanges.map((c) => <P key={c.pattern} style={{ marginTop: space.s }}>{changeSentence(c)}</P>)}
                {pulseChange ? <P style={{ marginTop: space.s }}>{sleepChanges.length ? 'Även den förhöjda pulsen har kommit senare på kvällen.' : 'Mer av dygnets förhöjda puls har kommit sent på kvällen. Siffrorna står under Fördjupning.'}</P> : null}
              </>
            ) : <P style={{ marginTop: space.s }}>{explanation}</P>}
            <P muted style={{ marginTop: space.s }}>{rhythmFreshness(a, repo.garminStatus().lastSyncAt)}. Appen hämtar bara när den är öppen.</P>
          </>
        ) : <P style={{ marginTop: space.s }}>Ingen bedömning ännu. Den görs nästa gång appen hämtar från klockan.</P>}
        <Tag label="Experimentell" />
      </Card>

      {/* 2. One step that is already in the person's plan. */}
      {step ? (
        <Section title={step.heading}>
          <Card tone="accent"><P>{step.text}</P></Card>
        </Section>
      ) : null}

      {/* 3. What it rests on: the nights, then the comparison with earlier periods, kept apart from the observation. */}
      {a && a.status !== 'insufficient' ? (
        <Section title="Dina nätter">
          <Card><NightsChart a={a} /></Card>
        </Section>
      ) : null}

      <SleepPhasesSection />

      <Section title="Jämfört med tidigare perioder">
        <Card>
          {a?.status === 'change' && a.direction ? (
            <>
              <P>{directionText(a.direction)}</P>
              <P muted style={{ marginTop: space.s }}>Likhet betyder inte att en ny period börjar. Det är en jämförelse med hur dina nätter såg ut då, inget mer.</P>
            </>
          ) : (
            <P>
              När något ändras jämför appen med tiden före perioder du själv lagt in. {episodes.length === 0 ? 'Inga är inlagda än, så den kan säga att något ändrats men inte vad det liknar.' : episodes.length === 1 ? 'En period är inlagd.' : `${episodes.length} perioder är inlagda.`}
            </P>
          )}
          <Button kind="secondary" title="Tidigare perioder" onPress={() => nav.push({ name: 'episodes' })} />
        </Card>
      </Section>

      {a?.status === 'change' && a.courseStart ? (
        <Section title="Lägg till sammanhang · frivilligt">
          <Card>
            {feedback ? (
              <>
                <P>Sparat: {feedback.reason}.</P>
                <P muted style={{ marginTop: space.xs }}>Det sparas med förändringen och visas i bedömningen. Det ändrar inte analysen och inte kvällens färg.</P>
                <Button kind="ghost" title="Ångra" onPress={() => undoExplanation(repo, a.courseStart!)} />
              </>
            ) : (
              <>
                <P muted>Vet du något som kan höra ihop med förändringen? Valet sparas bara som en anteckning. Det ändrar inte analysen och inte kvällens färg.</P>
                <Row style={{ gap: 6, marginTop: space.s }}>
                  {REASONS.map((r) => <Chip key={r} label={r} onPress={() => explainCourse(repo, a.courseStart!, r)} />)}
                </Row>
              </>
            )}
          </Card>
        </Section>
      ) : null}

      {/* How it is used, and what that does to the evening's colour: one place. */}
      <Disclosure title="Användning" detail={`${MODE_LABEL[mode]} · ${effectSummary}`}>
        <Card>
          <ModeChooser mode={mode} onChange={(m) => setRhythmMode(repo, m)} />
          <Label>Påverkan på kvällens färg</Label>
          {todayAssessment?.rhythm ? (
            <P>
              I kväll: {LEVEL_WORD[todayAssessment.rhythm.withoutRhythm.level]} utan Dygnsrytm, {LEVEL_WORD[todayAssessment.rhythm.withRhythm.level]} med.
              {todayAssessment.rhythm.used ? ' Den används.' : ' Den används inte.'}
            </P>
          ) : <P>Ingen avstämning i dag. Dygnsrytm påverkar bara dagar med en avstämning.</P>}
          {effect.length ? (
            <>
              <P style={{ marginTop: space.s }}>Dagar de senaste 30 som {mode === 'use' ? 'fick' : 'skulle få'} en annan färg:</P>
              {effect.map((d) => (
                <P key={d.date}>{formatDateSv(d.date)}: {LEVEL_WORD[d.without as Level]} utan, {LEVEL_WORD[d.with as Level]} med{d.direct ? '' : ', genom de gula dagarna före'}.</P>
              ))}
            </>
          ) : <P muted style={{ marginTop: space.xs }}>Ingen dag de senaste 30 skulle få en annan färg.</P>}
          <P muted style={{ marginTop: space.s }}>Dygnsrytm kan göra en dag gul, men aldrig ensam röd, aldrig sänka en färg och aldrig gå före akutregeln. Kort sömn räknas en gång.</P>
        </Card>
      </Disclosure>

      {/* Everything behind the estimate, for the one who wants it. */}
      <Disclosure title="Fördjupning" detail="Puls, klockdata, utvärdering och hur appen räknar">
        <Card>
          <Text style={[type.body, { fontWeight: '600' }]} accessibilityRole="header">Puls på kvällen</Text>
          {pulseChange ? <P style={{ marginTop: space.xs }}>{changeSentence(pulseChange)}</P> : null}
          {a && a.status !== 'insufficient' ? <NightsTable a={a} pulse /> : <P muted>Visas när det finns nätter att jämföra.</P>}
        </Card>

        <Card>
          <Text style={[type.body, { fontWeight: '600' }]} accessibilityRole="header">Klockdata och hämtning</Text>
          <P muted style={{ marginTop: space.xs }}>Sömn från Garmin: insomning och uppvakning på minuten, sömnlängd och tidszon per natt. {nights.length ? `${nights.length} nätter, senast ${formatDateSv(nights[nights.length - 1])}.` : 'Inga nätter ännu.'}</P>
          <P muted style={{ marginTop: space.xs }}>
            Puls över dygnet: värden varannan minut, som appen räknar om till minuter med förhöjd puls per timme. Förhöjd puls kan vara rörelse men också stress eller feber. Själva pulsen sparas inte.{' '}
            {src.status === 'not_exposed' ? src.message : src.status === 'error' ? `Senaste försöket misslyckades: ${src.message}` : act.length ? `${act.length} dagar, senast ${formatDateSv(act[act.length - 1])} till ${activityDays(repo)[act[act.length - 1]].lastReading ?? '–'}.` : 'Ingen hämtad ännu.'}
          </P>
          {fetchProgress?.running ? (
            <P style={{ marginTop: space.xs }}>Hämtar puls för tidigare dagar: {fetchProgress.done} av {fetchProgress.total}. Det sker av sig självt när appen är öppen och fortsätter där det slutade.</P>
          ) : missing.length ? (
            <>
              <P style={{ marginTop: space.xs }}>{missing.length} dagar med sömn saknar puls. De hämtas av sig själva när appen är öppen.{fetchProgress?.error ? ` ${fetchProgress.error}` : ''}</P>
              <Button kind="ghost" title="Hämta nu" onPress={fetchNow} />
            </>
          ) : null}
          <Label>Hämtningar</Label>
          {log.length ? log.map((l) => (
            <P key={l.at}>{formatDateSv(l.at.slice(0, 10))} {formatTime(l.at)}: {l.ok ? 'lyckades' : 'misslyckades'}, {TRIGGER[l.trigger] ?? l.trigger}{l.heartRateDays ? `, ${l.heartRateDays} dagar puls` : ''}.</P>
          )) : <P muted>Inga hämtningar sparade ännu.</P>}
          <P muted style={{ marginTop: space.xs }}>Appen kan inte hämta när den är stängd. Varje hämtning ovan gjordes med appen öppen.</P>
        </Card>

        <Card>
          <Text style={[type.body, { fontWeight: '600' }]} accessibilityRole="header">Utvärdering</Text>
          <P muted style={{ marginTop: space.xs }}>Hade Dygnsrytm sagt till i tid förut? Spelar upp din historik dag för dag med bara det som fanns då, och jämför med sömnnotisen. Kräver inlagda tidigare perioder för att säga något om träffsäkerheten.</P>
          <Button kind="secondary" title="Utvärdera på mina data" onPress={() => setEv(evaluateOwnData(repo))} />
          <Button kind="ghost" title="Visa ett simulerat exempel" onPress={() => { const y = simulatedYear(today); setEv(evaluateRhythm(y.data, { to: today, simulated: true })); }} />
          {ev ? <EvaluationView ev={ev} onAddEpisode={() => nav.push({ name: 'episodes' })} /> : null}
        </Card>

        <Card>
          <Text style={[type.body, { fontWeight: '600' }]} accessibilityRole="header">Så räknar appen</Text>
          <P style={{ marginTop: space.xs }}>Dygnsrytm är experimentell. Den prövar idén att en förändring i sömn och dygnsrytm kan komma några dygn före en ny period, men det är inte visat att den fungerar för dig.</P>
          <P style={{ marginTop: space.xs }}>Den jämför de tre senaste nätterna med dina egna nätter 8–63 dagar bakåt. Den senaste veckan är inte med, så att en långsam förskjutning inte blir det nya vanliga. Det krävs minst 14 nätter.</P>
          <P style={{ marginTop: space.xs }}>En natt utan data hoppas över. Saknas två av de fyra senaste nätterna blir svaret ”för lite data”. Efter ett tidszonsbyte jämförs inte de tre första nätterna.</P>
          <P style={{ marginTop: space.xs }}>En enstaka kort natt är ingen förändring. En förändring kräver tre nätter i rad. Pulsen räknas bara för dygn då klockan burits minst 70 % av tiden.</P>
          <P style={{ marginTop: space.xs }}>Missade avstämningar används aldrig, och inte heller appens färger.</P>
          <Eyebrow style={{ marginTop: space.m }}>{`Regler ${a?.rulesVersion ?? ''}`.trim()}</Eyebrow>
        </Card>
      </Disclosure>
    </Screen>
  );
}
