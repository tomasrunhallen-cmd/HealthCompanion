// Dygnsrytm (experimental): the passive estimate from the watch, in two separate answers
// (what changed, and whether the person's own history supports a direction), the nights behind
// it, a step that is already in the plan, an optional correction, the level with and without the
// signal, the data sources and how fresh they are, and the evaluation on the person's own data.
// The rated mood, this estimate and documented episode starts are kept apart, here and in storage.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { addDays, formatDateSv, formatDateSvYear, formatTime, toDateKey } from '../../core/analysis/dates';
import { LEVEL_WORD } from '../../core/analysis/levelWords';
import { changeSentence, clockOfAxis, eveningOf, nightsFrom, PATTERN_WORD, type RhythmAssessment, type RhythmMode } from '../../core/analysis/rhythm';
import { assumptions, evaluateRhythm, METHOD_NAME, MIN_EPISODES_FOR_RATE, rate, type RhythmEvaluation } from '../../core/analysis/rhythmEval';
import { simulatedYear } from '../../core/analysis/rhythmSim';
import type { DateKey, Level } from '../../core/domain/types';
import {
  activityDays, activityProgress, activitySource, episodeStarts, fetchAllActivity, missingActivityDays, evaluateOwnData, explainCourse, latestRhythm, planStepFor,
  rhythmEffect, rhythmFeedback, rhythmMode, setRhythmMode, syncLog, undoExplanation, watchNights,
} from '../../services/rhythm';
import { Button, Card, Chip, Disclosure, Eyebrow, P, Row, Screen, Section, Segmented, Tag } from '../components';
import { rhythmHeadline } from '../RhythmToday';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, space, type } from '../theme';

const MODE_LABEL: Record<RhythmMode, string> = { off: 'Av', show: 'Visa', use: 'Använd' };
const MODE_TEXT: Record<RhythmMode, string> = {
  off: 'appen tittar inte på klockans sömn och puls.',
  show: 'du ser vad klockan visar, men det påverkar aldrig kvällens färg.',
  use: 'en tydlig förändring som liknar en tidigare period kan göra kvällens färg gul, aldrig röd på egen hand.',
};

const TRIGGER: Record<string, string> = { open: 'appen öppnades', checkin: 'avstämning', manual: 'Hämta igen', connect: 'anslutning' };
const REASONS = ['Resa', 'Sjuk', 'Fest eller gäster', 'Arbete', 'Annat'];

