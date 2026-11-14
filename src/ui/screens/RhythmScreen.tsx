// Klockans rytm (experimental): the passive estimate from the watch, in two separate answers
// (what changed, and whether the person's own history supports a direction), the nights behind
// it, a step that is already in the plan, an optional correction, the level with and without the
// signal, the data sources and how fresh they are, and the evaluation on the person's own data.
// The rated mood, this estimate and documented episode starts are kept apart, here and in storage.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { addDays, formatDateSv, formatDateSvYear, formatTime, toDateKey } from '../../core/analysis/dates';
import { LEVEL_WORD } from '../../core/analysis/levelWords';
import { changeSentence, clockOfAxis, eveningOf, nightsFrom, PATTERN_WORD, type RhythmAssessment, type RhythmMode } from '../../core/analysis/rhythm';
import { evaluateRhythm, METHOD_NAME, MIN_EPISODES_FOR_RATE, rate, type RhythmEvaluation } from '../../core/analysis/rhythmEval';
import { simulatedYear } from '../../core/analysis/rhythmSim';
import type { DateKey, Level } from '../../core/domain/types';
import {
  activityDays, activityProgress, activitySource, episodeStarts, fetchAllActivity, missingActivityDays, evaluateOwnData, explainCourse, latestRhythm, planStepFor,
  rhythmEffect, rhythmFeedback, rhythmMode, setRhythmMode, syncLog, undoExplanation, updateRhythm, watchNights,
} from '../../services/rhythm';
import { Button, Card, Chip, Disclosure, Eyebrow, P, Row, Screen, Section, Segmented, Tag } from '../components';
import { useNav } from '../nav';
import { useRepo } from '../state';
import { colors, space, type } from '../theme';

