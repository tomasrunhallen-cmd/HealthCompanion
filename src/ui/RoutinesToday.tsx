// "Rutiner i dag": the plan's daily routines, and its routines at early signs while the person
// follows them, ticked off during the day. Every tap is saved at once for today. Ticking off
// never changes the level. On Hem the day's suggestion comes first (services/daySuggestion.ts),
// and routines not planned today, or with the week's goal reached, are left out.

import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { addDays, eveningDateKey, formatDateSv } from '../core/analysis/dates';
import type { ContextEntry } from '../core/domain/types';
import { polarityWord } from '../core/plan/fields';
import { signDirection } from '../core/plan/guidance';
import { routineLog, routinesToday } from '../core/plan/routines';
import { setRoutineDone } from '../services/routines';
import { routineStatuses } from '../core/plan/routineFrequency';
import type { DaySuggestion } from '../core/plan/daySuggestion';
import { daySuggestion, makeDaySuggestion } from '../services/daySuggestion';
import { Button, Card, P, Row, Tag } from './components';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

export function RoutineRow({ r, done, onSet, detail }: { r: ContextEntry; done: boolean | undefined; onSet: (v: boolean | null) => void; detail?: string }) {
  const on = done === true;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={detail ? `${r.text}. ${detail}` : r.text}
      onPress={() => onSet(on ? null : true)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TOUCH, paddingVertical: space.xs }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.green, backgroundColor: on ? colors.green : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.body}>{r.text}</Text>
        {detail ? <Text style={type.small}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The direction the latest assessment, today or yesterday, pointed in. */
function recentDirection(repo: ReturnType<typeof useRepo>, today: string): 'up' | 'down' | null {
  const latest = [...repo.assessments()].reverse().find((a) => a.date >= addDays(today, -1));
  if (!latest || latest.level === 'green') return null;
  const dir = signDirection(latest.signals, repo.plan());
  return dir === 'up' || dir === 'down' ? dir : null;
}

/** In the check-in at most this many daily routines show at first; the rest one tap away. */
const COMPACT_MAX = 5;

export function RoutinesToday({ compact = false }: { compact?: boolean }) {
  const repo = useRepo();
  const [showAll, setShowAll] = useState(false);
  const today = eveningDateKey(new Date());
  const mode = repo.settings().planMode ?? null;
  const entries = repo.contextEntries();
  const { daily, extra } = routinesToday(entries, mode);
  const log = routineLog(repo.contextEntries('dagligt'), today);
  const all = [...daily, ...extra];
  const ps = repo.planSettings();
  const hasUp = repo.contextOf('routine').some((e) => e.plan?.polarity === 'up');
  const hasDown = repo.contextOf('routine').some((e) => e.plan?.polarity === 'down');
  const suggested = mode ? null : recentDirection(repo, today);
  if (!all.length && !hasUp && !hasDown) return null;

  // Hem: the day's suggestion first, then the other routines due today.
  const [suggestion, setSuggestion] = useState<DaySuggestion | null>(() => (compact ? null : daySuggestion(repo)));
  useEffect(() => {
    if (compact || suggestion?.date === today) return;
    let live = true;
    makeDaySuggestion(repo, { browser: Platform.OS === 'web' }).then((s) => live && setSuggestion(s)).catch(() => undefined);
    return () => { live = false; };
  }, [repo, compact, today, suggestion?.date]);
  const statuses = compact ? [] : routineStatuses(entries, today);
  const status = new Map(statuses.map((st) => [st.routine.id, st]));
  const picked = (suggestion?.date === today ? suggestion.items : [])
    .map((i) => ({ ...i, r: daily.find((d) => d.id === i.routineId) }))
    .filter((i): i is typeof i & { r: ContextEntry } => !!i.r);
  // Not today: a weekday routine on another day, or a weekly goal already reached (unless ticked today).
  const notToday = (r: ContextEntry) => {
    const st = status.get(r.id);
    return !!st && !st.dueToday && !st.doneToday;
  };
  const rest = compact ? daily : daily.filter((r) => !picked.some((p) => p.r.id === r.id) && !notToday(r));
  const restingCount = compact ? 0 : daily.filter(notToday).length;

  const set = (r: ContextEntry) => (v: boolean | null) => void setRoutineDone(repo, today, r, v);
  const counted = compact ? all : [...picked.map((p) => p.r), ...rest, ...(mode ? extra : [])];
  const done = counted.filter((r) => log.get(r.id) === true).length;
  const follow = (direction: 'up' | 'down') => repo.updateSettings({ planMode: { direction, since: today } });


  return (
    <Card>
      <Text style={type.h2} accessibilityRole="header">Rutiner i dag</Text>
      <Text style={[type.small, { marginTop: 2 }]} accessibilityLiveRegion="polite">
        {all.length ? `${done} av ${counted.length} gjorda` : 'Inga dagliga rutiner i planen än.'}
      </Text>
      {picked.length ? (
        <View style={{ marginTop: space.s }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={type.label}>FÖRESLAGET I DAG</Text>
            {suggestion?.method === 'llm' ? <Tag label="Formulerat av AI" /> : null}
          </Row>
          {picked.map((p) => <RoutineRow key={p.r.id} r={p.r} done={log.get(p.r.id)} onSet={set(p.r)} detail={p.why} />)}
          {rest.length ? <Text style={[type.label, { marginTop: space.m }]}>ÖVRIGA I DAG</Text> : null}
        </View>
      ) : null}
      {(compact && !showAll ? rest.slice(0, COMPACT_MAX) : rest).map((r) => <RoutineRow key={r.id} r={r} done={log.get(r.id)} onSet={set(r)} />)}
      {restingCount ? (
        <Text style={[type.small, { marginTop: space.xs }]}>
          {restingCount === 1 ? 'En rutin' : `${restingCount} rutiner`} är klara för veckan eller inte planerade i dag.
        </Text>
      ) : null}
      {compact && !showAll && daily.length > COMPACT_MAX ? (
        <Button kind="ghost" title={`Visa ${daily.length - COMPACT_MAX} till`} onPress={() => setShowAll(true)} />
      ) : null}

      {mode && extra.length ? (
        <View style={{ marginTop: space.l }}>
          <Text style={type.label}>VID {polarityWord(mode.direction, ps).toUpperCase()}</Text>
          <Text style={type.small}>Du följer planen för {polarityWord(mode.direction, ps)} sedan {formatDateSv(mode.since)}.</Text>
          {extra.map((r) => <RoutineRow key={r.id} r={r} done={log.get(r.id)} onSet={set(r)} />)}
        </View>
      ) : null}

      {!compact ? (
        mode ? (
          <Button kind="ghost" title={`Sluta följa planen för ${polarityWord(mode.direction, ps)}`} onPress={() => repo.updateSettings({ planMode: null })} />
        ) : suggested && (suggested === 'up' ? hasUp : hasDown) ? (
          <View style={{ marginTop: space.m }}>
            <P>Dina tecken pekade åt {polarityWord(suggested, ps)} senast. Din plan har rutiner för det.</P>
            <Button title={`Följ rutinerna vid ${polarityWord(suggested, ps)}`} onPress={() => follow(suggested)} />
          </View>
        ) : (
          <Row style={{ marginTop: space.s }}>
            {hasUp ? <Button kind="ghost" title={`Följ planen vid ${polarityWord('up', ps)}`} onPress={() => follow('up')} /> : null}
            {hasDown ? <Button kind="ghost" title={`Följ planen vid ${polarityWord('down', ps)}`} onPress={() => follow('down')} /> : null}
          </Row>
        )
      ) : null}
    </Card>
  );
}
