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
import { daySuggestion, makeDaySuggestion, staleForSleep } from '../services/daySuggestion';
import { Button, Card, P, Row, Tag } from './components';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

export function RoutineRow({ r, done, onSet, detail }: { r: ContextEntry; done: boolean | undefined; onSet: (v: boolean | null) => void; detail?: string }) {
  const on = done === true;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${r.text}${on ? ', klar' : ''}${detail ? `. ${detail}` : ''}`}
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
      {/* Done is said in words too, not by the filled box alone. */}
      {on ? <Text style={[type.small, { color: colors.green, fontWeight: '600' }]}>✓ Klar</Text> : null}
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
export function RoutinesToday({ compact = false, collapsible = false, foldedMax }: { compact?: boolean; collapsible?: boolean; /** Folded, at most this many rows (Hem with more above it). */ foldedMax?: number }) {
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
  // The first suggestion of the day waits for the sync that runs when the app opens, so it reads
  // the night the watch has now, not the half night of an earlier fetch. At most 15 seconds.
  const garmin = repo.garminStatus();
  const [atOpen] = useState(() => ({ syncAt: garmin.lastSyncAt, recent: !!garmin.lastSyncAt && Date.now() - new Date(garmin.lastSyncAt).getTime() < 30 * 60_000 }));
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 15_000);
    return () => clearTimeout(t);
  }, []);
  const watchReady = !garmin.connected || atOpen.recent || garmin.lastSyncAt !== atOpen.syncAt || !!garmin.lastError || waited;
  // Checked again on every render, so after each sync: made once more when the night differs from the one it used.
  const stale = staleForSleep(suggestion, repo);
  useEffect(() => {
    if (empty || !watchReady || (suggestion?.date === today && !stale)) return;
    let live = true;
    makeDaySuggestion(repo, { browser: Platform.OS === 'web' }).then((s) => live && setSuggestion(s)).catch(() => undefined);
    return () => { live = false; };
  }, [repo, empty, today, suggestion?.date, stale, watchReady]);
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
  // Folded: a short list for today, the suggestion first; the rest, the reasons and the AI mark one tap away.
  const folded = foldedMax ?? 3;
  const shownPicked = open ? picked : picked.slice(0, folded);
  const shownRest = open ? rest : rest.slice(0, Math.max(0, folded - shownPicked.length));
  const hidden = counted.length - shownPicked.length - shownRest.length;

  return (
    <Card>
      <View accessible accessibilityRole="header" accessibilityLabel={`Rutiner i dag, ${done} av ${counted.length} gjorda`}>
        <Text style={type.h2}>Rutiner i dag</Text>
        <Text style={[type.small, { marginTop: 2 }]} accessibilityLiveRegion="polite">
          {all.length ? `${done} av ${counted.length} gjorda` : 'Inga dagliga rutiner i planen än.'}
        </Text>
      </View>
      <View style={{ marginTop: space.xs }}>
        {/* One list, the day's suggestion first. Why it was suggested shows with the details. */}
        {shownPicked.map((p) => <RoutineRow key={p.r.id} r={p.r} done={log.get(p.r.id)} onSet={set(p.r)} detail={open ? p.why : undefined} />)}
        {shownRest.map((r) => <RoutineRow key={r.id} r={r} done={log.get(r.id)} onSet={set(r)} />)}
      </View>
      {open && picked.length ? (
        <Row style={{ marginTop: space.xs, alignItems: 'center' }}>
          <Text style={[type.small, { flexShrink: 1 }]}>{picked.length === 1 ? 'Den första är föreslagen för i dag.' : `De ${picked.length} första är föreslagna för i dag.`}</Text>
          {suggestion?.method === 'llm' ? <Tag label="Formulerat av AI" /> : null}
        </Row>
      ) : null}
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
      {collapsible && (hidden > 0 || open) ? (
        <Button kind="ghost" title={open ? 'Visa färre' : `Visa alla rutiner (${counted.length})`} onPress={() => setOpen(!open)} />
      ) : null}
    </Card>
  );
}
