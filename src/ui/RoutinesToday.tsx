// "Rutiner i dag": the plan's daily routines, and its routines at early signs while the person
// follows them, ticked off during the day. Every tap is saved at once for today. Ticking off
// never changes the level and is never sent to a model.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { addDays, eveningDateKey, formatDateSv } from '../core/analysis/dates';
import type { ContextEntry } from '../core/domain/types';
import { polarityWord } from '../core/plan/fields';
import { signDirection } from '../core/plan/guidance';
import { routineLog, routinesToday } from '../core/plan/routines';
import { setRoutineDone } from '../services/routines';
import { Button, Card, P, Row } from './components';
import { useRepo } from './state';
import { colors, MIN_TOUCH, space, type } from './theme';

function RoutineRow({ r, done, onSet }: { r: ContextEntry; done: boolean | undefined; onSet: (v: boolean | null) => void }) {
  const on = done === true;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={r.text}
      onPress={() => onSet(on ? null : true)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: MIN_TOUCH, paddingVertical: space.xs }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.green, backgroundColor: on ? colors.green : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Text style={{ color: colors.onAccent, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <Text style={[type.body, { flex: 1 }]}>{r.text}</Text>
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

export function RoutinesToday({ compact = false }: { compact?: boolean }) {
  const repo = useRepo();
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

  const set = (r: ContextEntry) => (v: boolean | null) => void setRoutineDone(repo, today, r, v);
  const follow = (direction: 'up' | 'down') => repo.updateSettings({ planMode: { direction, since: today } });
  const done = all.filter((r) => log.get(r.id) === true).length;

  return (
    <Card>
      <Text style={type.h2} accessibilityRole="header">Rutiner i dag</Text>
      <Text style={[type.small, { marginTop: 2 }]} accessibilityLiveRegion="polite">
        {all.length ? `${done} av ${all.length} gjorda. Bocka av under dagen eller i kväll.` : 'Inga dagliga rutiner i planen än.'}
      </Text>
      {daily.map((r) => <RoutineRow key={r.id} r={r} done={log.get(r.id)} onSet={set(r)} />)}

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