const MODE_TEXT: Record<RhythmMode, string> = {
  off: 'Av. Inget beräknas.',
  show: 'Visas, men påverkar aldrig nivån.',
  use: 'Används i din bedömning: en förändring med stöd för en riktning ger 1 poäng.',
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
        <Text style={[type.small, cell]}>Kväll</Text>
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
      <P muted style={{ marginTop: space.xs }}>Fet stil: nätterna bedömningen bygger på. Kväll: andel av dagens aktiva minuter efter 21, ur pulsen.</P>
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
                  {known ? 'Falsklarm' : 'Larm'}: {rate(m.falseAlarms, m.judgedStableDays)}{known ? ', räknat på dagar utanför episoder' : ''}. Avstod: {m.abstainDays} av {m.days} dagar.
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
          <Label>{`Modellens larm, sömn och aktivitet (${alarms.length})`}</Label>
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
  const [busy, setBusy] = useState(false);
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

  const recompute = async () => {
    setBusy(true);
    try { await updateRhythm(repo); } finally { setBusy(false); }
  };
  const fetchProgress = activityProgress(repo);
  const missing = mode === 'off' ? [] : missingActivityDays(repo, today);
  const fetchNow = () => { fetchAllActivity(repo).catch(() => null); };

  return (
    <Screen title="Klockans rytm">
      <Row style={{ gap: space.s, alignItems: 'center' }}>
        <Tag label="Experimentell" />
      </Row>
      <P style={{ marginTop: space.s }}>
        Letar efter tidiga tecken i sömn och dygnsrytm från klockan, utan anteckning och utan avstämning. Hypotesen som prövas är en möjlig episodstart inom tre dygn.
      </P>
      <Segmented<RhythmMode>
        label="Klockans rytm"
        options={[{ value: 'off', label: 'Av' }, { value: 'show', label: 'Visa' }, { value: 'use', label: 'Använd' }]}
        value={mode}
        onChange={(m) => setRhythmMode(repo, m)}
      />
      <P muted style={{ marginTop: space.xs }}>{MODE_TEXT[mode]}</P>

      {mode !== 'off' ? (
        <>
          <Section title="Senaste bedömningen">
            <Card>
              {a ? (
                <>
                  <P>{formatDateSv(a.date)}, beräknad {formatTime(a.computedAt)}. Nätterna {formatDateSv(a.covers.from)} – {formatDateSv(a.covers.to)}.</P>
                  <P muted style={{ marginTop: space.xs }}>Beräknas efter varje hämtning från Garmin och när du öppnar appen. Appen kan inte hämta när den är stängd.</P>
                </>
              ) : <P>Ingen bedömning ännu.</P>}
              <Button kind="ghost" title="Beräkna nu" busy={busy} onPress={recompute} />
            </Card>
          </Section>

          {a ? (
            <>
              <Section title="Vad som har förändrats">
                <Card tone={a.status === 'change' ? 'yellow' : undefined}>
                  {a.status === 'change' ? a.changes.map((c) => <P key={c.pattern} style={{ marginBottom: space.xs }}>{changeSentence(c)}</P>) : <P>{a.text.change}</P>}
                  {a.status !== 'insufficient' && !a.activityUsed ? <P muted style={{ marginTop: space.xs }}>Kvällsaktiviteten ingår inte: {a.activityAvailable ? 'för få kvällar med klockan på' : 'ingen puls hämtad'}.</P> : null}
                </Card>
              </Section>

              {a.direction ? (
                <Section title="Riktning, ur din historik">
                  <Card>
                    <P>{a.text.direction}</P>
                    {a.direction.matches.length ? (
                      <>
                        <Label>Tidigare episoder med samma mönster</Label>
                        {a.direction.matches.map((m) => (
                          <P key={m.episodeId}>{{ up: 'Uppvarvad', down: 'Nedstämd', mixed: 'Blandad' }[m.type]} från {formatDateSv(m.start)} ({m.source === 'clinical' ? 'klinisk bedömning' : 'du i efterhand'}): mönstret syntes {m.days.length === 1 ? 'en dag' : `${m.days.length} dagar`} före.</P>
                        ))}
                      </>
                    ) : null}
                    <Label>Stabila perioder</Label>
                    <P>
                      {a.direction.stableRuns.length
                        ? `Samma mönster ${a.direction.stableRuns.length === 1 ? 'en gång' : `${a.direction.stableRuns.length} gånger`}: ${a.direction.stableRuns.map((r) => (r.from === r.to ? formatDateSv(r.from) : `${formatDateSv(r.from)} – ${formatDateSv(r.to)}`)).join(', ')}.`
                        : 'Inte under någon stabil period.'}
                      {' '}{a.direction.stableDaysJudged} stabila dagar gick att bedöma.
                    </P>
                    <P muted style={{ marginTop: space.xs }}>Ingen procentsats: det finns inget som visar att en sådan siffra skulle stämma.</P>
                  </Card>
                </Section>
              ) : null}

              <Section title="Nätterna">
                <Card><NightsTable a={a} /></Card>
              </Section>

              {a.status === 'change' && step ? (
                <Section title={step.heading}>
                  <Card tone="accent"><P>{step.text}</P></Card>
                </Section>
              ) : null}

              {a.status === 'change' && a.courseStart ? (
                <Section title="Finns en annan förklaring?">
                  <Card>
                    {feedback ? (
                      <>
                        <P>Du angav: {feedback.reason}. Förloppet räknas inte i nivån.</P>
                        <Button kind="ghost" title="Ångra" onPress={() => undoExplanation(repo, a.courseStart!)} />
                      </>
                    ) : (
                      <>
                        <P muted>Frivilligt. Bedömningen fungerar utan svar.</P>
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

          <Section title="Påverkan på ampeln">
            <Card>
              {todayAssessment?.rhythm ? (
                <P>
                  I kväll: {LEVEL_WORD[todayAssessment.rhythm.withoutRhythm.level]} utan signalen, {LEVEL_WORD[todayAssessment.rhythm.withRhythm.level]} med den.
                  {todayAssessment.rhythm.used ? ' Signalen används.' : ' Signalen används inte.'}
                </P>
              ) : <P>Ingen avstämning i dag. Signalen påverkar bara dagar med en bedömning.</P>}
              {effect.length ? (
                <>
                  <Label>Dagar som skulle få en annan nivå</Label>
                  {effect.map((d) => (
                    <P key={d.date}>{formatDateSv(d.date)}: {LEVEL_WORD[d.without as Level]} utan, {LEVEL_WORD[d.with as Level]} med{d.direct ? '' : ', genom de gula dagarna före'}.</P>
                  ))}
                </>
              ) : <P muted style={{ marginTop: space.xs }}>Ingen av de senaste 30 dagarna får en annan nivå med signalen.</P>}
              <P muted style={{ marginTop: space.s }}>Signalen kan höja en dag, men aldrig ensam ge rött, sänka en varning eller gå före akutregeln. Kort sömn räknas en gång.</P>
            </Card>
          </Section>

          <Section title="Datakällor">
            <Card>
              <Text style={[type.body, { fontWeight: '600' }]}>Sömn från Garmin</Text>
              <P muted>Insomning och uppvakning på minuten, sömnlängd och tidszon per natt. {nights.length ? `${nights.length} nätter, senast ${formatDateSv(nights[nights.length - 1])}.` : 'Inga nätter ännu.'}</P>
              <Text style={[type.body, { fontWeight: '600', marginTop: space.s }]}>Puls över dygnet</Text>
              <P muted>
                Värden varannan minut, som appen räknar om till aktiva minuter per timme. Själva pulsen sparas inte.{' '}
                {src.status === 'not_exposed' ? src.message : src.status === 'error' ? `Senaste försöket misslyckades: ${src.message}` : act.length ? `${act.length} dagar, senast ${formatDateSv(act[act.length - 1])} till ${activityDays(repo)[act[act.length - 1]].lastReading ?? '–'}.` : 'Ingen hämtad ännu.'}
              </P>
              <Text style={[type.body, { fontWeight: '600', marginTop: space.s }]}>Används inte</Text>
              <P muted>Steg finns bara som dagssumma. Stress och Body Battery ingår inte i rytmmodellen.</P>
              <Label>Hämtningar</Label>
              {log.length ? log.map((l) => (
                <P key={l.at}>{formatDateSv(l.at.slice(0, 10))} {formatTime(l.at)}: {l.ok ? 'lyckades' : 'misslyckades'}, {TRIGGER[l.trigger] ?? l.trigger}{l.inFront ? ', appen öppen' : ', appen i bakgrunden'}{l.heartRateDays ? `, ${l.heartRateDays} dagar puls` : ''}.</P>
              )) : <P muted>Inga hämtningar sparade ännu.</P>}
              <P muted style={{ marginTop: space.xs }}>Hämtning när appen är stängd: nej. Varje hämtning ovan gjordes med appen öppen.</P>
              <Label>Äldre puls</Label>
              {fetchProgress?.running ? (
                <P>Hämtar puls för tidigare dagar: {fetchProgress.done} av {fetchProgress.total}. Det sker av sig självt när appen är öppen, på vilken skärm som helst, och fortsätter där det slutade.</P>
              ) : missing.length ? (
                <>
                  <P>{missing.length} dagar med sömn saknar puls. De hämtas av sig själva när appen är öppen, ungefär en dag i sekunden.{fetchProgress?.error ? ` ${fetchProgress.error}` : ''}</P>
                  <Button kind="ghost" title="Hämta nu" onPress={fetchNow} />
                </>
              ) : <P muted>Puls finns för alla dagar med sömn som Garmin har puls för.</P>}
            </Card>
          </Section>

          <Section title="Episodstarter">
            <Card>
              <P>{episodes.length ? `${episodes.length} dokumenterade.` : 'Inga dokumenterade ännu.'} De används som jämförelse och facit, aldrig appens färger.</P>
              <Button kind="secondary" title="Visa och lägg till" onPress={() => nav.push({ name: 'episodes' })} />
            </Card>
          </Section>

          <Section title="Utvärdering">
            <Card>
              <P muted>Spelar upp historiken dag för dag med bara det som fanns då, och jämför sömnnotisen, modellen med bara sömn och modellen med sömn och aktivitet.</P>
              <Button kind="secondary" title="Utvärdera på mina data" onPress={() => setEv(evaluateOwnData(repo))} />
              <Button kind="ghost" title="Visa ett simulerat exempel" onPress={() => { const y = simulatedYear(today); setEv(evaluateRhythm(y.data, { to: today, simulated: true })); }} />
              {ev ? <EvaluationView ev={ev} onAddEpisode={() => nav.push({ name: 'episodes' })} /> : null}
            </Card>
          </Section>

          <Disclosure title="Så fungerar modellen">
            <P>Jämförelsen gäller de tre senaste nätterna med sömn från klockan, mot dina egna nätter 8–63 dagar bakåt. Den senaste veckan är inte med i jämförelsen, så att en långsam förskjutning inte blir det nya vanliga.</P>
            <P style={{ marginTop: space.xs }}>Det vanliga är medianen, och spridningen räknas så att enstaka udda nätter inte styr. Det krävs minst 14 nätter. Nätter under dokumenterade episoder räknas inte.</P>
            <P style={{ marginTop: space.xs }}>En natt utan data hoppas över. Saknas två av de fyra senaste nätterna blir svaret ”för lite data”. Efter ett tidszonsbyte jämförs inte de tre första nätterna.</P>
            <P style={{ marginTop: space.xs }}>En enstaka kort natt är ingen förändring. En förändring kräver tre nätter i rad. Kvällsaktivitet räknas bara för dygn då klockan burits minst 70 % av tiden.</P>
            <P style={{ marginTop: space.xs }}>Missade avstämningar används aldrig, och inte heller appens färger.</P>
          </Disclosure>
        </>
      ) : null}
      <Eyebrow style={{ marginTop: space.l }}>{`Regler ${a?.rulesVersion ?? ''}`.trim()}</Eyebrow>
    </Screen>
  );
}