const MONTH = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const shortDate = (d: DateKey) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]}`;

function Label({ children }: { children: string }) {
  return <Text style={[type.label, { marginTop: space.m, marginBottom: space.xs }]} accessibilityRole="header">{children.toUpperCase()}</Text>;
}

/** The latest nights against the usual: the night's values, with the window marked. */
function NightsTable({ a }: { a: RhythmAssessment }) {
  const repo = useRepo();
  const nights = nightsFrom(watchNights(repo), addDays(a.date, -6), a.date);
  const act = activityDays(repo);
  const inWindow = (d: DateKey) => d >= a.covers.from && d <= a.covers.to;
  const cell = { flex: 1, textAlign: 'right' as const };
  return (
    <View accessibilityLabel="De senaste sju nätterna mot det vanliga">
      <Row style={{ paddingVertical: space.xs, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={[type.small, { flex: 1.3 }]}>Natten till</Text>
        <Text style={[type.small, cell]}>Somnade</Text>
        <Text style={[type.small, cell]}>Sov</Text>
        <Text style={[type.small, cell]}>Puls kväll</Text>
      </Row>
      {a.baseline ? (
        <Row style={{ paddingVertical: space.xs }}>
          <Text style={[type.small, { flex: 1.3, fontStyle: 'italic' }]}>Vanligt</Text>
          <Text style={[type.small, cell]}>{a.baseline.onset}</Text>
          <Text style={[type.small, cell]}>{a.baseline.hours}</Text>
          <Text style={[type.small, cell]}>{a.baseline.late ?? '–'}</Text>
        </Row>
      ) : null}
      {nights.map((n) => {
        const e = eveningOf(act, n.date);
        const strong = inWindow(n.date);
        const t = [type.body, cell, strong && { fontWeight: '600' as const }];
        return (
          <Row key={n.date} style={{ paddingVertical: space.xs, borderTopWidth: 1, borderColor: colors.border }}>
            <Text style={[type.body, { flex: 1.3 }, strong && { fontWeight: '600' as const }]}>{shortDate(n.date)}</Text>
            {n.excluded ? (
              <Text style={[type.small, { flex: 3, textAlign: 'right' }]}>
                {n.excluded === 'missing' ? 'Ingen sömn från klockan' : n.excluded === 'timezone' ? 'Tidszonsbyte, jämförs inte' : 'Sov på dagen'}
              </Text>
            ) : (
              <>
                <Text style={t}>{clockOfAxis(n.onset!)}</Text>
                <Text style={t}>{String(n.hours).replace('.', ',')} h</Text>
                <Text style={t}>{e.late != null ? `${Math.round(e.late * 100)} %` : '–'}</Text>
              </>
            )}
          </Row>
        );
      })}
      <P muted style={{ marginTop: space.xs }}>Fet stil: nätterna bedömningen bygger på. Puls kväll: andel av dygnets minuter med förhöjd puls (minst 25 slag över vilopuls) som kom efter 21. Det är en uppskattning ur pulsen, inte ett mått på rörelse.</P>
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
        {' '}Episodstarter: {ev.episodes.total} ({ev.episodes.bySource.self_retro} angivna i efterhand, {ev.episodes.bySource.clinical} från klinisk bedömning).
      </P>
      <P muted style={{ marginTop: space.xs }}>{assumptions(ev)}</P>
      {!known ? (
        <Card tone="accent" style={{ marginTop: space.s }}>
          <P>Utan dokumenterade episodstarter går det inte att säga om ett larm var rätt eller fel, eller om något fångades i förväg. Det som går att läsa är hur ofta varje metod larmar och hur ofta den avstår.</P>
          <Button kind="secondary" title="Lägg in episodstarter" onPress={onAddEpisode} />
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
            ? <P muted>För få dokumenterade episoder i den här delen för att säga hur ofta starter fångas.</P>
            : null}
        </View>
      ))}
      {alarms.length ? (
        <View>
          <Label>{`Modellens larm, sömn och puls (${alarms.length})`}</Label>
          <P muted>Minns du om en period började något av de här dygnen eller strax efter? Lägg då in starten. Det är så modellen kan prövas.</P>
          {(all ? alarms : alarms.slice(0, 8)).map((r) => (
            <P key={r.from} style={{ marginTop: space.xs }}>
              {r.from === r.to ? formatDateSvYear(r.from) : `${formatDateSvYear(r.from)} – ${formatDateSvYear(r.to)}`}: {r.patterns.map((x) => PATTERN_WORD[x]).join(', ') || 'förändring'}{r.startFollowed ? '. En dokumenterad start följde.' : ''}
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
  const step = a ? planStepFor(repo, a) : null;
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

  const head = a ? rhythmHeadline(a) : null;
  const lastSync = repo.garminStatus().lastSyncAt;
  const old = a ? a.date !== today : false;
  // In plain words: what the latest nights looked like against the usual, for a stable answer.
  const usual = a?.baseline ? `Du brukar somna runt ${a.baseline.onset} och sova ${a.baseline.hours.replace(' h', ' timmar')}.` : null;
  const explanation = !a ? null
    : a.status === 'stable' ? `Dina senaste nätter liknar hur du brukar sova. ${usual ?? ''}${a.singleShort ? ` En natt var kort (${String(a.singleShort.hours).replace('.', ',')} timmar), men en enstaka natt är ingen förändring.` : ''}`.trim()
    : a.status === 'insufficient' ? a.text.change.replace(/^För lite data\. /, '')
    : null;

  const modeChooser = (
    <>
      <Segmented<RhythmMode>
        label="Hur Dygnsrytm används"
        options={[{ value: 'off', label: 'Av' }, { value: 'show', label: 'Visa' }, { value: 'use', label: 'Använd' }]}
        value={mode}
        onChange={(m) => setRhythmMode(repo, m)}
      />
      {(['off', 'show', 'use'] as RhythmMode[]).map((m) => (
        <P key={m} muted={m !== mode} style={{ marginTop: space.xs }}>
          <Text style={{ fontWeight: m === mode ? '600' : '400' }}>{MODE_LABEL[m]}: </Text>{MODE_TEXT[m]}
        </P>
      ))}
    </>
  );

  if (mode === 'off') {
    return (
      <Screen title="Dygnsrytm">
        <Tag label="Experimentell" />
        <P style={{ marginTop: space.s }}>Jämför dina senaste nätter från klockan med hur du brukar sova, och säger till om något ändras. Du behöver inte skriva något.</P>
        <Card style={{ marginTop: space.m }}>{modeChooser}</Card>
      </Screen>
    );
  }

  return (
    <Screen title="Dygnsrytm">
      {/* The answer first, in plain words; everything else is folded below. */}
      <Card>
        <Text style={type.label}>{old && a ? formatDateSv(a.date).toUpperCase() : 'I DAG'}</Text>
        {a && head ? (
          <>
            <Text style={[type.title, { marginTop: space.xs }]} accessibilityRole="header">{a.status === 'change' ? 'Förändring' : head.title}</Text>
            {a.status === 'change'
              ? a.changes.map((c) => <P key={c.pattern} style={{ marginTop: space.s }}>{changeSentence(c)}</P>)
              : <P style={{ marginTop: space.s }}>{explanation}</P>}
            <P muted style={{ marginTop: space.s }}>
              Bygger på nätterna {a.covers.from.slice(0, 7) === a.covers.to.slice(0, 7) ? `${Number(a.covers.from.slice(8, 10))}–${shortDate(a.covers.to)}` : `${shortDate(a.covers.from)}–${shortDate(a.covers.to)}`}.{lastSync ? ` Klockans data hämtades senast ${toDateKey(new Date(lastSync)) === today ? `i dag ${formatTime(lastSync)}` : `${shortDate(toDateKey(new Date(lastSync)))} ${formatTime(lastSync)}`}.` : ''} Appen hämtar bara när den är öppen.
            </P>
          </>
        ) : <P style={{ marginTop: space.s }}>Ingen bedömning ännu. Den görs nästa gång appen hämtar från klockan.</P>}
        <Tag label="Experimentell" />
      </Card>

      {a?.status === 'change' ? (
        <>
          {a.direction ? (
            <Section title="Liknar det något tidigare?">
              <Card><P>{a.text.direction}</P></Card>
            </Section>
          ) : null}
          {step ? (
            <Section title={step.heading}>
              <Card tone="accent"><P>{step.text}</P></Card>
            </Section>
          ) : null}
          {a.courseStart ? (
            <Section title="Finns en annan förklaring?">
              <Card>
                {feedback ? (
                  <>
                    <P>Du angav: {feedback.reason}. Den här förändringen räknas inte i kvällens färg.</P>
                    <Button kind="ghost" title="Ångra" onPress={() => undoExplanation(repo, a.courseStart!)} />
                  </>
                ) : (
                  <>
                    <P muted>Frivilligt. Det fungerar utan svar.</P>
                    <Row style={{ gap: 6, marginTop: space.s }}>
                      {REASONS.map((r) => <Chip key={r} label={r} onPress={() => explainCourse(repo, a.courseStart!, r)} />)}
                    </Row>
                  </>
                )}
              </Card>
            </Section>
          ) : null}
        </>
      ) : null}

      {a && a.status !== 'insufficient' ? (
        <Section title="Dina nätter">
          <Card><NightsTable a={a} /></Card>
        </Section>
      ) : null}

      <Disclosure title="Inställning" detail={`${MODE_LABEL[mode]}: ${MODE_TEXT[mode]}`}>
        <Card>{modeChooser}</Card>
      </Disclosure>

      <Disclosure title="Påverkan på kvällens färg" detail={todayAssessment?.rhythm ? `I kväll: ${LEVEL_WORD[todayAssessment.rhythm.withoutRhythm.level]} utan, ${LEVEL_WORD[todayAssessment.rhythm.withRhythm.level]} med` : effect.length ? `${effect.length} dagar skulle få en annan färg` : 'Ingen skillnad de senaste 30 dagarna'}>
        <Card>
          {todayAssessment?.rhythm ? (
            <P>
              I kväll: {LEVEL_WORD[todayAssessment.rhythm.withoutRhythm.level]} utan Dygnsrytm, {LEVEL_WORD[todayAssessment.rhythm.withRhythm.level]} med.
              {todayAssessment.rhythm.used ? ' Den används.' : ' Den används inte.'}
            </P>
          ) : <P>Ingen avstämning i dag. Dygnsrytm påverkar bara dagar med en avstämning.</P>}
          {effect.length ? (
            <>
              <Label>Dagar som skulle få en annan färg</Label>
              {effect.map((d) => (
                <P key={d.date}>{formatDateSv(d.date)}: {LEVEL_WORD[d.without as Level]} utan, {LEVEL_WORD[d.with as Level]} med{d.direct ? '' : ', genom de gula dagarna före'}.</P>
              ))}
            </>
          ) : null}
          <P muted style={{ marginTop: space.s }}>Dygnsrytm kan göra en dag gul, men aldrig ensam röd, aldrig sänka en färg och aldrig gå före akutregeln. Kort sömn räknas en gång.</P>
        </Card>
      </Disclosure>

      <Disclosure title="Tidigare perioder" detail={episodes.length === 1 ? 'En dokumenterad episodstart' : episodes.length ? `${episodes.length} dokumenterade episodstarter` : 'Inga dokumenterade än'}>
        <Card>
          <P>Dygnsrytm jämför med perioder du själv dokumenterat. Utan dem kan den säga att något ändrats, men inte åt vilket håll.</P>
          {a?.direction ? (
            <>
              {a.direction.matches.length ? (
                <>
                  <Label>Samma mönster före</Label>
                  {a.direction.matches.map((m) => (
                    <P key={m.episodeId}>{{ up: 'Uppvarvad', down: 'Nedstämd', mixed: 'Blandad' }[m.type]} period från {formatDateSv(m.start)} ({m.source === 'clinical' ? 'klinisk bedömning' : 'du i efterhand'}).</P>
                  ))}
                </>
              ) : null}
              <Label>Under lugna perioder</Label>
              <P>
                {a.direction.stableRuns.length
                  ? `Samma mönster ${a.direction.stableRuns.length === 1 ? 'en gång' : `${a.direction.stableRuns.length} gånger`}: ${a.direction.stableRuns.map((r) => (r.from === r.to ? formatDateSv(r.from) : `${formatDateSv(r.from)} – ${formatDateSv(r.to)}`)).join(', ')}.`
                  : 'Inte under någon lugn period.'}
              </P>
            </>
          ) : null}
          <Button kind="secondary" title="Episodstarter" onPress={() => nav.push({ name: 'episodes' })} />
        </Card>
      </Disclosure>

      <Disclosure title="Klockdata och hämtning" detail={fetchProgress?.running ? `Hämtar puls: ${fetchProgress.done} av ${fetchProgress.total}` : `${nights.length} nätter, ${act.length} dagar med puls`}>
        <Card>
          <Text style={[type.body, { fontWeight: '600' }]}>Sömn från Garmin</Text>
          <P muted>Insomning och uppvakning på minuten, sömnlängd och tidszon per natt. {nights.length ? `${nights.length} nätter, senast ${formatDateSv(nights[nights.length - 1])}.` : 'Inga nätter ännu.'}</P>
          <Text style={[type.body, { fontWeight: '600', marginTop: space.s }]}>Puls över dygnet</Text>
          <P muted>
            Värden varannan minut, som appen räknar om till minuter med förhöjd puls per timme. Förhöjd puls kan vara rörelse men också stress eller feber. Själva pulsen sparas inte.{' '}
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
      </Disclosure>

      <Disclosure title="Utvärdering" detail="Hade Dygnsrytm varnat i tid förut?">
        <Card>
          <P muted>Spelar upp din historik dag för dag med bara det som fanns då, och jämför med sömnnotisen. Kräver dokumenterade episodstarter för att säga något om träffsäkerheten.</P>
          <Button kind="secondary" title="Utvärdera på mina data" onPress={() => setEv(evaluateOwnData(repo))} />
          <Button kind="ghost" title="Visa ett simulerat exempel" onPress={() => { const y = simulatedYear(today); setEv(evaluateRhythm(y.data, { to: today, simulated: true })); }} />
          {ev ? <EvaluationView ev={ev} onAddEpisode={() => nav.push({ name: 'episodes' })} /> : null}
        </Card>
      </Disclosure>

      <Disclosure title="Så fungerar det">
        <P>Dygnsrytm är experimentell. Den prövar idén att en förändring i sömn och dygnsrytm kan komma några dygn före en ny period, men det är inte visat att den fungerar för dig.</P>
        <P style={{ marginTop: space.xs }}>Den jämför de tre senaste nätterna med dina egna nätter 8–63 dagar bakåt. Den senaste veckan är inte med, så att en långsam förskjutning inte blir det nya vanliga. Det krävs minst 14 nätter.</P>
        <P style={{ marginTop: space.xs }}>En natt utan data hoppas över. Saknas två av de fyra senaste nätterna blir svaret ”för lite data”. Efter ett tidszonsbyte jämförs inte de tre första nätterna.</P>
        <P style={{ marginTop: space.xs }}>En enstaka kort natt är ingen förändring. En förändring kräver tre nätter i rad. Pulsen räknas bara för dygn då klockan burits minst 70 % av tiden.</P>
        <P style={{ marginTop: space.xs }}>Missade avstämningar används aldrig, och inte heller appens färger.</P>
        <Eyebrow style={{ marginTop: space.m }}>{`Regler ${a?.rulesVersion ?? ''}`.trim()}</Eyebrow>
      </Disclosure>
    </Screen>
  );
}
