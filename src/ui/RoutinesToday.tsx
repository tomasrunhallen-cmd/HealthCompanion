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

/**
 * The same lists on Hem and in the check-in, from the same answers: the day's suggestion first,
 * then the other routines due today; routines not planned today, or with the week's goal
 * reached, are left out. `collapsible` (Hem): folded at first, showing the count and the
 * suggestion, the rest one tap away. `compact` (the check-in): without the buttons for following
 * the plan in one direction.
 */
export function RoutinesToday({ compact = false, collapsible = false }: { compact?: boolean; collapsible?: boolean }) {
  const repo = useRepo();
  const [open, setOpen] = useState(!collapsible);
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
  const empty = !all.length && !hasUp && !hasDown;

  // The hooks come before any early return, so they run in the same order on every render.
  const [suggestion, setSuggestion] = useState<DaySuggestion | null>(() => daySuggestion(repo));
  useEffect(() => {
    if (empty || suggestion?.date === today) return;
    let live = true;
    makeDaySuggestion(repo, { browser: Platform.OS === 'web' }).then((s) => live && setSuggestion(s)).catch(() => undefined);
    return () => { live = false; };
  }, [repo, empty, today, suggestion?.date]);
  if (empty) return null;
  const status = new Map(routineStatuses(entries, today).map((st) => [st.routine.id, st]));
  const picked = (suggestion?.date === today ? suggestion.items : [])
    .map((i) => ({ ...i, r: daily.find((d) => d.id === i.routineId) }))
    .filter((i): i is typeof i & { r: ContextEntry } => !!i.r);
  // Not today: a weekday routine on another day, or a weekly goal already reached (unless ticked today).
  const notToday = (r: ContextEntry) => {
    const st = status.get(r.id);
    return !!st && !st.dueToday && !st.doneToday;
  };
  const rest = daily.filter((r) => !picked.some((p) => p.r.id === r.id) && !notToday(r));
  const restingCount = daily.filter(notToday).length;

  const set = (r: ContextEntry) => (v: boolean | null) => void setRoutineDone(repo, today, r, v);
  const counted = [...picked.map((p) => p.r), ...rest, ...(mode ? extra : [])];
  const done = counted.filter((r) => log.get(r.id) === true).length;
  const follow = (direction: 'up' | 'down') => repo.updateSettings({ planMode: { direction, since: today } });
  // Folded: the suggestion, or without one the first two routines.
  const shownRest = open ? rest : picked.length ? [] : rest.slice(0, 2);
  const hidden = counted.length - picked.length - shownRest.length;

  return (
    <Card>
      <Pressable
        disabled={!collapsible}
        onPress={() => setOpen(!open)}
        accessibilityRole={collapsible ? 'button' : 'header'}
        accessibilityState={collapsible ? { expanded: open } : undefined}
        accessibilityLabel={`Rutiner i dag, ${done} av ${counted.length} gjorda`}
        accessibilityHint={collapsible ? (open ? 'Fäller ihop' : 'Visar alla rutiner i dag') : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: collapsible ? MIN_TOUCH : undefined }}
      >
        <View style={{ flex: 1 }}>
          <Text style={type.h2}>Rutiner i dag</Text>
          <Text style={[type.small, { marginTop: 2 }]} accessibilityLiveRegion="polite">
            {all.length ? `${done} av ${counted.length} gjorda` : 'Inga dagliga rutiner i planen än.'}
          </Text>
        </View>
        {collapsible ? <Text style={[type.small, { color: colors.accent, fontWeight: '600' }]}>{open ? 'Färre ▲' : hidden > 0 ? `Alla ${counted.length} ▼` : '▼'}</Text> : null}
      </Pressable>
      {picked.length ? (
        <View style={{ marginTop: space.s }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={type.label}>FÖRESLAGET I DAG</Text>
            {suggestion?.method === 'llm' ? <Tag label="Formulerat av AI" /> : null}
          </Row>
          {picked.map((p) => <RoutineRow key={p.r.id} r={p.r} done={log.get(p.r.id)} onSet={set(p.r)} detail={p.why} />)}
          {shownRest.length ? <Text style={[type.label, { marginTop: space.m }]}>ÖVRIGA I DAG</Text> : null}
        </View>
      ) : null}
      {shownRest.map((r) => <RoutineRow key={r.id} r={r} done={log.get(r.id)} onSet={set(r)} />)}
      {open && restingCount ? (
        <Text style={[type.small, { marginTop: space.xs }]}>
          {restingCount === 1 ? 'En rutin' : `${restingCount} rutiner`} är klara för veckan eller inte planerade i dag.
        </Text>
      ) : null}

      {open && mode && extra.length ? (
        <View style={{ marginTop: space.l }}>
          <Text style={type.label}>VID {polarityWord(mode.direction, ps).toUpperCase()}</Text>
          <Text style={type.small}>Du följer planen för {polarityWord(mode.direction, ps)} sedan {formatDateSv(mode.since)}.</Text>
          {extra.map((r) => <RoutineRow key={r.id} r={r} done={log.get(r.id)} onSet={set(r)} />)}
        </View>
      ) : null}

      {open && !compact ? (
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
